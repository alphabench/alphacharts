// Order-flow bars: one record per bar that has at least one trade, built
// incrementally from trades and aligned to the chart's bars by a bar clock.
//
// A bar's open/high/low/close are the first, highest, lowest and last trade
// price; volumes, delta and levels are exact sums of the trades given. Delta is
// buy volume minus sell volume; "unknown"-side volume is excluded from it and
// kept in its own total. Bars are columnar (typed arrays) so a million trades
// cost a few thousand records, not objects per trade.
//
// `approximate` is true when the bars were not built from trades (see
// OrderFlow.fromBars): sides are then unknown, volume is spread over the bar's
// range, and nothing derived from it may be shown as exact.

import { LevelGrid } from "./levels.js";
import type { Sessions } from "./sessions.js";

export interface BarClock {
  /** Start (UTC ms) of the bar containing `time`; non-decreasing in `time`. */
  barStart(time: number): number;
  /** Fixed bar length when there is one (lets TPO periods be checked against it). */
  readonly periodMs?: number;
}

/** Fixed-length bars: floor(time / periodMs) · periodMs, shifted by `anchorMs`. */
export function fixedClock(periodMs: number, anchorMs = 0): BarClock {
  if (!Number.isFinite(periodMs) || periodMs <= 0) throw new RangeError(`orderflow: periodMs ${periodMs} must be positive`);
  return { barStart: (t) => Math.floor((t - anchorMs) / periodMs) * periodMs + anchorMs, periodMs };
}

/**
 * Bars that start where the feed's own bars start. A bar's start is the
 * latest of `bars` at or before the trade; past the last bar the period is
 * stepped on from it (a bar the feed has not sent yet). Needed whenever the
 * feed's bars are not aligned to the UTC epoch: an exchange session that opens
 * at 09:15 local has 30-minute bars at :15 and :45, which no `fixedClock` of
 * the epoch reproduces. A trade before the first bar, or in a gap between
 * bars (outside every session), has no bar and throws.
 */
export function barsClock(bars: { readonly length: number; timeAt(i: number): number }, periodMs: number): BarClock {
  if (!Number.isFinite(periodMs) || periodMs <= 0) throw new RangeError(`orderflow: periodMs ${periodMs} must be positive`);
  return {
    periodMs,
    barStart(time) {
      const n = bars.length;
      if (n === 0) throw new RangeError("orderflow: barsClock has no bars to place a trade in");
      let lo = 0, hi = n; // first bar starting after `time`
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (bars.timeAt(mid) <= time) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) throw new RangeError(`orderflow: trade at ${time} is before the first bar (${bars.timeAt(0)})`);
      const start = bars.timeAt(lo - 1);
      if (lo === n) return start + Math.floor((time - start) / periodMs) * periodMs;
      if (time >= start + periodMs) throw new RangeError(`orderflow: trade at ${time} falls between bars (${start} and ${bars.timeAt(lo)})`);
      return start;
    },
  };
}

export interface FlowBarsOptions {
  tickSize: number;
  clock: BarClock;
  /** Sessions for per-session cumulative delta resets; omit for one running total. */
  sessions?: Sessions | undefined;
  resetCvdBySession?: boolean | undefined;
}

export function decimalsOf(x: number): number {
  let d = 0;
  while (d < 12 && Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) > 1e-9 * Math.max(1, x * 10 ** d)) d++;
  return d;
}

export class FlowBars {
  readonly tickSize: number;
  readonly clock: BarClock;
  readonly sessions: Sessions | undefined;
  private readonly resetCvd: boolean;
  private readonly dec: number;

  private n = 0;
  private cap = 64;
  start = new Float64Array(this.cap);
  open = new Float64Array(this.cap);
  high = new Float64Array(this.cap);
  low = new Float64Array(this.cap);
  close = new Float64Array(this.cap);
  buy = new Float64Array(this.cap);
  sell = new Float64Array(this.cap);
  unknown = new Float64Array(this.cap);
  trades = new Float64Array(this.cap);
  /** Running delta at the bar's start, and its extremes inside the bar (incl. the start). */
  cvdOpen = new Float64Array(this.cap);
  cvdHigh = new Float64Array(this.cap);
  cvdLow = new Float64Array(this.cap);
  /** Session id per bar (0 when no sessions). */
  session = new Float64Array(this.cap);
  readonly grids: LevelGrid[] = [];

  /** Bumped on every change; caches key on it. */
  version = 0;
  /** True when every size seen so far was a whole number (profile deltas then stay exact). */
  integerSizes = true;
  /** Built from bars, not trades. Set once by OrderFlow.fromBars. */
  approximate = false;

  /** Time of the last trade added (-Infinity before any). */
  lastTradeTime = Number.NEGATIVE_INFINITY;

  constructor(o: FlowBarsOptions) {
    if (!Number.isFinite(o.tickSize) || o.tickSize <= 0) throw new RangeError(`orderflow: tickSize ${o.tickSize} must be positive`);
    this.tickSize = o.tickSize;
    this.clock = o.clock;
    this.sessions = o.sessions;
    this.resetCvd = o.resetCvdBySession === true;
    if (this.resetCvd && !o.sessions) throw new TypeError("orderflow: resetCvdBySession needs sessions");
    this.dec = decimalsOf(o.tickSize);
  }

  get length(): number {
    return this.n;
  }

  /** Tick index of a price; throws when the price is not on the tick grid. */
  tickOf(price: number, where = "trade"): number {
    const k = Math.round(price / this.tickSize);
    if (Math.abs(price - k * this.tickSize) > this.tickSize * 1e-6) {
      throw new RangeError(`orderflow: ${where} price ${price} is not a multiple of tickSize ${this.tickSize}`);
    }
    return k;
  }

  /** Price of tick index k, rounded to the tick size's decimals (no float drift). */
  priceOf(k: number): number {
    return Number((k * this.tickSize).toFixed(this.dec));
  }

  /** Delta of bar i: buy minus sell, unknown excluded. */
  delta(i: number): number {
    return this.buy[i]! - this.sell[i]!;
  }
  volume(i: number): number {
    return this.buy[i]! + this.sell[i]! + this.unknown[i]!;
  }
  /** Running delta at the end of bar i. */
  cvdClose(i: number): number {
    return this.cvdOpen[i]! + this.delta(i);
  }

  /** Index of the bar starting exactly at `start`, or -1. */
  indexOfStart(start: number): number {
    const i = this.lowerBoundStart(start);
    return i < this.n && this.start[i] === start ? i : -1;
  }

  /** Index of the bar containing `time`, or -1 (no bar, or before the first). */
  indexAtOrBefore(time: number): number {
    const i = this.lowerBoundStart(time);
    if (i < this.n && this.start[i] === time) return i;
    return i - 1;
  }

  /** First bar with start >= t. */
  lowerBoundStart(t: number): number {
    let lo = 0, hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.start[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Add one validated trade (side code +1/-1/0). Returns the bar index it landed
   * in. Throws when the trade is older than the previous one.
   */
  add(time: number, price: number, size: number, side: number): number {
    if (this.approximate) throw new Error("orderflow: bars built from bars (approximate) cannot take trades");
    if (time < this.lastTradeTime) {
      throw new RangeError(`orderflow: trade at ${time} is older than the previous trade (${this.lastTradeTime})`);
    }
    const k = this.tickOf(price);
    const start = this.clock.barStart(time);
    let i = this.n - 1;
    if (i < 0 || start > this.start[i]!) i = this.open_(start, price);
    else if (start < this.start[i]!) throw new RangeError(`orderflow: bar clock went backwards (${start} after ${this.start[i]})`);
    else {
      if (price > this.high[i]!) this.high[i] = price;
      if (price < this.low[i]!) this.low[i] = price;
      this.close[i] = price;
    }
    this.lastTradeTime = time;
    this.grids[i]!.add(k, side, size);
    if (side > 0) this.buy[i]! += size;
    else if (side < 0) this.sell[i]! += size;
    else this.unknown[i]! += size;
    this.trades[i]! += 1;
    if (side !== 0) {
      const c = this.cvdOpen[i]! + this.delta(i);
      if (c > this.cvdHigh[i]!) this.cvdHigh[i] = c;
      if (c < this.cvdLow[i]!) this.cvdLow[i] = c;
    }
    if (size !== Math.floor(size)) this.integerSizes = false;
    this.version++;
    return i;
  }

  /** @internal Append a bar record built outside the trade path (approximation only). */
  appendApproximate(start: number, open: number, high: number, low: number, close: number, volume: number): number {
    if (this.n > 0 && start <= this.start[this.n - 1]!) throw new RangeError(`orderflow: bar start ${start} is not after the previous bar (${this.start[this.n - 1]})`);
    const i = this.open_(start, open);
    this.high[i] = high;
    this.low[i] = low;
    this.close[i] = close;
    const kLo = this.tickOf(low, "bar low"), kHi = this.tickOf(high, "bar high");
    const rows = kHi - kLo + 1;
    // Equal share per level over [low, high]: a labelled approximation, nothing more.
    const share = volume / rows;
    if (share !== Math.floor(share)) this.integerSizes = false;
    for (let k = kLo; k <= kHi; k++) this.grids[i]!.addUnknownVolume(k, share);
    this.unknown[i] = volume;
    if (volume !== Math.floor(volume)) this.integerSizes = false;
    this.version++;
    return i;
  }

  private open_(start: number, price: number): number {
    if (this.n === this.cap) this.growCols();
    const i = this.n++;
    const prev = i - 1;
    this.start[i] = start;
    this.open[i] = this.high[i] = this.low[i] = this.close[i] = price;
    this.buy[i] = this.sell[i] = this.unknown[i] = this.trades[i] = 0;
    const sid = this.sessions ? this.sessions.id(start) : 0;
    this.session[i] = sid;
    let base = 0;
    if (prev >= 0 && !(this.resetCvd && this.session[prev] !== sid)) base = this.cvdClose(prev);
    this.cvdOpen[i] = this.cvdHigh[i] = this.cvdLow[i] = base;
    this.grids.push(new LevelGrid());
    return i;
  }

  private growCols(): void {
    this.cap *= 2;
    for (const key of ["start", "open", "high", "low", "close", "buy", "sell", "unknown", "trades", "cvdOpen", "cvdHigh", "cvdLow", "session"] as const) {
      const a = new Float64Array(this.cap);
      a.set(this[key]);
      this[key] = a;
    }
  }
}
