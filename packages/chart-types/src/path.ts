// Input checking and the shared driver for transforms that read a price path.
//
// Renko, range bars, Kagi and Point & Figure react to prices crossing levels,
// so they read a stream of (time, price) observations. Two sources feed them:
//
//   Trades  Every trade is one observation: exact, in arrival order.
//   Bars    A bar is four observations, in the order
//             close >= open:  open, low, high, close
//             close <  open:  open, high, low, close
//           Which extreme came first inside a bar is NOT in OHLC data; this is
//           the usual convention (the move to the nearer-to-close extreme last)
//           and it only matters when one bar crosses levels on both sides, e.g.
//           a Renko bar that is a brick up and a brick down at once. Every price
//           visited is a real bar price, none is interpolated. For an exact
//           build, feed trades.
//
// Both sources are validated before any state changes: a bad row throws with
// its 0-based row number (counted across every push call) and leaves the
// transform exactly as it was after the previous good row.
//
// push*() return the lowest derived-bar index that changed. Bars below it are
// untouched; the bar at it (when it already existed) was modified in place, and
// every bar above it is new. That is the delta syncSeries() applies.

import type { OhlcBar, Trade } from "@alphacharts/core";
import { BarStore } from "./store.js";

export function checkBar(name: string, row: number, b: OhlcBar, prevTime: number): void {
  const { time: t, open: o, high: h, low: l, close: c } = b;
  if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
    throw new TypeError(`${name}: row ${row}: time, open, high, low and close must be finite numbers`);
  }
  if (t <= prevTime) throw new RangeError(`${name}: row ${row}: time ${t} is not after the previous bar's ${prevTime}`);
  if (!(l <= o && l <= c && h >= o && h >= c)) {
    throw new RangeError(`${name}: row ${row} (time ${t}): needs low <= open, close <= high; got o=${o} h=${h} l=${l} c=${c}`);
  }
}

export function checkTrade(name: string, row: number, tr: Trade, prevTime: number): void {
  if (!Number.isFinite(tr.time) || !Number.isFinite(tr.price) || !Number.isFinite(tr.size)) {
    throw new TypeError(`${name}: row ${row}: time, price and size must be finite numbers`);
  }
  if (tr.time < prevTime) throw new RangeError(`${name}: row ${row}: trade time ${tr.time} is before the previous trade's ${prevTime}`);
  if (!(tr.price > 0)) throw new RangeError(`${name}: row ${row}: trade price ${tr.price} must be positive`);
  if (!(tr.size > 0)) throw new RangeError(`${name}: row ${row}: trade size ${tr.size} must be positive`);
}

/** Base for transforms driven by a price path. */
export abstract class PathTransform {
  readonly store: BarStore;
  /** Inputs accepted so far; the next row's number. */
  protected rows = 0;
  protected lastTime = Number.NEGATIVE_INFINITY;

  protected constructor(protected readonly name: string, withVolume = false) {
    this.store = new BarStore(withVolume);
  }

  /** One observation. Called in order; times never decrease. */
  protected abstract point(time: number, price: number): void;

  /** Append one closed source bar (strictly later than the last). Returns the lowest changed derived index. */
  pushBar(bar: OhlcBar): number {
    checkBar(this.name, this.rows, bar, this.lastTime);
    this.acceptBar(bar);
    this.rows++;
    this.lastTime = bar.time;
    return this.finish();
  }

  /** Append one trade. Returns the lowest changed derived index. */
  pushTrade(trade: Trade): number {
    checkTrade(this.name, this.rows, trade, this.lastTime);
    this.acceptTrade(trade);
    this.rows++;
    this.lastTime = trade.time;
    return this.finish();
  }

  pushBars(bars: readonly OhlcBar[]): number {
    let from = this.store.length;
    for (const b of bars) from = Math.min(from, this.pushBar(b));
    return Math.min(from, this.store.length);
  }

  pushTrades(trades: readonly Trade[]): number {
    let from = this.store.length;
    for (const t of trades) from = Math.min(from, this.pushTrade(t));
    return Math.min(from, this.store.length);
  }

  protected acceptBar(b: OhlcBar): void {
    const t = b.time;
    this.point(t, b.open);
    if (b.close >= b.open) {
      this.point(t, b.low);
      this.point(t, b.high);
    } else {
      this.point(t, b.high);
      this.point(t, b.low);
    }
    this.point(t, b.close);
  }

  protected acceptTrade(tr: Trade): void {
    this.point(tr.time, tr.price);
  }

  /** Lowest changed index, resetting the store's mark. Subclasses with more stores extend it. */
  protected finish(): number {
    return this.store.takeDirty();
  }
}
