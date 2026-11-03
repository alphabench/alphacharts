// Tick, volume and dollar bars: bars that close on activity, not on the clock.
//
//   tick    closes after `size` trades
//   volume  closes after `size` units traded
//   dollar  closes after `size` of price * quantity traded
// Volume and dollar bars are exact: a trade that crosses the threshold is split,
// the part that fills the bar goes into it and the rest opens the next bar (or
// several, for a trade bigger than a bar). Every trade's price is a real traded
// price; no price is interpolated. A tick bar never splits a trade.
//
// open/high/low/close come from the trades' prices; `volume` is the quantity in
// the bar (a split trade contributes its share; for dollar bars the share is
// the filled notional / trade price). The LAST bar is the forming bar; every
// earlier bar is complete. Source range: first and last trade time in the bar.
// Trades with equal times keep arrival order.

import type { Trade } from "@alphacharts/core";
import { checkTrade } from "./path.js";
import { BarStore, ordinalTime } from "./store.js";

export type TradeBarKind = "tick" | "volume" | "dollar";

export class TradeBars {
  readonly store = new BarStore(true);
  private rows = 0;
  private lastTime = Number.NEGATIVE_INFINITY;
  /** The last bar in the store is forming. */
  private forming = false;
  /** Progress of the forming bar toward `size`, in the kind's unit. */
  private acc = 0;

  constructor(readonly kind: TradeBarKind, readonly size: number) {
    if (!(size > 0) || !Number.isFinite(size)) throw new RangeError(`${kind}-bars: size must be a positive number, got ${size}`);
    if (kind === "tick" && !Number.isInteger(size)) throw new RangeError(`tick-bars: size must be a whole number of trades, got ${size}`);
  }

  /** Append one trade. Returns the lowest derived index that changed. */
  push(trade: Trade): number {
    const name = `${this.kind}-bars`;
    checkTrade(name, this.rows, trade, this.lastTime);
    const { time, price } = trade;
    let left = trade.size;
    const s = this.store;
    const eps = this.size * 1e-12;
    while (left > 0) {
      if (!this.forming) {
        s.append(ordinalTime(s.length), price, price, price, price, time, time, 0);
        this.forming = true;
        this.acc = 0;
      }
      const i = s.length - 1;
      // How much of this trade the bar can still take, in the kind's unit and in quantity.
      const unit = this.kind === "tick" ? 1 : this.kind === "volume" ? left : left * price;
      const room = this.size - this.acc;
      const full = unit >= room - eps;
      const take = this.kind === "tick" ? left : full ? (this.kind === "volume" ? room : room / price) : left;
      s.set(i, s.time[i]!, s.open[i]!, Math.max(s.high[i]!, price), Math.min(s.low[i]!, price), price, s.fromTime[i]!, time, s.volume![i]! + take);
      if (full) {
        this.forming = false;
        left = this.kind === "tick" ? 0 : left - take;
        if (left <= (this.kind === "volume" ? eps : eps / price)) left = 0;
      } else {
        this.acc += unit;
        left = 0;
      }
    }
    this.rows++;
    this.lastTime = time;
    return s.takeDirty();
  }

  pushAll(trades: readonly Trade[]): number {
    let from = this.store.length;
    for (const t of trades) from = Math.min(from, this.push(t));
    return Math.min(from, this.store.length);
  }
}
