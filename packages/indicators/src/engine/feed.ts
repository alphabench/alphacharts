// Outside series: another instrument's bars, or the same instrument on another
// timeframe, given to a study by its host and joined onto the study's own bars
// by time. The package knows nothing about instruments or timeframes: a feed is
// bars in their own time (UTC ms, strictly increasing) plus how to join them.
//
// The join is a function of the time of the study's bar `t` and of the feed's
// bars at or before `t - lag`, never of any later bar, so a value on a finished
// bar cannot change when later bars arrive or are cut off:
//
//   "same"    The feed is on the study's own timeframe. The feed's bar with
//             exactly time `t`, else absent (NaN). Nothing is carried from an
//             earlier bar or another day; a bar the other instrument did not
//             trade is a hole, not a copy of the one before.
//   "closed"  The feed is on a longer timeframe (its bars last `spanMs`). The
//             latest feed bar that has finished by `t`: open time + spanMs <= t.
//             A feed bar still forming at `t` is never shown, so on the live
//             bar the value is the last closed one, and in history no value
//             contains data from after the bar it is shown on. `spanMs` is the
//             nominal length of the feed's bars; a bar that really closes
//             earlier (a session's last bar) is shown a little later than it
//             could be, never earlier.
//
// Cost: lookups walk forward from the previous answer, so a run over n bars and
// a tick both cost O(1) amortised; a lookup that goes backwards (a revision of
// an older bar) is a binary search.

import { Graph } from "./graph.js";

export type FeedField = "open" | "high" | "low" | "close" | "volume";
export const FEED_FIELDS: readonly FeedField[] = ["open", "high", "low", "close", "volume"];
export type FeedAlign = "same" | "closed";

export interface FeedConfig {
  align: FeedAlign;
  /** Nominal length of one feed bar, ms. Used by "closed" (> 0); ignored by "same". */
  spanMs: number;
}

/** Columnar bars of a feed, in the feed's own time. */
export interface FeedBars {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
}

export interface FeedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A feed as sent to a runner: its bars and how to join them. */
export interface FeedData extends FeedConfig {
  bars: FeedBars;
}

export type FeedChange = "appended" | "revised";

/**
 * A feed is a graph of its own whose bars are the other series' bars: its base columns (time, open, high, low, close,
 * volume) are the series itself, and whatever is computed from it (a script's `ta.rsi(outside(...), 14)`) is computed
 * on those bars, so a window of 14 is 14 of the series' bars whatever the chart's timeframe. The chart's graph reads
 * the result through the join (`Graph.joined`). Loading or ticking the feed evaluates its graph at once.
 */
export class Feed {
  readonly graph = new Graph();
  align: FeedAlign = "same";
  spanMs = 0;
  private cur = 0;

  get n(): number {
    return this.graph.n;
  }

  /** Replace the bars (copied) and the join. Throws, naming `what`, on bars that are not a series. */
  load(bars: FeedBars, cfg: FeedConfig, what = "outside series"): void {
    checkConfig(cfg, what);
    const n = bars.time.length;
    for (const f of FEED_FIELDS) {
      if (!(bars[f] instanceof Float64Array)) throw new TypeError(`${what}: ${f} must be a Float64Array`);
      if (bars[f].length !== n) throw new RangeError(`${what}: ${f} has ${bars[f].length} rows, time has ${n}`);
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(bars.time[i]!)) throw new RangeError(`${what}: time at row ${i} is not a finite number`);
      if (i > 0 && !(bars.time[i]! > bars.time[i - 1]!)) throw new RangeError(`${what}: times must be strictly increasing (row ${i})`);
    }
    const g = this.graph;
    g.clear();
    g.reserve(n);
    g.time.v.set(bars.time);
    for (const f of FEED_FIELDS) g[f].v.set(bars[f]);
    g.n = n;
    g.run(0, n);
    this.cur = 0;
    this.align = cfg.align;
    this.spanMs = cfg.spanMs;
  }

  /** Change how the bars are joined, keeping them. */
  configure(cfg: FeedConfig, what = "outside series"): void {
    checkConfig(cfg, what);
    this.align = cfg.align;
    this.spanMs = cfg.spanMs;
  }

  /** A live bar: the same time as the last bar replaces it, a later time appends; an earlier time throws. */
  apply(b: FeedBar, what = "outside series"): FeedChange {
    const g = this.graph;
    const n = g.n;
    if (!Number.isFinite(b.time)) throw new RangeError(`${what}: bar time is not a finite number`);
    if (n > 0 && b.time < g.time.v[n - 1]!) throw new RangeError(`${what}: bar time ${b.time} is earlier than the last bar ${g.time.v[n - 1]}; load the series again instead`);
    const revise = n > 0 && b.time === g.time.v[n - 1];
    const i = revise ? n - 1 : n;
    if (!revise) {
      g.reserve(n + 1);
      g.n = n + 1;
    }
    g.time.v[i] = b.time;
    for (const f of FEED_FIELDS) g[f].v[i] = b[f];
    g.run(i, i + 1);
    return revise ? "revised" : "appended";
  }

  /** The bars as a runner takes them (copies, length n). */
  snapshot(): FeedBars {
    const g = this.graph, n = g.n;
    return { time: g.time.v.slice(0, n), open: g.open.v.slice(0, n), high: g.high.v.slice(0, n), low: g.low.v.slice(0, n), close: g.close.v.slice(0, n), volume: g.volume.v.slice(0, n) };
  }

  /** Index of the feed bar the study bar at time `t` sees, or -1 when it sees none. */
  lookup(t: number): number {
    const n = this.graph.n;
    if (n === 0 || t !== t) return -1;
    const T = this.graph.time.v;
    const limit = this.align === "same" ? t : t - this.spanMs;
    let j = this.cur < n ? this.cur : n - 1;
    if (T[j]! <= limit) {
      while (j + 1 < n && T[j + 1]! <= limit) j++;
    } else {
      // the answer is before the cursor: last index with time <= limit
      let lo = 0, hi = j;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (T[mid]! <= limit) lo = mid + 1;
        else hi = mid;
      }
      j = lo - 1;
      if (j < 0) return -1;
    }
    this.cur = j;
    if (this.align === "same") return T[j] === t ? j : -1;
    return j;
  }

  value(field: FeedField, i: number): number {
    return i < 0 ? Number.NaN : this.graph[field].v[i]!;
  }
}

function checkConfig(cfg: FeedConfig, what: string): void {
  if (cfg.align !== "same" && cfg.align !== "closed") throw new RangeError(`${what}: align must be "same" or "closed", got ${String(cfg.align)}`);
  if (cfg.align === "closed" && !(Number.isFinite(cfg.spanMs) && cfg.spanMs > 0)) throw new RangeError(`${what}: a "closed" feed needs spanMs > 0, got ${String(cfg.spanMs)}`);
}

/** Row `field` of every bar in `feed` joined onto `times`, as a plain array: the join in one call (for tests and tools). */
export function joinFeed(feed: Feed, field: FeedField, times: ArrayLike<number>): Float64Array {
  const out = new Float64Array(times.length);
  for (let i = 0; i < times.length; i++) out[i] = feed.value(field, feed.lookup(times[i]!));
  return out;
}

export type JoinReason =
  /** Every chart bar sees a feed bar. */
  | "complete"
  /** Some chart bars see a feed bar and some do not (holes in the feed, or the feed starts later or ends earlier). */
  | "partial"
  /** The join finds nothing: the chart has no bars, or the feed has none. */
  | "empty"
  /** Same-length join and the feed's bar times never equal the chart's: the two sit on different clocks (offsetMs). */
  | "different-clock"
  /** Longer-timeframe join and no feed bar has finished by any chart bar (the feed starts after the chart ends, or is too short). */
  | "no-finished-bar";

export interface JoinReport {
  align: FeedAlign;
  chartBars: number;
  /** Chart bars that see a feed bar. A chart bar that sees none is blank (NaN) in everything read from the feed. */
  matched: number;
  reason: JoinReason;
  /**
   * For "different-clock": how far the feed's bars sit from the chart's, in ms, in (-spanMs/2, spanMs/2]: the first feed bar's
   * time minus the first chart bar's, modulo the bar length. NSE hourly bars open at 09:15 and MCX's at 09:00, so a chart on one
   * reading the other gives +900000 or -900000. Otherwise null.
   */
  offsetMs: number | null;
  /** One sentence a host can show where it would otherwise show "blank". */
  message: string;
}

/**
 * Why a join gives what it gives, for a host to explain a blank outside series: how many chart bars `cfg` joins to a bar of `feedTimes`
 * and, when none, the reason. A pure function of the two time columns and the config handed to `setFeed`; it reads no value.
 */
export function describeJoin(chartTimes: ArrayLike<number>, feedTimes: ArrayLike<number>, cfg: FeedConfig): JoinReport {
  checkConfig(cfg, "outside series");
  const n = chartTimes.length, m = feedTimes.length;
  const base = { align: cfg.align, chartBars: n };
  if (n === 0 || m === 0) {
    return { ...base, matched: 0, reason: "empty", offsetMs: null, message: n === 0 ? "The chart has no bars." : "The outside series has no bars." };
  }
  let matched = 0, j = 0;
  for (let i = 0; i < n; i++) {
    const t = chartTimes[i]!;
    if (cfg.align === "same") {
      while (j < m && feedTimes[j]! < t) j++;
      if (j < m && feedTimes[j] === t) matched++;
    } else {
      const limit = t - cfg.spanMs;
      while (j < m && feedTimes[j]! <= limit) j++;
      if (j > 0) matched++;
    }
  }
  if (matched === n) return { ...base, matched, reason: "complete", offsetMs: null, message: "Every chart bar sees a bar of the outside series." };
  if (matched > 0) {
    return { ...base, matched, reason: "partial", offsetMs: null, message: `${n - matched} of ${n} chart bars have no bar of the outside series and are blank (a missing bar is never filled).` };
  }
  if (cfg.align === "closed") {
    return { ...base, matched, reason: "no-finished-bar", offsetMs: null, message: "No bar of the outside series has finished by any chart bar, so every value is blank." };
  }
  let off = (feedTimes[0]! - chartTimes[0]!) % cfg.spanMs;
  if (off > cfg.spanMs / 2) off -= cfg.spanMs;
  else if (off <= -cfg.spanMs / 2) off += cfg.spanMs;
  const min = Math.round(Math.abs(off) / 60_000);
  const how = off === 0
    ? "its bars never fall at the same time as the chart's (the two do not trade at the same times)"
    : `its bars open ${min} minute${min === 1 ? "" : "s"} ${off > 0 ? "after" : "before"} the chart's`;
  return {
    ...base, matched, reason: "different-clock", offsetMs: off,
    message: `No chart bar has a bar of the outside series at exactly its time, so every value is blank: ${how}. A series on the chart's own timeframe joins only at equal times; read a longer timeframe (for example 1d) or a series on the same clock.`,
  };
}
