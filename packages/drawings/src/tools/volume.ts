// Tools computed from bars: anchored VWAP and fixed-range volume profile.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { BarSource } from "../source.js";
import type { Drawing, Shape, ToolDef } from "../types.js";
import { A, finiteAnchors, line, needDistinctTimes, poly, px, text, tool } from "./util.js";

export interface VwapSeries {
  times: Float64Array;
  values: Float64Array;
}

/**
 * VWAP from bar `start` to the last bar: Σ(typical·volume) / Σ(volume), typical
 * = (high + low + close) / 3. Bars before the first with volume have no value (NaN).
 */
export function anchoredVwap(src: BarSource, start: number): VwapSeries {
  if (!Number.isInteger(start) || start < 0 || start >= src.length) throw new RangeError(`anchoredVwap: start ${start} outside 0..${src.length - 1}`);
  const n = src.length - start;
  const times = new Float64Array(n), values = new Float64Array(n);
  let pv = 0, v = 0;
  for (let i = 0; i < n; i++) {
    const b = src.at(start + i);
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    v += b.volume;
    times[i] = b.time;
    values[i] = v === 0 ? Number.NaN : pv / v;
  }
  return { times, values };
}

/** Index of the bar the anchor sits on: the last bar at or before its time (the first bar if it is earlier than all). */
export function startIndex(src: BarSource, time: number): number | null {
  if (src.length === 0) return null;
  const [lo, hi] = src.range(time, time);
  if (hi > lo) return lo;
  if (lo >= src.length) return null; // anchored after the last bar: nothing to average yet
  return Math.max(0, lo - 1);
}

const vwapCache = new WeakMap<BarSource, Map<number, { version: number; series: VwapSeries }>>();

function cachedVwap(src: BarSource, start: number): VwapSeries {
  let m = vwapCache.get(src);
  if (!m) vwapCache.set(src, (m = new Map()));
  const hit = m.get(start);
  if (hit && hit.version === src.version) return hit.series;
  const series = anchoredVwap(src, start);
  if (m.size > 64) m.clear();
  m.set(start, { version: src.version, series });
  return series;
}

export const anchoredVwapTool = tool({
  id: "anchoredVwap", label: "Anchored VWAP", family: "volume", gesture: "single", anchors: 1, needsSource: true,
  defaults: () => ({ style: { color: "chart-2" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    if (!c.source) throw new Error("anchoredVwap needs a BarSource");
    const p = px(c, A(d, 0));
    const out: Shape[] = [{ k: "ellipse", cx: p.x, cy: p.y, rx: 4, ry: 4, fill: d.style.color, width: 1 }];
    const start = startIndex(c.source, A(d, 0).time);
    if (start === null) return out;
    const s = cachedVwap(c.source, start);
    const tL = c.T(-2), tR = c.T(c.W + 2);
    // Visible slice by binary search over the (sorted) bar times.
    const lower = (t: number) => {
      let lo = 0, hi = s.times.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (s.times[m]! < t) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    const i0 = Math.max(0, lower(tL) - 1), i1 = Math.min(s.times.length, lower(tR) + 1);
    // One point per pixel column at most.
    const step = Math.max(1, Math.floor((i1 - i0) / (c.W + 4)));
    const pts: number[] = [];
    for (let i = i0; i < i1; i += step) if (!Number.isNaN(s.values[i]!)) pts.push(c.X(s.times[i]!), c.Y(s.values[i]!));
    if (pts.length >= 4) out.push({ k: "poly", pts });
    return out;
  },
});

export interface VolumeProfile {
  low: number;
  high: number;
  rowHeight: number;
  volumes: number[];
  poc: number;
}

/**
 * Bar-level volume profile of bars [lo, hi): a bar's volume is spread over
 * the rows its [low, high] range overlaps, in proportion to the overlap
 * (all of it in one row when low = high). This approximates real traded-at-
 * price volume, which a bar series does not contain. The row volumes sum to
 * the bars' total volume.
 */
export function volumeProfile(src: BarSource, lo: number, hi: number, rows: number): VolumeProfile {
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError(`volumeProfile: rows must be a positive integer, got ${rows}`);
  if (hi <= lo) throw new RangeError("volumeProfile: no bars in the range");
  let low = Infinity, high = -Infinity;
  for (let i = lo; i < hi; i++) {
    const b = src.at(i);
    if (b.low < low) low = b.low;
    if (b.high > high) high = b.high;
  }
  const span = high - low;
  const rowHeight = span / rows;
  const volumes = new Array<number>(rows).fill(0);
  for (let i = lo; i < hi; i++) {
    const b = src.at(i);
    if (span === 0 || b.high === b.low) {
      const r = span === 0 ? 0 : Math.min(rows - 1, Math.floor((b.low - low) / rowHeight));
      volumes[r]! += b.volume;
      continue;
    }
    const r0 = Math.min(rows - 1, Math.floor((b.low - low) / rowHeight)), r1 = Math.min(rows - 1, Math.floor((b.high - low) / rowHeight));
    const barSpan = b.high - b.low;
    for (let r = r0; r <= r1; r++) {
      const top = Math.min(b.high, low + (r + 1) * rowHeight), bot = Math.max(b.low, low + r * rowHeight);
      if (top > bot) volumes[r]! += (b.volume * (top - bot)) / barSpan;
    }
  }
  let poc = 0;
  volumes.forEach((v, r) => {
    if (v > volumes[poc]!) poc = r;
  });
  return { low, high, rowHeight, volumes, poc };
}

function rangeBars(d: Drawing, src: BarSource): [number, number] {
  const [lo, hi] = src.range(Math.min(A(d, 0).time, A(d, 1).time), Math.max(A(d, 0).time, A(d, 1).time));
  if (hi <= lo) throw new RangeError(`drawings: volumeProfile "${d.id}" has no bars between its anchors`);
  return [lo, hi];
}

const rowsOf = (d: Drawing): void => {
  const r = d.props.rows;
  if (typeof r !== "number" || !Number.isInteger(r) || r < 1 || r > 500) throw new RangeError(`drawings: ${d.tool} "${d.id}" prop "rows" must be an integer in 1..500`);
};

/** The histogram of a profile between bars [lo, hi), drawn from `left` to `right` with the widest row at 60% of that width (at least `minWidth`). */
function profileShapes(d: Drawing, c: Parameters<NonNullable<ToolDef["shapes"]>>[1], lo: number, hi: number, left: number, right: number, title: string, minWidth = 0): Shape[] {
  const vp = volumeProfile(c.source!, lo, hi, d.props.rows as number);
  const maxW = Math.max(minWidth, (right - left) * 0.6);
  const maxV = vp.volumes[vp.poc]!;
  const out: Shape[] = [line({ x: left, y: 0 }, { x: left, y: c.H }, { dash: "dotted", width: 1, extA: true, extB: true })];
  if (right > left) out.push(line({ x: right, y: 0 }, { x: right, y: c.H }, { dash: "dotted", width: 1, extA: true, extB: true }));
  vp.volumes.forEach((v, r) => {
    if (v === 0 || maxV === 0) return;
    const yTop = c.Y(vp.low + (r + 1) * vp.rowHeight), yBot = c.Y(vp.low + r * vp.rowHeight);
    const w = (v / maxV) * maxW;
    const pts: Pt[] = [{ x: left, y: yTop }, { x: left + w, y: yTop }, { x: left + w, y: yBot }, { x: left, y: yBot }];
    out.push(poly(pts, { close: true, fill: withAlpha(r === vp.poc ? "chart-2" : d.style.color, r === vp.poc ? 0.6 : 0.35), width: 0 }));
  });
  out.push(text(left + 4, 4, title, { base: "top", size: 10, textColor: d.style.color, hit: false }));
  return out;
}

export const volumeProfileTool = tool({
  id: "volumeProfile", label: "Fixed range volume profile (bar-level approximation)", family: "volume", gesture: "drag", anchors: 2, needsSource: true,
  defaults: () => ({ props: { rows: 24 } }),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
    rowsOf(d);
  },
  shapes(d, c) {
    if (!c.source) throw new Error("volumeProfile needs a BarSource");
    const [lo, hi] = rangeBars(d, c.source);
    const xa = c.X(A(d, 0).time), xb = c.X(A(d, 1).time);
    return profileShapes(d, c, lo, hi, Math.min(xa, xb), Math.max(xa, xb), "Volume profile (bar-level approximation)");
  },
});

/** The same profile from one anchor to the last bar: it grows with the data. */
export const anchoredVolumeProfileTool = tool({
  id: "anchoredVolumeProfile", label: "Anchored volume profile (bar-level approximation)", family: "volume", gesture: "single", anchors: 1, needsSource: true,
  defaults: () => ({ props: { rows: 24 } }),
  validate(d) {
    finiteAnchors(d);
    rowsOf(d);
  },
  shapes(d, c) {
    if (!c.source) throw new Error("anchoredVolumeProfile needs a BarSource");
    const start = startIndex(c.source, A(d, 0).time);
    if (start === null || start >= c.source.length) return [];
    const left = c.X(A(d, 0).time), right = c.X(c.source.at(c.source.length - 1).time);
    // A profile of one bar has no price span to speak of: draw nothing until there are two bars to profile.
    if (c.source.length - start < 2) return [];
    return profileShapes(d, c, start, c.source.length, left, right, "Anchored volume profile (bar-level approximation)", 40);
  },
});

export const volumeTools: ToolDef[] = [anchoredVwapTool, volumeProfileTool, anchoredVolumeProfileTool];
