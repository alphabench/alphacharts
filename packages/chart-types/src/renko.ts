// Renko bricks: a brick is one box of price movement, whatever the time taken.
//
// Levels are anchor + k * box, k an integer, with the anchor the first price
// seen (multiplying, not accumulating, so a long series does not drift). The
// last brick covers [level(kLo), level(kHi)]; initially kLo = kHi = 0.
//   price >= level(kHi + 1)  ->  up brick   [level(kHi), level(kHi + 1)]
//   price <= level(kLo - 1)  ->  down brick [level(kLo - 1), level(kLo)]
// One rule gives both continuation (a box beyond the last brick) and the
// classic two-box reversal (a down brick needs the price one box below where
// the last UP brick started). A price that jumps several boxes makes several
// bricks. Only completed bricks exist; there is no forming brick.
//
// Brick prices are grid levels, not traded prices: open/close are the box
// edges, high/low equal the body (no wicks). Source range: fromTime is when the
// brick's opening level was crossed (the previous brick's completion, or the
// first observation for the first brick), toTime when its closing level was.
//
// Box size: fixed (`box`), or `atrPeriod` n: the box is the mean true range of
// source bars 1..n (bar 0 supplies the first previous close), computed once
// and then fixed. Until n + 1 bars have arrived nothing is drawn; they are
// then replayed. While the window is flat (zero ATR) the oldest bar is dropped
// and warm-up continues, so flat prints never wedge the transform. ATR needs
// bars: trades are rejected.

import type { OhlcBar, Trade } from "@alphacharts/core";
import { PathTransform } from "./path.js";
import { ordinalTime } from "./store.js";

/** Relative tolerance of the level comparisons, in boxes. */
const TOL = 1e-9;

export type RenkoOptions = { box: number } | { atrPeriod: number };

export class Renko extends PathTransform {
  private box: number;
  private readonly atrPeriod: number;
  private warm: OhlcBar[] = [];
  private started = false;
  private anchor = 0;
  private kLo = 0;
  private kHi = 0;
  private openedAt = 0;

  constructor(options: RenkoOptions) {
    super("renko");
    if ("box" in options) {
      if (!(options.box > 0) || !Number.isFinite(options.box)) throw new RangeError(`renko: box must be a positive number, got ${options.box}`);
      this.box = options.box;
      this.atrPeriod = 0;
    } else {
      if (!Number.isInteger(options.atrPeriod) || options.atrPeriod < 1) throw new RangeError(`renko: atrPeriod must be a positive integer, got ${options.atrPeriod}`);
      this.box = Number.NaN;
      this.atrPeriod = options.atrPeriod;
    }
  }

  /** The brick size, or undefined while an ATR box is still warming up. */
  get boxSize(): number | undefined {
    return this.box === this.box ? this.box : undefined;
  }

  protected override acceptBar(b: OhlcBar): void {
    if (this.atrPeriod === 0 || this.box === this.box) return super.acceptBar(b);
    this.warm.push(b);
    if (this.warm.length < this.atrPeriod + 1) return;
    let sum = 0;
    for (let i = 1; i <= this.atrPeriod; i++) {
      const cur = this.warm[i]!, pc = this.warm[i - 1]!.close;
      sum += Math.max(cur.high - cur.low, Math.abs(cur.high - pc), Math.abs(cur.low - pc));
    }
    const atr = sum / this.atrPeriod;
    // Flat bars (a circuit-locked stock) give no box size yet: slide the window until prices move.
    if (!(atr > 0)) {
      this.warm.shift();
      return;
    }
    this.box = atr;
    const warm = this.warm;
    this.warm = [];
    for (const w of warm) super.acceptBar(w);
  }

  protected override acceptTrade(_t: Trade): void {
    if (this.atrPeriod > 0) throw new TypeError("renko: an ATR box needs bars; trades are not accepted");
    super.acceptTrade(_t);
  }

  protected point(time: number, price: number): void {
    if (!this.started) {
      this.started = true;
      this.anchor = price;
      this.openedAt = time;
      return;
    }
    const B = this.box, a = this.anchor, s = this.store;
    // Thresholds are compared in box units with a 1e-9 tolerance: (1.2 - 1.1) / 0.1 is 0.9999999999999998 and must count as one box.
    const q = (price - a) / B;
    for (;;) {
      let open: number, close: number;
      if (q >= this.kHi + 1 - TOL) {
        open = a + this.kHi * B;
        close = a + (this.kHi + 1) * B;
        this.kLo = this.kHi;
        this.kHi++;
      } else if (q <= this.kLo - 1 + TOL) {
        open = a + this.kLo * B;
        close = a + (this.kLo - 1) * B;
        this.kHi = this.kLo;
        this.kLo--;
      } else return;
      s.append(ordinalTime(s.length), open, Math.max(open, close), Math.min(open, close), close, this.openedAt, time);
      this.openedAt = time;
    }
  }
}
