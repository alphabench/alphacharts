// Kagi: one vertical line per run of price in one direction; a reversal of at
// least `reversal` (an amount, or a percent of the line's extreme) starts the
// next line at the extreme just reached.
//
//   up line:   price > extreme -> extreme = price (the line grows)
//              extreme - price >= reversal(extreme) -> new down line from the extreme
//   down line: mirrored.
// Before the first line the direction is unset: the first price is both start
// and extreme until price moves `reversal(first)` away, which fixes the
// direction and draws line 0 from the first price.
//
// Every price in a line is a source price: a line runs from the previous
// line's extreme (open) to its own extreme (close). The last line is the live
// one and is rewritten as the extreme moves. Source range: fromTime is when
// the opening price was observed (the previous line's extreme), toTime when the
// latest extreme was.
//
// Thick (yang) and thin (yin) lines. A line turns thick when an up line rises
// above the end of the up line before it (the "shoulder"), and thin when a
// down line falls below the end of the down line before it (the "waist"); it
// changes part-way through the line, at that level. The state before a first
// shoulder or waist exists is thin. `thick` holds the thick part of each line
// as its own bars, at the same ordinals, for the lines that have one: draw it
// over the full lines with a heavier width. It is a sparse series: its times
// are a subset of the line bars' times. Thick spans end at line extremes or at
// the shoulder/waist level, both real prices.

import { PathTransform } from "./path.js";
import { BarStore, ordinalTime } from "./store.js";

/** Relative tolerance of the reversal comparisons (a 0.1 reversal from 1.2 to 1.1 must count). */
const TOL = 1e-9;

export type KagiReversal = { amount: number } | { percent: number };

export class Kagi extends PathTransform {
  /** The thick part of each line that has one; same ordinals as `store`. */
  readonly thick = new BarStore();
  private readonly amount: number;
  private readonly percent: number;
  private started = false;
  /** 0 until the first reversal-size move; then 1 (up) or -1 (down). */
  private dir = 0;
  private start = 0;
  private startTime = 0;
  private ext = 0;
  private extTime = 0;
  /** End of the same-direction line before this one: NaN for the first two. */
  private ref = Number.NaN;
  private thickIn = false;
  private thickAfter = false;

  constructor(reversal: KagiReversal) {
    super("kagi");
    this.amount = "amount" in reversal ? reversal.amount : Number.NaN;
    this.percent = "percent" in reversal ? reversal.percent : Number.NaN;
    const r = "amount" in reversal ? this.amount : this.percent;
    if (!(r > 0) || !Number.isFinite(r)) throw new RangeError(`kagi: reversal must be a positive number, got ${r}`);
  }

  /** Lowest `thick` index changed since the last call (its length when none). */
  takeThickDirty(): number {
    return this.thick.takeDirty();
  }

  private reversal(at: number): number {
    return this.amount === this.amount ? this.amount : (Math.abs(at) * this.percent) / 100;
  }

  protected point(time: number, price: number): void {
    if (!this.started) {
      this.started = true;
      this.start = this.ext = price;
      this.startTime = this.extTime = time;
      return;
    }
    if (this.dir === 0) {
      const r = this.reversal(this.start);
      if (price - this.start >= r * (1 - TOL)) this.dir = 1;
      else if (this.start - price >= r * (1 - TOL)) this.dir = -1;
      else return;
      this.ext = price;
      this.extTime = time;
      this.write(true);
      return;
    }
    const d = this.dir;
    if ((price - this.ext) * d > 0) {
      this.ext = price;
      this.extTime = time;
      this.write(false);
    } else if ((this.ext - price) * d >= this.reversal(this.ext) * (1 - TOL)) {
      // New line from the extreme: its same-direction predecessor ended where
      // the line we are leaving started (when that line itself had a predecessor;
      // line 0 starts at the first price, which is no shoulder or waist).
      this.ref = this.store.length > 1 ? this.start : Number.NaN;
      this.thickIn = this.thickAfter;
      this.start = this.ext;
      this.startTime = this.extTime;
      this.dir = -d;
      this.ext = price;
      this.extTime = time;
      this.write(true);
    }
  }

  /** Write the current line (new or extended) and its thick part. */
  private write(create: boolean): void {
    const s = this.store, i = create ? s.length : s.length - 1;
    const a = this.start, b = this.ext, up = this.dir > 0;
    s.set(i, ordinalTime(i), a, Math.max(a, b), Math.min(a, b), b, this.startTime, this.extTime);

    // Thick part of this line, and the state it leaves behind.
    const ref = this.ref;
    let tFrom = Number.NaN, tTo = Number.NaN;
    if (up) {
      const flips = ref === ref && b > ref;
      this.thickAfter = this.thickIn || flips;
      if (this.thickIn) (tFrom = a), (tTo = b);
      else if (flips) (tFrom = Math.max(a, ref)), (tTo = b);
    } else {
      const flips = ref === ref && b < ref;
      this.thickAfter = this.thickIn && !flips;
      // A line that starts beyond the waist is thin throughout: no thick part.
      if (this.thickIn && !(flips && a <= ref)) (tFrom = a), (tTo = flips ? ref : b);
    }
    if (tFrom !== tFrom) return;
    const th = this.thick;
    const ord = ordinalTime(i);
    const last = th.length - 1;
    const j = last >= 0 && th.time[last] === ord ? last : th.length;
    th.set(j, ord, tFrom, Math.max(tFrom, tTo), Math.min(tFrom, tTo), tTo, this.startTime, this.extTime);
  }
}
