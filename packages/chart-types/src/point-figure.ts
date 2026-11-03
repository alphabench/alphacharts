// Point & Figure: columns of X (rising) and O (falling) on a grid of boxes.
//
// Box-entry convention: box k covers [k * box, (k + 1) * box) and counts as soon
// as the price is inside it (so reversal is measured in boxes entered, the usual
// 3-box rule: from top box 10, price in box 7 reverses). A price is in box floor(price / box)
// (a 1e-9 box tolerance keeps 100.3 / 0.1 out of box 1002). `reversal` (default
// 3) is the number of boxes the price must retrace to turn a column.
//   X column:  box > top -> top = box.   box <= top - reversal -> new O column
//              from top - 1 down to box.
//   O column:  box < bottom -> bottom = box.   box >= bottom + reversal -> new X
//              column from bottom + 1 up to box.
// Before the first column the first price fixes a start box; the first price in
// a higher box starts an X column from the start box up, in a lower box an O
// column from the start box down. A column always spans whole boxes.
//
// Derived bar per column: X has open = bottom edge, close = top edge; O the
// reverse; high/low are the column's edges. These are GRID prices (box edges),
// not traded prices, exactly as a P&F chart shows them. Source range: fromTime
// is when the column's first box was entered (the previous column's extreme
// time, or the first observation), toTime the latest extension. The last column
// is live and is rewritten while it extends. The dedicated renderer
// (`point-figure` series) draws one X or O per box from the column and `box`.

import { PathTransform } from "./path.js";
import { ordinalTime } from "./store.js";

export class PointFigure extends PathTransform {
  private started = false;
  private startBox = 0;
  private startTime = 0;
  private dir = 0;
  private top = 0;
  private bottom = 0;
  private colFrom = 0;

  constructor(readonly box: number, readonly reversal = 3) {
    super("point-figure");
    if (!(box > 0) || !Number.isFinite(box)) throw new RangeError(`point-figure: box must be a positive number, got ${box}`);
    if (!Number.isInteger(reversal) || reversal < 1) throw new RangeError(`point-figure: reversal must be a positive integer, got ${reversal}`);
  }

  private boxOf(price: number): number {
    return Math.floor(price / this.box + 1e-9);
  }

  protected point(time: number, price: number): void {
    const b = this.boxOf(price);
    if (!this.started) {
      this.started = true;
      this.startBox = b;
      this.startTime = time;
      return;
    }
    const r = this.reversal;
    if (this.dir === 0) {
      if (b === this.startBox) return;
      this.dir = b > this.startBox ? 1 : -1;
      this.bottom = this.dir > 0 ? this.startBox : b;
      this.top = this.dir > 0 ? b : this.startBox;
      this.colFrom = this.startTime;
      this.write(true, time);
    } else if (this.dir > 0) {
      if (b > this.top) {
        this.top = b;
        this.write(false, time);
      } else if (b <= this.top - r) {
        this.colFrom = this.store.toTime[this.store.length - 1]!;
        this.dir = -1;
        this.top = this.top - 1;
        this.bottom = b;
        this.write(true, time);
      }
    } else if (b < this.bottom) {
      this.bottom = b;
      this.write(false, time);
    } else if (b >= this.bottom + r) {
      this.colFrom = this.store.toTime[this.store.length - 1]!;
      this.dir = 1;
      this.bottom = this.bottom + 1;
      this.top = b;
      this.write(true, time);
    }
  }

  private write(create: boolean, time: number): void {
    const s = this.store, i = create ? s.length : s.length - 1;
    const lo = this.bottom * this.box, hi = (this.top + 1) * this.box;
    s.set(i, ordinalTime(i), this.dir > 0 ? lo : hi, hi, lo, this.dir > 0 ? hi : lo, this.colFrom, time);
  }
}
