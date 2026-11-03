// Synthetic trade tape for the order-flow example and benches. Dev only: the
// library ships no data. Sessions run 09:15-15:30 IST (03:45-10:00 UTC); inside
// one, trades arrive in a quiet regime (about one a second) and in bursts
// (tens of milliseconds apart) that push price one way and make the aggressor
// side follow the move (a bar spans a handful of ticks); about 3% of trades carry no side. Prices sit on a
// `tick` grid; sizes are mostly small with rare blocks.

import type { Trade } from "@alphacharts/core";
import { rng } from "./synthetic.js";

const OPEN = (3 * 60 + 45) * 60_000;
const CLOSE = 10 * 3_600_000;
const DAY = 86_400_000;

export class TradeTape {
  private readonly r: () => number;
  private t: number;
  private k: number;
  private burst = 0;
  private dir = 1;
  private anchor: number;

  /** `startDay` is UTC midnight of the first session day. */
  constructor(readonly tick: number, startDay: number, startPrice: number, seed: number) {
    this.r = rng(seed);
    this.t = startDay + OPEN;
    this.k = Math.round(startPrice / tick);
    this.anchor = this.k;
  }

  next(): Trade {
    const r = this.r;
    if (this.burst === 0 && r() < 0.012) {
      this.burst = 10 + Math.floor(r() * 90);
      this.dir = r() < 0.5 ? -1 : 1;
    }
    const inBurst = this.burst > 0;
    this.t += Math.max(1, Math.round(inBurst ? -Math.log(1 - r()) * 60 : -Math.log(1 - r()) * 1000));
    if (this.t % DAY >= CLOSE) this.t += DAY - (this.t % DAY) + OPEN;
    let step: number;
    if (inBurst) {
      this.burst--;
      const u = r();
      step = u < 0.045 ? this.dir : u < 0.06 ? -this.dir : 0;
    } else {
      // Quiet: pull back to the anchor, which itself drifts slowly.
      if (r() < 0.0008) this.anchor += r() < 0.5 ? -1 : 1;
      const pull = Math.sign(this.anchor - this.k);
      step = r() < 0.02 ? (r() < 0.5 ? pull : -pull) : 0;
    }
    this.k += step;
    const u = r();
    // The aggressor tends to follow the last move; no side for a few percent.
    const buyP = step > 0 ? 0.72 : step < 0 ? 0.28 : 0.5;
    const side: Trade["side"] = u < 0.03 ? "unknown" : r() < buyP ? "buy" : "sell";
    const sz = r() < 0.01 ? 100 + Math.floor(r() * 400) : 1 + Math.floor(-Math.log(1 - r()) * 12);
    return { time: this.t, price: Number((this.k * this.tick).toFixed(4)), size: sz, side };
  }

  take(n: number): Trade[] {
    const out = new Array<Trade>(n);
    for (let i = 0; i < n; i++) out[i] = this.next();
    return out;
  }
}
