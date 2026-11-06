// The chart's data: one Timeline shared by every series, and per series a
// dense column store over timeline indices (NaN where the series has no bar at
// that time) plus its LOD pyramid.
//
// Paths, cheapest first:
// - update(): a live bar. Replaces the series' last bar or appends one;
//   O(log n) for the pyramid. Times may not go backwards.
// - prepend(): a page of older history. Adds indices below `first`, so nothing
//   already on screen moves; O(page).
// - setData(): replaces a series. When the timeline is non-empty and every
//   time of the new rows is already on it (and the series' old bars are all
//   kept), only that series is placed: one linear merge walk, O(its rows),
//   nothing else is touched. Otherwise the timeline is rebuilt as the union of
//   all series' times and every other series is re-indexed onto it; O(total).
// - batch(): setData calls inside defer that union rebuild (one for the whole
//   batch) and every change event to the end. Reads of the timeline or of a
//   deferred series inside the batch see the state before the batch.
// When prepend/update meet a time that no series has and that falls inside the
// timeline (another series' gap), they take the setData path; that is a full
// re-index, not an approximation.
//
// Per-bar colour (OHLC series): an optional Uint32 column (0xRRGGBBAA, 0 = the
// series' own up/down colours) that is added to the store the first time a
// colour is written, so a series that is never coloured has no such column, no
// pyramid colour column and no extra work on any path below. A colour belongs
// to (series, time): update() and prepend() leave the colour of bars they do
// not name alone, and setData() carries the colours of the times it keeps (rows
// that bring their own colour win). setColors() writes colours alone, without a
// data change event the studies would answer by recomputing.

import { parseColor } from "../render/color.js";
import { ColumnDeque, F64_NAN, U32_ZERO } from "./deque.js";
import { Lod, type LodSource } from "./lod.js";
import { assertIncreasing, Timeline } from "./timeline.js";

export type SeriesShape = "ohlc" | "value";

/** Times are UTC milliseconds since the epoch. */
export interface OhlcBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Per-bar colour override, CSS colour string; absent leaves the bar's colour as it is. */
  color?: string;
}
export interface ValuePoint {
  time: number;
  value: number;
  /** Per-point colour override, CSS colour string. */
  color?: string;
}
/** Zero-copy bulk input: equal-length columns, times strictly increasing. */
export interface ColumnarOhlc {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  /** Packed 0xRRGGBBAA per bar; 0 means the series colours. Absent leaves the bars' colours as they are. */
  color?: Uint32Array;
}
/** Colours alone for bars of an OHLC series, by time (times strictly increasing; a time the series has no bar at is ignored). */
export interface ColumnarColors {
  time: Float64Array;
  /** Packed 0xRRGGBBAA; 0 clears the bar back to the series colours. */
  color: Uint32Array;
}
export interface ColumnarValue {
  time: Float64Array;
  value: Float64Array;
  /** Packed 0xRRGGBBAA per point; 0 means the series colour. */
  color?: Uint32Array;
}

export type OhlcInput = readonly OhlcBar[] | ColumnarOhlc;
export type ValueInput = readonly ValuePoint[] | ColumnarValue;

// Store column layout.
export const COL_O = 0, COL_H = 1, COL_L = 2, COL_C = 3;
export const COL_V = 0, COL_COLOR = 1;
/** The optional colour column of an OHLC store, added by `SeriesData.enableColors`. */
export const COL_BAR_COLOR = 4;

/** Normalised rows: times plus the store's columns in order. */
interface Rows {
  time: Float64Array;
  cols: (Float64Array | Uint32Array)[];
}

/** "color": only bar colours changed (no bar, price or time did): data followers such as studies have nothing to recompute. */
export type ChangeKind = "replace" | "prepend" | "update" | "color";

export interface DataChange {
  readonly series: SeriesData | null;
  readonly kind: ChangeKind;
  /** Timeline indices whose bars changed, [lo, hi). */
  readonly lo: number;
  readonly hi: number;
  /** Every index was renumbered (union rebuild). */
  readonly reindexed: boolean;
  /** An index was added at the end of the timeline. */
  readonly appended: boolean;
}

export class SeriesData {
  readonly store: ColumnDeque;
  readonly lod: Lod;
  private readonly lodSrc: LodSource;
  /**
   * A value series: whether any point may carry its own colour (set when one is written, cleared when the series is
   * replaced). Conservative: renderers that draw uncoloured series faster read it.
   */
  pointColors = false;

  constructor(readonly shape: SeriesShape) {
    this.store =
      shape === "ohlc" ? new ColumnDeque([F64_NAN, F64_NAN, F64_NAN, F64_NAN]) : new ColumnDeque([F64_NAN, U32_ZERO]);
    this.lodSrc =
      shape === "ohlc"
        ? { store: this.store, o: COL_O, h: COL_H, l: COL_L, c: COL_C, colorMode: "any" }
        : { store: this.store, o: COL_V, h: COL_V, l: COL_V, c: COL_V, color: COL_COLOR };
    this.lod = new Lod(this.lodSrc);
  }

  /** Whether an OHLC series holds a per-bar colour column. */
  get colored(): boolean {
    return this.shape === "ohlc" && this.store.cols.length > COL_BAR_COLOR;
  }

  /** Add the colour column (all zero) and the pyramid's colour column. A no-op when present or for a value series. */
  enableColors(): void {
    if (this.shape !== "ohlc" || this.colored) return;
    this.store.addColumn(U32_ZERO);
    this.lodSrc.color = COL_BAR_COLOR;
    this.lod.rebuild();
  }

  /** Remove the colour column again, giving its memory back. */
  disableColors(): void {
    if (!this.colored) return;
    this.store.dropColumn();
    delete this.lodSrc.color;
    this.lod.rebuild();
  }

  /** True when the series has a bar at timeline index i. */
  has(i: number): boolean {
    const s = this.store;
    if (!s.has(i)) return false;
    const v = s.cols[0]![s.pos(i)]!;
    return v === v;
  }

  /** Value of column `col` at timeline index i (NaN when absent). */
  get(i: number, col: number): number {
    const s = this.store;
    return s.has(i) ? s.cols[col]![s.pos(i)]! : Number.NaN;
  }

  /** First/last timeline index that holds a bar, or undefined when empty. */
  firstIndex(): number | undefined {
    for (let i = this.store.first; i < this.store.end; i++) if (this.has(i)) return i;
    return undefined;
  }
  lastIndex(): number | undefined {
    for (let i = this.store.end - 1; i >= this.store.first; i--) if (this.has(i)) return i;
    return undefined;
  }

  /** Nearest index at or before i holding a bar (for crosshair readouts over holes). */
  indexAtOrBefore(i: number): number | undefined {
    for (let j = Math.min(i, this.store.end - 1); j >= this.store.first; j--) if (this.has(j)) return j;
    return undefined;
  }
}

export class DataModel {
  readonly timeline = new Timeline();
  private readonly series = new Set<SeriesData>();
  private readonly listeners = new Set<(c: DataChange) => void>();
  private batchDepth = 0;
  /** setData rows inside a batch that need the union rebuild. */
  private readonly deferred = new Map<SeriesData, Rows>();
  /** Series placed or deferred inside the batch, to be announced at its end. */
  private readonly touched = new Set<SeriesData>();

  add(shape: SeriesShape): SeriesData {
    const s = new SeriesData(shape);
    this.series.add(s);
    return s;
  }

  remove(s: SeriesData): void {
    this.settle();
    if (!this.series.delete(s)) return;
    if (s.store.length > 0) {
      s.store.clear();
      s.lod.rebuild();
      const reindexed = this.rebuild([]);
      this.emit({ series: null, kind: "replace", lo: this.timeline.first, hi: this.timeline.end, reindexed, appended: false });
    }
  }

  /**
   * Run `fn` with the union rebuild and the change events deferred to its end:
   * adding k series costs one rebuild, not k. Nests; the outermost call
   * settles. Prepend, update and remove settle what is pending first.
   */
  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      if (--this.batchDepth === 0) this.settle();
    }
  }

  onChange(fn: (c: DataChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setData(s: SeriesData, input: OhlcInput | ValueInput): void {
    this.live(s);
    let rows = normalize(s.shape, input);
    // colours belong to (series, time): the times this call keeps keep theirs
    if (s.colored && rows.cols.length === COL_BAR_COLOR) {
      const snap = snapshotColors(s, this.timeline);
      if (snap) rows = carryColors(rows, snap);
    }
    if (this.batchDepth > 0) {
      this.touched.add(s);
      if (placeOnTimeline(s, rows, this.timeline)) this.deferred.delete(s);
      else this.deferred.set(s, rows);
      return;
    }
    if (placeOnTimeline(s, rows, this.timeline)) {
      this.emit({ series: s, kind: "replace", lo: this.timeline.first, hi: this.timeline.end, reindexed: false, appended: false });
      return;
    }
    const reindexed = this.rebuild([[s, rows]]);
    this.emit({ series: s, kind: "replace", lo: this.timeline.first, hi: this.timeline.end, reindexed, appended: false });
  }

  /** End of a batch (or a prepend/update/remove inside one): rebuild once, announce. */
  private settle(): void {
    if (this.touched.size === 0) return;
    const touched = [...this.touched];
    this.touched.clear();
    let reindexed = false;
    if (this.deferred.size > 0) {
      const targets = [...this.deferred];
      this.deferred.clear();
      reindexed = this.rebuild(targets);
    }
    const tl = this.timeline;
    // One event per series: each observes its own data (decimals) from it.
    for (const s of touched) {
      if (this.series.has(s)) this.emit({ series: s, kind: "replace", lo: tl.first, hi: tl.end, reindexed, appended: false });
    }
  }

  /** Older bars, all earlier than the series' first bar. */
  prepend(s: SeriesData, input: OhlcInput | ValueInput): void {
    this.settle();
    this.live(s);
    const rows = normalize(s.shape, input);
    const n = rows.time.length;
    if (n === 0) return;
    const tl = this.timeline;
    const sFirst = s.firstIndex();
    if (sFirst !== undefined && rows.time[n - 1]! >= tl.timeAt(sFirst)) {
      throw new RangeError("prepend: bars must be earlier than the series' first bar");
    }
    if (tl.length === 0) {
      this.rebuildAndEmit(s, rows);
      return;
    }
    const tlFirstTime = tl.timeAt(tl.first);
    let m = 0;
    while (m < n && rows.time[m]! < tlFirstTime) m++;
    // Rows at or after the timeline's start must land on existing indices.
    const idx = new Float64Array(n);
    for (let i = m; i < n; i++) {
      const at = tl.indexOf(rows.time[i]!);
      if (at === undefined) {
        this.rebuildAndEmit(s, concatRows(rows, extract(s, tl)));
        return;
      }
      idx[i] = at;
    }
    const newFirst = tl.prepend(rows.time.subarray(0, m));
    for (let i = 0; i < m; i++) idx[i] = newFirst + i;
    const lo = idx[0]!;
    const hi = idx[n - 1]! + 1;
    s.store.cover(lo, Math.max(hi, s.store.length > 0 ? s.store.end : hi));
    writeRows(s, rows, idx);
    s.lod.update(lo, hi);
    this.emit({ series: s, kind: "prepend", lo, hi, reindexed: false, appended: false });
  }

  /** A live bar: replaces the series' last bar if the time matches, else appends. */
  update(s: SeriesData, input: OhlcBar | ValuePoint): void {
    this.settle();
    this.live(s);
    const rows = normalize(s.shape, [input] as OhlcInput | ValueInput);
    const t = rows.time[0]!;
    const tl = this.timeline;
    const sLast = s.lastIndex();
    if (sLast !== undefined) {
      const lastTime = tl.timeAt(sLast);
      if (t < lastTime) throw new RangeError(`update: time ${t} is earlier than the series' last bar ${lastTime}`);
    }
    let i: number | undefined;
    let appended = false;
    if (tl.length === 0 || t > tl.timeAt(tl.end - 1)) {
      i = tl.append(t);
      appended = true;
    } else {
      i = tl.indexOf(t);
    }
    if (i === undefined) {
      this.rebuildAndEmit(s, concatRows(extract(s, tl), rows));
      return;
    }
    s.store.cover(s.store.length > 0 ? Math.min(s.store.first, i) : i, Math.max(s.store.length > 0 ? s.store.end : 0, i + 1));
    writeRows(s, rows, Float64Array.of(i));
    s.lod.update(i, i + 1);
    this.emit({ series: s, kind: "update", lo: i, hi: i + 1, reindexed: false, appended });
  }

  /**
   * Write bar colours of an OHLC series without touching its bars. Times the series has no bar at are ignored; a colour
   * equal to the one already there changes nothing and announces nothing. Announces a "color" change over the bars that
   * did change (one event), which renderers answer by patching those records.
   */
  setColors(s: SeriesData, input: ColumnarColors): void {
    this.settle();
    this.live(s);
    if (s.shape !== "ohlc") throw new TypeError("setColors: only an OHLC series (candles, bars) has bar colours");
    const n = input.time.length;
    if (input.color.length !== n) throw new RangeError(`setColors: color has ${input.color.length} rows, time has ${n}`);
    assertIncreasing(input.time, "bar colours");
    if (n === 0) return;
    if (!s.colored) {
      let any = false;
      for (let k = 0; k < n && !any; k++) any = input.color[k]! !== 0;
      if (!any) return;
      s.enableColors();
    }
    const tl = this.timeline;
    const { buf, offset } = tl.raw();
    const st = s.store;
    const C = st.cols[COL_BAR_COLOR] as Uint32Array;
    let lo = Number.POSITIVE_INFINITY, hi = Number.NEGATIVE_INFINITY;
    let j = tl.first;
    for (let k = 0; k < n; k++) {
      const t = input.time[k]!;
      while (j < tl.end && buf[offset + j]! < t) j++;
      if (j >= tl.end) break;
      if (buf[offset + j]! !== t || !s.has(j)) continue;
      const p = st.pos(j);
      if (C[p] === input.color[k]) continue;
      C[p] = input.color[k]!;
      if (j < lo) lo = j;
      if (j > hi) hi = j;
    }
    if (hi < lo) return;
    s.lod.update(lo, hi + 1);
    this.emit({ series: s, kind: "color", lo, hi: hi + 1, reindexed: false, appended: false });
  }

  /** Remove every bar colour of an OHLC series (and the colour column). Announces one "color" change when there were any. */
  clearColors(s: SeriesData): void {
    this.settle();
    this.live(s);
    if (!s.colored) return;
    const st = s.store;
    const C = st.cols[COL_BAR_COLOR] as Uint32Array;
    let lo = Number.POSITIVE_INFINITY, hi = Number.NEGATIVE_INFINITY;
    for (let i = st.first; i < st.end; i++) {
      if (C[st.pos(i)] === 0) continue;
      if (i < lo) lo = i;
      hi = i;
    }
    s.disableColors();
    if (hi < lo) return;
    this.emit({ series: s, kind: "color", lo, hi: hi + 1, reindexed: false, appended: false });
  }

  private rebuildAndEmit(s: SeriesData, rows: Rows): void {
    const reindexed = this.rebuild([[s, rows]]);
    this.emit({ series: s, kind: "replace", lo: this.timeline.first, hi: this.timeline.end, reindexed, appended: false });
  }

  /**
   * Replace the targets' rows and rebuild the timeline as the union of every
   * series' times, re-indexing the others only when the union changed. Returns
   * whether the union changed (every index renumbered or added).
   */
  private rebuild(targets: readonly (readonly [SeriesData, Rows])[]): boolean {
    const tl = this.timeline;
    const isTarget = new Set(targets.map(([s]) => s));
    const others: { s: SeriesData; rows: Rows }[] = [];
    for (const o of this.series) if (!isTarget.has(o) && o.store.length > 0) others.push({ s: o, rows: extract(o, tl) });

    let union: Float64Array = new Float64Array(0);
    for (const [, rows] of targets) union = mergeUnique(union, rows.time);
    for (const o of others) union = mergeUnique(union, o.rows.time);

    const same = union.length === tl.length && sameTimes(union, tl);
    if (!same) tl.replace(union, stableFirst(tl, union));

    for (const [s, rows] of targets) placeRows(s, rows, tl);
    if (!same) for (const o of others) placeRows(o.s, o.rows, tl);
    return !same;
  }

  /** A removed series must not reshape the timeline the others share. */
  private live(s: SeriesData): void {
    if (!this.series.has(s)) throw new Error("alphacharts: this series was removed from its chart");
  }

  private emit(c: DataChange): void {
    for (const fn of this.listeners) fn(c);
  }
}

/** Re-create a series' store at the indices its times occupy on `tl`. */
function placeRows(s: SeriesData, rows: Rows, tl: Timeline): void {
  s.store.clear();
  if (rows.time.length === 0) {
    s.lod.rebuild();
    return;
  }
  const idx = new Float64Array(rows.time.length);
  const { buf, offset } = tl.raw();
  let j = tl.first;
  for (let i = 0; i < idx.length; i++) {
    const t = rows.time[i]!;
    while (buf[offset + j]! < t) j++;
    idx[i] = j;
  }
  put(s, rows, idx);
}

function put(s: SeriesData, rows: Rows, idx: Float64Array): void {
  s.store.clear();
  s.pointColors = false;
  s.store.cover(idx[0]!, idx[idx.length - 1]! + 1);
  writeRows(s, rows, idx);
  s.lod.rebuild();
}

/**
 * Fast path of setData: place `rows` on the existing timeline when every time
 * is already on it and every bar the series has now is kept (otherwise the
 * timeline would keep a time nobody holds). One linear merge walk; touches
 * nothing but `s`. False (and nothing changed) when the union must be rebuilt.
 */
function placeOnTimeline(s: SeriesData, rows: Rows, tl: Timeline): boolean {
  const n = rows.time.length;
  if (tl.length === 0 || n === 0) return false;
  const { buf, offset } = tl.raw();
  const idx = new Float64Array(n);
  let j = tl.first;
  for (let i = 0; i < n; i++) {
    const t = rows.time[i]!;
    while (j < tl.end && buf[offset + j]! < t) j++;
    if (j >= tl.end || buf[offset + j]! !== t) return false;
    idx[i] = j;
  }
  const st = s.store;
  if (st.length > 0) {
    let k = 0;
    for (let i = st.first; i < st.end; i++) {
      if (!s.has(i)) continue;
      while (k < n && idx[k]! < i) k++;
      if (k >= n || idx[k] !== i) return false;
    }
  }
  put(s, rows, idx);
  return true;
}

function writeRows(s: SeriesData, rows: Rows, idx: Float64Array): void {
  const st = s.store;
  // rows that bring colours add the column; rows that do not leave the colours of the bars they overwrite
  if (s.shape === "ohlc" && rows.cols.length > COL_BAR_COLOR) s.enableColors();
  for (let c = 0; c < rows.cols.length; c++) {
    const dst = st.cols[c]!;
    const src = rows.cols[c]!;
    const off = st.head - st.first;
    for (let i = 0; i < idx.length; i++) dst[off + idx[i]!] = src[i]!;
    if (s.shape === "value" && c === COL_COLOR && !s.pointColors) {
      for (let i = 0; i < src.length; i++) if (src[i] !== 0) { s.pointColors = true; break; }
    }
  }
}

/** The non-zero bar colours of an OHLC series with their times; null when there are none. */
function snapshotColors(s: SeriesData, tl: Timeline): Rows | null {
  const st = s.store;
  const C = st.cols[COL_BAR_COLOR] as Uint32Array;
  let n = 0;
  for (let i = st.first; i < st.end; i++) if (C[st.pos(i)] !== 0 && s.has(i)) n++;
  if (n === 0) return null;
  const time = new Float64Array(n), color = new Uint32Array(n);
  let k = 0;
  for (let i = st.first; i < st.end; i++) {
    if (C[st.pos(i)] === 0 || !s.has(i)) continue;
    time[k] = tl.timeAt(i);
    color[k++] = C[st.pos(i)]!;
  }
  return { time, cols: [color] };
}

/** `rows` with a colour column: the snapshot's colour at every time it holds, zero elsewhere. */
function carryColors(rows: Rows, snap: Rows): Rows {
  const n = rows.time.length;
  const color = new Uint32Array(n);
  const st = snap.time, sc = snap.cols[0] as Uint32Array;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = rows.time[i]!;
    while (j < st.length && st[j]! < t) j++;
    if (j < st.length && st[j] === t) color[i] = sc[j]!;
  }
  return { time: rows.time, cols: [...rows.cols, color] };
}

/** A series' rows with their times, in index order. */
function extract(s: SeriesData, tl: Timeline): Rows {
  const st = s.store;
  let n = 0;
  for (let i = st.first; i < st.end; i++) if (s.has(i)) n++;
  const time = new Float64Array(n);
  const cols = st.cols.map((c) => new (c.constructor as Float64ArrayConstructor | Uint32ArrayConstructor)(n));
  let k = 0;
  for (let i = st.first; i < st.end; i++) {
    if (!s.has(i)) continue;
    time[k] = tl.timeAt(i);
    const p = st.pos(i);
    for (let c = 0; c < cols.length; c++) cols[c]![k] = st.cols[c]![p]!;
    k++;
  }
  return { time, cols };
}

function concatRows(a: Rows, b: Rows): Rows {
  // one side may carry bar colours and the other not
  if (a.cols.length !== b.cols.length) {
    const pad = (r: Rows): Rows => (r.cols.length === COL_BAR_COLOR ? { time: r.time, cols: [...r.cols, new Uint32Array(r.time.length)] } : r);
    a = pad(a);
    b = pad(b);
  }
  const time = new Float64Array(a.time.length + b.time.length);
  time.set(a.time);
  time.set(b.time, a.time.length);
  const cols = a.cols.map((c, i) => {
    const out = new (c.constructor as Float64ArrayConstructor | Uint32ArrayConstructor)(time.length);
    out.set(c);
    out.set(b.cols[i]!, c.length);
    return out;
  });
  assertIncreasing(time, "series");
  return { time, cols };
}

function mergeUnique(a: Float64Array, b: Float64Array): Float64Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float64Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!, y = b[j]!;
    if (x < y) (out[k++] = x), i++;
    else if (y < x) (out[k++] = y), j++;
    else (out[k++] = x), i++, j++;
  }
  while (i < a.length) out[k++] = a[i++]!;
  while (j < b.length) out[k++] = b[j++]!;
  return out.subarray(0, k);
}

/**
 * First index for a rebuilt timeline such that the earliest time present in
 * both the old and new axes keeps its index. Bars before an inserted time
 * keep their indices; only those after it move. With nothing in common (a
 * new instrument), the old first index is kept.
 */
function stableFirst(tl: Timeline, union: Float64Array): number {
  if (tl.length === 0) return 0;
  const { buf, offset } = tl.raw();
  let i = 0, j = tl.first;
  while (i < union.length && j < tl.end) {
    const u = union[i]!, t = buf[offset + j]!;
    if (u === t) return j - i;
    if (u < t) i++;
    else j++;
  }
  return tl.first;
}

function sameTimes(a: Float64Array, tl: Timeline): boolean {
  const { buf, offset } = tl.raw();
  for (let i = 0; i < a.length; i++) if (a[i] !== buf[offset + tl.first + i]) return false;
  return true;
}

function normalize(shape: SeriesShape, input: OhlcInput | ValueInput): Rows {
  if (shape === "ohlc") {
    const rows = Array.isArray(input) ? ohlcFromObjects(input as readonly OhlcBar[]) : ohlcFromColumns(input as ColumnarOhlc);
    assertIncreasing(rows.time, "ohlc data");
    for (let c = 0; c < 4; c++) assertFinite(rows.cols[c] as Float64Array, ["open", "high", "low", "close"][c]!);
    assertOhlc(rows);
    return rows;
  }
  const rows = Array.isArray(input) ? valueFromObjects(input as readonly ValuePoint[]) : valueFromColumns(input as ColumnarValue);
  assertIncreasing(rows.time, "value data");
  assertFinite(rows.cols[COL_V] as Float64Array, "value");
  return rows;
}

function ohlcFromObjects(bars: readonly OhlcBar[]): Rows {
  const n = bars.length;
  const time = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
  let color: Uint32Array | undefined;
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    time[i] = b.time;
    o[i] = b.open;
    h[i] = b.high;
    l[i] = b.low;
    c[i] = b.close;
    if (b.color !== undefined) (color ??= new Uint32Array(n))[i] = parseColor(b.color);
  }
  return { time, cols: color ? [o, h, l, c, color] : [o, h, l, c] };
}

function ohlcFromColumns(d: ColumnarOhlc): Rows {
  const n = d.time.length;
  for (const k of ["open", "high", "low", "close"] as const) {
    if (d[k].length !== n) throw new RangeError(`columnar ohlc: ${k} has ${d[k].length} rows, time has ${n}`);
  }
  if (d.color && d.color.length !== n) throw new RangeError(`columnar ohlc: color has ${d.color.length} rows, time has ${n}`);
  return { time: d.time, cols: d.color ? [d.open, d.high, d.low, d.close, d.color] : [d.open, d.high, d.low, d.close] };
}

function valueFromObjects(points: readonly ValuePoint[]): Rows {
  const n = points.length;
  const time = new Float64Array(n), v = new Float64Array(n), color = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    time[i] = p.time;
    v[i] = p.value;
    if (p.color !== undefined) color[i] = parseColor(p.color);
  }
  return { time, cols: [v, color] };
}

function valueFromColumns(d: ColumnarValue): Rows {
  const n = d.time.length;
  if (d.value.length !== n) throw new RangeError(`columnar value: value has ${d.value.length} rows, time has ${n}`);
  if (d.color && d.color.length !== n) throw new RangeError(`columnar value: color has ${d.color.length} rows, time has ${n}`);
  return { time: d.time, cols: [d.value, d.color ?? new Uint32Array(n)] };
}

/** low <= open, close <= high on every row: autoscale and LOD rely on it. */
function assertOhlc(rows: Rows): void {
  const [o, h, l, c] = rows.cols as Float64Array[];
  for (let i = 0; i < o!.length; i++) {
    const lo = l![i]!, hi = h![i]!;
    if (!(lo <= o![i]! && lo <= c![i]! && hi >= o![i]! && hi >= c![i]!)) {
      throw new RangeError(`ohlc row ${i} (time ${rows.time[i]}): needs low <= open, close <= high; got o=${o![i]} h=${hi} l=${lo} c=${c![i]}`);
    }
  }
}

function assertFinite(a: Float64Array, what: string): void {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]!)) throw new TypeError(`${what} at row ${i} is not a finite number`);
  }
}
