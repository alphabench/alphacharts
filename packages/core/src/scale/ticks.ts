// Axis tick marks.
//
// Price: "nice" steps (1, 2, 2.5, 5 × 10^k), never finer than the series'
// minimum price move.
//
// Time: every bar has a weight — the coarsest calendar boundary crossed since
// the previous bar (year > month > day > 12h > … > 1s), in the chart's time
// zone. Labels go to the heaviest bars first, skipping any that would crowd
// an accepted one. Candidates are generated from calendar boundaries in the
// visible span and mapped to bars by binary search, so the cost tracks the
// label count, not the bar count (10M bars visible costs the same as 1k).

import { civilFromLocal, DAY_MS, localFromCivil, type TimeZone } from "../data/tz.js";
import type { Formatter } from "./format.js";
import type { PriceScale } from "./price-scale.js";
import type { Timeline } from "../data/timeline.js";

// ---- price ---------------------------------------------------------------

/** Tick prices from lo to hi, about `targetGapPx` apart. */
export function priceTicks(lo: number, hi: number, heightPx: number, targetGapPx: number, minMove: number): { step: number; ticks: number[] } {
  const n = Math.max(1, heightPx / targetGapPx);
  const step = niceStep((hi - lo) / n, minMove);
  const ticks: number[] = [];
  if (!(step > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return { step, ticks };
  const start = Math.ceil(lo / step);
  const end = Math.floor(hi / step);
  for (let k = start; k <= end && ticks.length < 200; k++) ticks.push(roundTo(k * step, step));
  return { step, ticks };
}

/** About `count` nice tick values across [lo, hi], for scales that are not prices (no minimum move). */
export function niceTicks(lo: number, hi: number, count: number): { step: number; ticks: number[] } {
  return priceTicks(lo, hi, Math.max(1, count), 1, 0);
}

/**
 * Smallest 1/2/2.5/5 × 10^k step at or above `raw` that is a whole multiple of
 * `minMove`. The multiple rule keeps every tick on a price the series'
 * formatter shows exactly: a 2.5 step under a 0.01 minMove would put the
 * label "100.03" on a gridline at 100.025.
 */
export function niceStep(raw: number, minMove: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return minMove > 0 ? minMove : 0;
  const multiple = (s: number) => !(minMove > 0) || (s >= minMove * (1 - 1e-9) && Math.abs(s / minMove - Math.round(s / minMove)) < 1e-6);
  for (let e = Math.floor(Math.log10(raw)); e < 400; e++) {
    const p = Math.pow(10, e);
    for (const f of [1, 2, 2.5, 5]) {
      const st = f * p;
      if (st >= raw * (1 - 1e-12) && multiple(st)) return st;
    }
  }
  return minMove;
}

/** Remove binary noise (0.30000000000000004) without changing the tick. */
function roundTo(v: number, step: number): number {
  const d = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  return +v.toFixed(Math.min(d, 15));
}

export interface AxisTick {
  price: number;
  label: string;
}

/** Text for a price on a scale's axis, in the scale's mode. */
export function axisText(sc: PriceScale, fmt: Formatter | undefined, price: number): string {
  switch (sc.mode) {
    case "percent": return `${sc.display(price).toFixed(2)}%`;
    case "indexed": return sc.display(price).toFixed(2);
    default: return fmt ? fmt.format(price) : String(price);
  }
}

/** Ticks for a price scale about `gapPx` apart, in its mode. */
export function scaleTicks(sc: PriceScale, fmt: Formatter | undefined, gapPx: number): AxisTick[] {
  const h = sc.height;
  if (!(h > 0) || !(sc.max > sc.min)) return [];
  const label = (p: number) => ({ price: p, label: axisText(sc, fmt, p) });
  if (sc.mode === "percent" || sc.mode === "indexed") {
    return priceTicks(sc.min, sc.max, h, gapPx, 0.01).ticks.map((v) => label(sc.fromDisplay(v)));
  }
  if (sc.mode === "log" && sc.max - sc.min > 0.3) return logTicks(sc, gapPx).map(label);
  // Linear, or a log scale spanning less than a factor of 2: plain price steps.
  const a = sc.price(0), b = sc.price(h);
  return priceTicks(Math.min(a, b), Math.max(a, b), h, gapPx, fmt?.minMove ?? 0).ticks.map(label);
}

/** 1-2-5 (or every mantissa, or every n-th decade) prices, by available room. */
function logTicks(sc: PriceScale, gapPx: number): number[] {
  const pxPerDecade = sc.pxPerUnit;
  const mantissas = pxPerDecade >= gapPx * 9 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : pxPerDecade >= gapPx * 3 ? [1, 2, 5] : [1];
  const every = Math.max(1, Math.ceil(gapPx / pxPerDecade));
  const out: number[] = [];
  let lastY = Number.POSITIVE_INFINITY;
  for (let e = Math.floor(sc.min); e <= Math.ceil(sc.max) && out.length < 200; e++) {
    if (mantissas.length === 1 && e % every !== 0) continue;
    for (const m of mantissas) {
      const v = m * 10 ** e;
      const d = Math.log10(v);
      if (d < sc.min || d > sc.max) continue;
      const y = sc.y(v);
      if (Math.abs(lastY - y) < gapPx) continue;
      out.push(+v.toPrecision(12));
      lastY = y;
    }
  }
  return out;
}

// ---- time ----------------------------------------------------------------

export const W_YEAR = 20;
export const W_MONTH = 19;
export const W_DAY = 18;
const FIXED: readonly [number, number][] = [
  [17, 12 * 3_600_000],
  [16, 6 * 3_600_000],
  [15, 3 * 3_600_000],
  [14, 3_600_000],
  [13, 30 * 60_000],
  [12, 15 * 60_000],
  [11, 5 * 60_000],
  [10, 60_000],
  [9, 30_000],
  [8, 15_000],
  [7, 5_000],
  [6, 1_000],
];

/** Weight of a bar at t whose predecessor is at prev (NaN for the first bar). */
export function weightBetween(tz: TimeZone, prev: number, t: number): number {
  if (prev !== prev) return W_YEAR;
  return weightLocal(prev + tz.offset(prev), t + tz.offset(t));
}

/**
 * Weight between two local-time instants. Calendar fields are computed only
 * when the local day changes (rare for intraday bars); within a day the
 * fixed periods are integer divisions, so a scan over thousands of bars
 * allocates nothing.
 */
export function weightLocal(la: number, lb: number, minWeight = 0): number {
  if (Math.floor(la / DAY_MS) !== Math.floor(lb / DAY_MS)) {
    const a = civilFromLocal(la);
    const b = civilFromLocal(lb);
    if (a.year !== b.year) return W_YEAR;
    if (a.month !== b.month) return W_MONTH;
    return W_DAY;
  }
  for (const [w, p] of FIXED) {
    if (w < minWeight) return 0;
    if (Math.floor(la / p) !== Math.floor(lb / p)) return w;
  }
  return 0;
}

/**
 * Lightest weight that can still win a label: a boundary that recurs more
 * often than every half label gap (in wall time per bar) never survives the
 * spacing check, so collecting it is wasted work.
 */
function minUsefulWeight(msPerBar: number, spacing: number, gapPx: number): number {
  const minPeriod = (msPerBar * gapPx) / spacing / 2;
  let w = W_DAY;
  for (const [fw, p] of FIXED) if (p >= minPeriod) w = fw;
  return minPeriod > FIXED[0]![1] ? W_DAY : w;
}

export interface TimeTick {
  index: number;
  weight: number;
  x: number;
}

/**
 * Labels for indices [lo, hi] at the given scale. `x(i)` maps an index to CSS
 * px; `gapPx` is the minimum distance between label centres.
 */
export function timeTicks(tl: Timeline, tz: TimeZone, lo: number, hi: number, x: (i: number) => number, spacing: number, gapPx: number): TimeTick[] {
  if (hi < lo || tl.length === 0) return [];
  const cands: TimeTick[] = [];
  const time = (i: number) => (i > tl.first ? tl.timeAt(i - 1) : Number.NaN);
  const t0 = tl.timeAt(lo);
  const t1 = tl.timeAt(hi);
  // Every bar that can win a label is the first bar after a calendar
  // boundary at least as long as the lightest useful weight, so candidates
  // come from those boundaries by binary search: cost follows the label
  // count, not the number of visible bars.
  const msPerBar = hi > lo ? (t1 - t0) / (hi - lo) : 0;
  const minW = msPerBar > 0 ? minUsefulWeight(msPerBar, spacing, gapPx) : 0;
  const finest = msPerBar > 0 ? (msPerBar * gapPx) / spacing / 2 : 1000;
  const seen = new Set<number>();
  const add = (boundary: number) => {
    const i = tl.lowerBound(boundary);
    if (i < lo || i > hi || seen.has(i)) return;
    seen.add(i);
    const w = weightBetween(tz, time(i), tl.timeAt(i));
    if (w > 0 && w >= minW) cands.push({ index: i, weight: w, x: x(i) });
  };
  add(t0);
  boundaries(tz, t0, t1, finest, add);
  // Heaviest first; among equals, left to right.
  cands.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const out: TimeTick[] = [];
  for (const c of cands) {
    let ok = true;
    for (const o of out) {
      if (Math.abs(o.x - c.x) < gapPx) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(c);
    if (out.length > 200) break;
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/** Call `add` with calendar boundaries in [t0, t1] no finer than `finest` ms apart. */
function boundaries(tz: TimeZone, t0: number, t1: number, finest: number, add: (t: number) => void): void {
  const c0 = tz.civil(t0);
  const c1 = tz.civil(t1);
  for (let y = c0.year + 1; y <= c1.year; y++) add(tz.fromLocal(localFromCivil(y, 1, 1)));
  if (finest >= 300 * DAY_MS) return;
  const monthStep = finest >= 90 * DAY_MS ? 3 : 1;
  for (let y = c0.year, m = c0.month; y < c1.year || (y === c1.year && m <= c1.month); ) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if ((m - 1) % monthStep === 0) add(tz.fromLocal(localFromCivil(y, m, 1)));
  }
  if (finest >= 25 * DAY_MS) return;
  let step = DAY_MS;
  for (const [, p] of FIXED) if (p >= finest) step = p;
  if (finest > DAY_MS) step = DAY_MS * Math.min(7, Math.ceil(finest / DAY_MS));
  const l0 = t0 + tz.offset(t0);
  const l1 = t1 + tz.offset(t1);
  let n = 0;
  for (let l = Math.ceil(l0 / step) * step; l <= l1 && n < 2000; l += step, n++) add(tz.fromLocal(l));
}

// ---- formatting ------------------------------------------------------------

/**
 * Host-supplied text for the time axis and the crosshair's time label, for a
 * chart whose x axis is not a clock (an ordinal axis of Renko bricks, say).
 * `kind` says where the text goes: "tick" (axis) or "crosshair".
 */
export type TimeLabel = (time: number, kind: "tick" | "crosshair") => string;

/** The host's label when it set one, else the calendar label. A host label that is not a string throws. */
export function timeText(custom: TimeLabel | undefined, kind: "tick" | "crosshair", time: number, calendar: () => string): string {
  if (!custom) return calendar();
  const s = custom(time, kind);
  if (typeof s !== "string") throw new TypeError(`alphacharts: timeLabel(${time}, "${kind}") returned ${typeof s}, not a string`);
  return s;
}

export class TimeFormatter {
  private readonly year: Intl.DateTimeFormat;
  private readonly month: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private readonly hm: Intl.DateTimeFormat;
  private readonly hms: Intl.DateTimeFormat;
  private readonly full: Intl.DateTimeFormat;
  private readonly fullDate: Intl.DateTimeFormat;

  /** The crosshair label's own format (the `timeFormat` option), when set. */
  private readonly custom: Intl.DateTimeFormat | undefined;

  constructor(locale: string | undefined, tz: TimeZone, timeFormat?: Intl.DateTimeFormatOptions) {
    const timeZone = tz.id;
    if (timeFormat && "timeZone" in timeFormat) throw new Error("alphacharts: timeFormat must not set timeZone; use the chart's timeZone option");
    this.custom = timeFormat ? new Intl.DateTimeFormat(locale, { ...timeFormat, timeZone }) : undefined;
    this.year = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric" });
    this.month = new Intl.DateTimeFormat(locale, { timeZone, month: "short" });
    this.day = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric" });
    this.hm = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    this.hms = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    this.full = new Intl.DateTimeFormat(locale, {
      timeZone, weekday: "short", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    this.fullDate = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", year: "2-digit" });
  }

  private readonly cache = new Map<number, string>();

  /** Axis label for a bar; cached, since the same labels repeat every frame. */
  tick(t: number, weight: number): string {
    const key = t * 32 + weight;
    let s = this.cache.get(key);
    if (s === undefined) {
      if (this.cache.size > 4096) this.cache.clear();
      s = this.tickUncached(t, weight);
      this.cache.set(key, s);
    }
    return s;
  }

  private tickUncached(t: number, weight: number): string {
    if (weight >= W_YEAR) return this.year.format(t);
    if (weight >= W_MONTH) return this.month.format(t);
    if (weight >= W_DAY) return this.day.format(t);
    if (weight >= 10) return this.hm.format(t);
    return this.hms.format(t);
  }

  crosshair(t: number, withTime: boolean): string {
    if (this.custom) return this.custom.format(t);
    return (withTime ? this.full : this.fullDate).format(t);
  }
}

export class PriceFormatter {
  readonly decimals: number;
  constructor(readonly minMove: number) {
    if (!(minMove > 0)) throw new RangeError(`minMove must be positive, got ${minMove}`);
    // Decimals needed to show minMove exactly (0.25 → 2, 0.05 → 2, 1 → 0).
    let d = 0;
    while (d < 10 && Math.abs(Math.round(minMove * 10 ** d) - minMove * 10 ** d) > 1e-9 * 10 ** d) d++;
    this.decimals = d;
  }
  format(p: number): string {
    const s = p.toFixed(this.decimals);
    // A value that rounds to zero is zero, not "-0.00": a trader reads the minus as a loss.
    return s.charCodeAt(0) === 45 && Number(s) === 0 ? s.slice(1) : s;
  }
}
