// Line Break (n lines, default 3): a new line forms only when the close breaks
// the recent extreme; otherwise nothing is drawn.
//
// Works on closes: the first close is the anchor; the first close that differs
// from it draws line 0 from the anchor to that close. After that, with L the
// last line:
//   L is up:    close > L.high            -> new up line, from L.close to close
//               close < min low of the last n lines -> new down line, from L.close
//   L is down:  close < L.low             -> new down line, from L.close
//               close > max high of the last n lines -> new up line, from L.close
// (fewer than n lines: all of them). Any other close changes nothing. A
// continuation line opens at the previous line's close; a reversal line opens at
// the previous line's OPEN (the far end of its body), the classic drawing.
//
// Prices are source closes (nothing derived). Source range: fromTime is the
// time its opening price was observed (the previous line's close for a
// continuation, the previous line's own start for a reversal), toTime the close
// that completed it. Input is bars only; a trade stream must
// be turned into bars first (the close of a trade bar is a real price).

import type { OhlcBar, Trade } from "@alphacharts/core";
import { PathTransform } from "./path.js";
import { ordinalTime } from "./store.js";

export class LineBreak extends PathTransform {
  private anchor = Number.NaN;
  private anchorTime = 0;

  constructor(private readonly lines = 3) {
    super("line-break");
    if (!Number.isInteger(lines) || lines < 1) throw new RangeError(`line-break: lines must be a positive integer, got ${lines}`);
  }

  protected override acceptBar(b: OhlcBar): void {
    this.point(b.time, b.close);
  }

  protected override acceptTrade(_t: Trade): void {
    throw new TypeError("line-break: needs bars (it breaks on closes); trades are not accepted");
  }

  protected point(time: number, close: number): void {
    const s = this.store;
    const m = s.length;
    if (m === 0) {
      if (this.anchor !== this.anchor) {
        this.anchor = close;
        this.anchorTime = time;
      } else if (close !== this.anchor) {
        s.append(ordinalTime(0), this.anchor, Math.max(this.anchor, close), Math.min(this.anchor, close), close, this.anchorTime, time);
      }
      return;
    }
    const L = m - 1;
    const up = s.close[L]! > s.open[L]!;
    let make = false;
    let reversal = false;
    if (up) {
      if (close > s.high[L]!) make = true;
      else {
        let lo = Number.POSITIVE_INFINITY;
        for (let i = Math.max(0, m - this.lines); i < m; i++) lo = Math.min(lo, s.low[i]!);
        make = close < lo;
        reversal = make;
      }
    } else if (close < s.low[L]!) make = true;
    else {
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = Math.max(0, m - this.lines); i < m; i++) hi = Math.max(hi, s.high[i]!);
      make = close > hi;
      reversal = make;
    }
    if (!make) return;
    const open = reversal ? s.open[L]! : s.close[L]!;
    const from = reversal ? s.fromTime[L]! : s.toTime[L]!;
    s.append(ordinalTime(m), open, Math.max(open, close), Math.min(open, close), close, from, time);
  }
}
