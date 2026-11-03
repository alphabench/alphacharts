// Heikin-Ashi: a smoothed candle derived from each source bar and the previous
// derived bar.
//
//   haClose = (o + h + l + c) / 4
//   haOpen  = (prev haOpen + prev haClose) / 2        first bar: (o + c) / 2
//   haHigh  = max(h, haOpen, haClose)
//   haLow   = min(l, haOpen, haClose)
//
// One derived bar per source bar, so it is the one transform that keeps TRUE
// time: bar i sits at the source bar's time and its source range is
// {time, time}. Its prices are averages and are NOT prices that traded; a
// readout must show them as Heikin-Ashi values (the source bar is one lookup
// away through the same time).
//
// Live use: the last source bar may be pushed again with the same time (the
// forming bar) and replaces its derived bar; only that bar changes, because a
// bar depends on the previous derived bar, never on a later one. A later time
// appends. An earlier time throws.

import type { OhlcBar } from "@alphacharts/core";
import { checkBar } from "./path.js";
import { BarStore } from "./store.js";

export class HeikinAshi {
  readonly store = new BarStore();
  private rows = 0;

  /** Add or replace the last source bar. Returns the derived index that changed. */
  push(bar: OhlcBar): number {
    const s = this.store;
    const replace = s.length > 0 && bar.time === s.time[s.length - 1]!;
    const i = replace ? s.length - 1 : s.length;
    checkBar("heikin-ashi", this.rows, bar, i > 0 ? s.time[i - 1]! : Number.NEGATIVE_INFINITY);
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = i > 0 ? (s.open[i - 1]! + s.close[i - 1]!) / 2 : (bar.open + bar.close) / 2;
    s.set(i, bar.time, open, Math.max(bar.high, open, close), Math.min(bar.low, open, close), close, bar.time, bar.time);
    this.rows++;
    return s.takeDirty();
  }

  pushAll(bars: readonly OhlcBar[]): number {
    let from = this.store.length;
    for (const b of bars) from = Math.min(from, this.push(b));
    return Math.min(from, this.store.length);
  }
}
