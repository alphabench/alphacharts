// Columnar trade store: typed arrays, amortised O(1) append (capacity doubles),
// time non-decreasing. A trade older than the last stored one is an error, not
// something to re-sort: every aggregate built from the store (bars, levels,
// cumulative delta) is incremental and would silently go stale.

import type { Trade } from "@alphacharts/core";

export const SIDE_BUY = 1;
export const SIDE_SELL = -1;
export const SIDE_UNKNOWN = 0;

export function sideCode(side: Trade["side"], where: string): number {
  switch (side) {
    case "buy": return SIDE_BUY;
    case "sell": return SIDE_SELL;
    case "unknown": return SIDE_UNKNOWN;
    default: throw new TypeError(`orderflow: ${where}: side must be "buy", "sell" or "unknown", got ${String(side)}`);
  }
}

/** Throws unless the trade is usable; `where` names the row for the message. */
export function validateTrade(t: Trade, where: string): number {
  if (!Number.isFinite(t.time)) throw new TypeError(`orderflow: ${where}: time ${t.time} is not a finite number`);
  if (!Number.isFinite(t.price) || !(t.price > 0)) throw new RangeError(`orderflow: ${where}: price ${t.price} must be a positive finite number`);
  if (!Number.isFinite(t.size) || !(t.size > 0)) throw new RangeError(`orderflow: ${where}: size ${t.size} must be a positive finite number`);
  return sideCode(t.side, where);
}

export class TradeStore {
  private cap: number;
  private t: Float64Array;
  private p: Float64Array;
  private s: Float64Array;
  private d: Int8Array;
  private n = 0;

  constructor(initialCapacity = 1024) {
    if (!(initialCapacity >= 1)) throw new RangeError("orderflow: initialCapacity must be >= 1");
    this.cap = Math.floor(initialCapacity);
    this.t = new Float64Array(this.cap);
    this.p = new Float64Array(this.cap);
    this.s = new Float64Array(this.cap);
    this.d = new Int8Array(this.cap);
  }

  get length(): number {
    return this.n;
  }
  /** Time of the last trade, or -Infinity when empty. */
  get lastTime(): number {
    return this.n ? this.t[this.n - 1]! : Number.NEGATIVE_INFINITY;
  }

  time(i: number): number { return this.at(i, this.t); }
  price(i: number): number { return this.at(i, this.p); }
  size(i: number): number { return this.at(i, this.s); }
  /** +1 buy, -1 sell, 0 unknown. */
  side(i: number): number { return this.at(i, this.d); }

  private at(i: number, a: ArrayLike<number>): number {
    if (!(i >= 0 && i < this.n)) throw new RangeError(`orderflow: trade index ${i} outside [0, ${this.n})`);
    return a[i]!;
  }

  /** Append one trade; `code` is the validated side code. */
  push(time: number, price: number, size: number, code: number): void {
    if (time < this.lastTime) {
      throw new RangeError(`orderflow: trade #${this.n} at ${time} is older than the last stored trade (${this.lastTime}); trades must arrive in time order`);
    }
    if (this.n === this.cap) this.grow();
    const n = this.n++;
    this.t[n] = time;
    this.p[n] = price;
    this.s[n] = size;
    this.d[n] = code;
  }

  /** First index with time >= `time` (length when none). */
  lowerBound(time: number): number {
    let lo = 0, hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.t[mid]! < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const t = new Float64Array(cap), p = new Float64Array(cap), s = new Float64Array(cap), d = new Int8Array(cap);
    t.set(this.t); p.set(this.p); s.set(this.s); d.set(this.d);
    this.t = t; this.p = p; this.s = s; this.d = d;
    this.cap = cap;
  }
}
