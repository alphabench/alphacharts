// Custom timeframes: bars of any resolution built from a finer one.
//
// Buckets, in the chart's time zone:
//   s, m, h  aligned to the session open when a calendar is given (a 75-minute
//            bar on NSE starts 09:15, 10:30, …), else to local midnight;
//   D        one trading day (session) or one local calendar day; nD groups
//            n calendar days counted from the epoch;
//   W        weeks starting Monday 00:00 local;
//   M        calendar months; nM groups n months counted from year 0.
// A bucket's time is its start. Incremental: push() folds live source bars
// in, and a revised last source bar (a tick update) replaces its previous
// contribution instead of being added twice.

import { DAY_MS, TimeZone } from "./tz.js";
import { Sessions, type SessionSpec } from "./session.js";

export type ResolutionUnit = "s" | "m" | "h" | "D" | "W" | "M";
export interface Resolution {
  unit: ResolutionUnit;
  n: number;
}

/** "30s", "5m", "75m", "4h", "1D", "1W", "3M" (also "15" = 15 minutes, "D" = 1D). */
export function parseResolution(s: string): Resolution {
  const m = /^(\d+)?([smhDWM])?$/.exec(s.trim());
  if (!m || (!m[1] && !m[2])) throw new RangeError(`resolution "${s}": expected e.g. 30s, 5m, 4h, 1D, 1W, 3M`);
  const n = m[1] ? Number(m[1]) : 1;
  if (!(n >= 1) || !Number.isInteger(n)) throw new RangeError(`resolution "${s}": count must be a positive integer`);
  return { unit: (m[2] ?? "m") as ResolutionUnit, n };
}

export interface ResampledBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const MS = { s: 1000, m: 60_000, h: 3_600_000 } as const;

export class Resampler {
  private readonly tz: TimeZone;
  private readonly sessions: Sessions | null;
  /** Aggregate of the bucket's source bars except the last one. */
  private base: ResampledBar | null = null;
  private last: { time: number; bar: ResampledBar } | null = null;
  private bucket = Number.NaN;

  constructor(readonly res: Resolution, opts: { timeZone?: string; sessions?: SessionSpec } = {}) {
    if (!(res.n >= 1) || !Number.isInteger(res.n)) throw new RangeError(`resolution count must be a positive integer, got ${res.n}`);
    this.sessions = opts.sessions ? new Sessions(opts.sessions) : null;
    this.tz = this.sessions ? this.sessions.tz : new TimeZone(opts.timeZone ?? "UTC");
  }

  /** Start (UTC ms) of the bucket containing t. */
  bucketStart(t: number): number {
    const { unit, n } = this.res;
    const tz = this.tz;
    if (unit === "s" || unit === "m" || unit === "h") {
      const len = MS[unit] * n;
      const anchor = this.sessions ? this.sessions.sessionStart(t) : tz.fromLocal(Math.floor((t + tz.offset(t)) / DAY_MS) * DAY_MS);
      return anchor + Math.floor((t - anchor) / len) * len;
    }
    const local = t + tz.offset(t);
    if (unit === "D") {
      if (this.sessions && n === 1) return this.sessions.sessionStart(t);
      const day = Math.floor(local / DAY_MS);
      return tz.fromLocal(Math.floor(day / n) * n * DAY_MS);
    }
    if (unit === "W") {
      // Day 4 (1970-01-05) is the first Monday; weeks count from it.
      const day = Math.floor(local / DAY_MS);
      const week = Math.floor((day - 4) / 7);
      return tz.fromLocal((4 + Math.floor(week / n) * n * 7) * DAY_MS);
    }
    const c = tz.civil(t);
    const idx = Math.floor((c.year * 12 + (c.month - 1)) / n) * n;
    return tz.fromLocal(Date.UTC(Math.floor(idx / 12), idx % 12, 1));
  }

  /**
   * Fold one source bar in. Returns the bucket's bar and whether it replaced
   * the previous result (same bucket) or starts a new one. Source times must
   * not go backwards; the same time again is a revision of the last bar.
   */
  push(src: { time: number; open: number; high: number; low: number; close: number; volume?: number }): { bar: ResampledBar; replaced: boolean } {
    const v: ResampledBar = { time: src.time, open: src.open, high: src.high, low: src.low, close: src.close, volume: src.volume ?? 0 };
    if (this.last && src.time < this.last.time) throw new RangeError(`resample: source time ${src.time} is before the previous ${this.last.time}`);
    const b = this.bucketStart(src.time);
    if (b !== this.bucket) {
      this.bucket = b;
      this.base = null;
      this.last = { time: src.time, bar: v };
      return { bar: { ...v, time: b }, replaced: false };
    }
    if (this.last && this.last.time === src.time) {
      this.last = { time: src.time, bar: v }; // revision
    } else {
      this.base = this.base ? merge(this.base, this.last!.bar) : this.last!.bar;
      this.last = { time: src.time, bar: v };
    }
    const agg = this.base ? merge(this.base, v) : v;
    return { bar: { ...agg, time: b }, replaced: true };
  }

  /** Resample a whole history. */
  static batch(
    res: Resolution,
    src: { time: ArrayLike<number>; open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>; volume?: ArrayLike<number> },
    opts: { timeZone?: string; sessions?: SessionSpec } = {},
  ): ResampledBar[] {
    const r = new Resampler(res, opts);
    const out: ResampledBar[] = [];
    for (let i = 0; i < src.time.length; i++) {
      const { bar, replaced } = r.push({ time: src.time[i]!, open: src.open[i]!, high: src.high[i]!, low: src.low[i]!, close: src.close[i]!, volume: src.volume ? src.volume[i]! : 0 });
      if (replaced) out[out.length - 1] = bar;
      else out.push(bar);
    }
    return out;
  }
}

function merge(a: ResampledBar, b: ResampledBar): ResampledBar {
  return { time: a.time, open: a.open, high: Math.max(a.high, b.high), low: Math.min(a.low, b.low), close: b.close, volume: a.volume + b.volume };
}
