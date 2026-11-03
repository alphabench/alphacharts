// Range bars: every bar spans exactly `range` of price (high - low), however
// long that takes.
//
// A bar opens at the first price after the previous bar closed (the previous
// close level for a continuation). While the price stays inside, the bar
// updates (high, low, close = latest). When a price reaches low + range the
// bar closes up with high = close = low + range; when it reaches high - range
// it closes down with low = close = high - range. The next bar opens at that
// boundary and the same price is applied to it, so a price that jumps several
// ranges makes several bars.
//
// open/high/low/close are therefore source prices except the closing boundary,
// which is the level the price crossed (low + range, one addition per bar, so a
// long run can differ from the ideal level in the last binary digits). The LAST bar is the forming bar
// (not yet at full range) and changes with every observation; every earlier bar
// is final. Source range: first and last observation that touched the bar.

import { PathTransform } from "./path.js";
import { ordinalTime } from "./store.js";

/** Relative tolerance of the range comparisons: 1.2 - 1.1 is 0.0999999999999998, one range of 0.1. */
const TOL = 1e-9;

export class RangeBars extends PathTransform {
  /** True while the last bar in the store is still forming. */
  private forming = false;

  constructor(private readonly range: number) {
    super("range-bars");
    if (!(range > 0) || !Number.isFinite(range)) throw new RangeError(`range-bars: range must be a positive number, got ${range}`);
  }

  protected point(time: number, price: number): void {
    const s = this.store, R = this.range;
    if (!this.forming) {
      s.append(ordinalTime(s.length), price, price, price, price, time, time);
      this.forming = true;
      return;
    }
    for (;;) {
      const i = s.length - 1;
      const o = s.open[i]!, h = s.high[i]!, l = s.low[i]!, from = s.fromTime[i]!;
      const t = ordinalTime(i);
      if (price - l >= R * (1 - TOL)) {
        s.set(i, t, o, l + R, l, l + R, from, time);
        s.append(ordinalTime(i + 1), l + R, l + R, l + R, l + R, time, time);
      } else if (h - price >= R * (1 - TOL)) {
        s.set(i, t, o, h, h - R, h - R, from, time);
        s.append(ordinalTime(i + 1), h - R, h - R, h - R, h - R, time, time);
      } else {
        s.set(i, t, o, Math.max(h, price), Math.min(l, price), price, from, time);
        return;
      }
    }
  }
}
