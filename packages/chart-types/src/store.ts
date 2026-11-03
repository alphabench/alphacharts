// Derived bars: the output of every transform, with where each bar came from.
//
// Time-based vs event-based. Heikin-Ashi keeps one derived bar per source bar,
// so its bars keep the source bar's true time. Every other transform here
// (Renko, Kagi, Point & Figure, Line Break, range, tick, volume and dollar
// bars) builds bars from price movement or trade counts, not from the clock:
// two bricks can complete on the same millisecond, and a quiet hour makes none.
//
// The core's timeline is strictly increasing UTC milliseconds, one index per
// distinct time. Instead of nudging real times (which would put a brick at a
// time nothing happened) these transforms use an ORDINAL AXIS: derived bar k
// is placed at ORDINAL_EPOCH + k * ORDINAL_STEP (1970-01-01 + k days). Three
// properties make that honest rather than a trick:
//   1. The placement is a pure function of the bar's position, so appending a
//      bar never moves another one, and incremental == batch.
//   2. The time is never mistaken for a real one: the axis of such a chart is
//      relabelled with the bar number through the core's `timeLabel` option
//      (`ordinalTimeLabel`: "10", and "bar 10" in the crosshair label), so no
//      date appears that did not happen. Without that option the axis would read
//      January 1970; pass it for every chart whose series come from these
//      transforms (all but Heikin-Ashi). Mixing ordinal and real-time series in
//      one chart is meaningless and is the caller's mistake.
//   3. Every readout goes through the bar's SourceRange ({fromTime, toTime},
//      the true UTC ms of the first and last source observation that shaped
//      the bar), found with `sourceRangeAt(timeFromCrosshair)`. A crosshair
//      event carries the ordinal time; the true time range comes from here.
//
// Prices in a derived bar are either source prices (range, tick, volume,
// dollar bars; Kagi line ends) or box-grid levels derived from a source price
// by the documented rule (Renko bricks, Point & Figure boxes, Heikin-Ashi).
// The module header of each transform says which.

import type { ColumnarOhlc, OhlcBar, TimeLabel } from "@alphacharts/core";

/** UTC ms of ordinal 0: 1970-01-01. No real market data lives there. */
export const ORDINAL_EPOCH = 0;
/** One day per ordinal, so the core's axis ticks (days) stay readable. */
export const ORDINAL_STEP = 86_400_000;

export function ordinalTime(k: number): number {
  return ORDINAL_EPOCH + k * ORDINAL_STEP;
}

/** Ordinal of a time on the ordinal axis, or undefined when it is not one. */
export function ordinalOf(time: number): number | undefined {
  const k = (time - ORDINAL_EPOCH) / ORDINAL_STEP;
  return Number.isInteger(k) && k >= 0 ? k : undefined;
}

/**
 * `timeLabel` for a chart on the ordinal axis: the bar number, 1-based. A time
 * that is not an ordinal throws (real times do not belong on this axis).
 */
export const ordinalTimeLabel: TimeLabel = (time, kind) => {
  const k = ordinalOf(time);
  if (k === undefined) throw new RangeError(`ordinalTimeLabel: time ${time} is not on the ordinal axis (not a whole number of days since 1970-01-01)`);
  return kind === "tick" ? String(k + 1) : `bar ${k + 1}`;
};

/** True UTC ms of the first and last source observation behind a derived bar. */
export interface SourceRange {
  fromTime: number;
  toTime: number;
}

export interface DerivedBar extends OhlcBar, SourceRange {
  /** Traded volume inside the bar; only trade-built bars know it. */
  volume?: number;
}

const INITIAL = 64;

/** Growable columnar derived bars. Appends and last-bar replacement are O(1) amortised. */
export class BarStore {
  length = 0;
  time = new Float64Array(INITIAL);
  open = new Float64Array(INITIAL);
  high = new Float64Array(INITIAL);
  low = new Float64Array(INITIAL);
  close = new Float64Array(INITIAL);
  fromTime = new Float64Array(INITIAL);
  toTime = new Float64Array(INITIAL);
  /** Present only when the transform knows volume. */
  volume: Float64Array | undefined;
  private dirty = Number.POSITIVE_INFINITY;

  constructor(withVolume = false) {
    if (withVolume) this.volume = new Float64Array(INITIAL);
  }

  /** Write bar i (i <= length: replace one, or append at length). */
  set(i: number, time: number, o: number, h: number, l: number, c: number, from: number, to: number, volume?: number): void {
    if (i > this.length || i < 0) throw new RangeError(`BarStore.set: index ${i} with length ${this.length}`);
    if (i === this.length) this.grow(i + 1);
    this.time[i] = time;
    this.open[i] = o;
    this.high[i] = h;
    this.low[i] = l;
    this.close[i] = c;
    this.fromTime[i] = from;
    this.toTime[i] = to;
    if (this.volume) {
      if (volume === undefined) throw new TypeError("BarStore.set: this store holds volume, so every bar needs one");
      this.volume[i] = volume;
    }
    if (i === this.length) this.length = i + 1;
    if (i < this.dirty) this.dirty = i;
  }

  append(time: number, o: number, h: number, l: number, c: number, from: number, to: number, volume?: number): void {
    this.set(this.length, time, o, h, l, c, from, to, volume);
  }

  /** Lowest index written since the last call (length when nothing was); resets. */
  takeDirty(): number {
    const d = Math.min(this.dirty, this.length);
    this.dirty = Number.POSITIVE_INFINITY;
    return d;
  }

  bar(i: number): DerivedBar {
    if (i < 0 || i >= this.length) throw new RangeError(`BarStore.bar: index ${i} outside 0..${this.length - 1}`);
    const b: DerivedBar = { time: this.time[i]!, open: this.open[i]!, high: this.high[i]!, low: this.low[i]!, close: this.close[i]!, fromTime: this.fromTime[i]!, toTime: this.toTime[i]! };
    if (this.volume) b.volume = this.volume[i]!;
    return b;
  }

  /** Index of the bar at exactly `time` (ordinal or true), or undefined. O(log n). */
  indexOfTime(time: number): number | undefined {
    let lo = 0, hi = this.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = this.time[mid]!;
      if (t === time) return mid;
      if (t < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /** Where the bar at chart time `time` came from; undefined when no bar is there. */
  sourceRangeAt(time: number): SourceRange | undefined {
    const i = this.indexOfTime(time);
    return i === undefined ? undefined : { fromTime: this.fromTime[i]!, toTime: this.toTime[i]! };
  }

  /** Views (not copies) over bars [from, length): what Series.setData / prepend accept. */
  columns(from = 0): ColumnarOhlc {
    return {
      time: this.time.subarray(from, this.length),
      open: this.open.subarray(from, this.length),
      high: this.high.subarray(from, this.length),
      low: this.low.subarray(from, this.length),
      close: this.close.subarray(from, this.length),
    };
  }

  toArray(from = 0): DerivedBar[] {
    const out: DerivedBar[] = [];
    for (let i = from; i < this.length; i++) out.push(this.bar(i));
    return out;
  }

  private grow(n: number): void {
    if (n <= this.time.length) return;
    const cap = Math.max(n, this.time.length * 2);
    const g = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a.subarray(0, this.length));
      return b;
    };
    this.time = g(this.time);
    this.open = g(this.open);
    this.high = g(this.high);
    this.low = g(this.low);
    this.close = g(this.close);
    this.fromTime = g(this.fromTime);
    this.toTime = g(this.toTime);
    if (this.volume) this.volume = g(this.volume);
  }
}

/** The part of Series a transform feeds. */
export interface BarSink {
  update(bar: OhlcBar): void;
}

/**
 * Push the bars a transform changed to a series: `from` is what push() returned.
 * Bars below `from` are untouched; the series replaces its last bar when the
 * time matches and appends otherwise, which is exactly the shape of a delta.
 * A series fed this way must have been loaded from the same store.
 */
export function syncSeries(series: BarSink, store: BarStore, from: number): void {
  for (let i = from; i < store.length; i++) series.update(store.bar(i));
}
