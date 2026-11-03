// A live chart feeds a Series through syncSeries(): replace-or-append of the
// bars a push changed. The sink here has the Series.update contract (same time
// as the last bar replaces it, a later time appends, an earlier one throws), so
// this proves the deltas are applicable to a real series and that a series fed
// row by row ends identical to one loaded in a single setData.

import type { OhlcBar, Trade } from "@alphacharts/core";
import { describe, expect, it } from "vitest";
import { HeikinAshi, Kagi, LineBreak, PointFigure, RangeBars, Renko, TradeBars, syncSeries, type BarStore } from "../src/index.js";
import { randomBars, randomTrades, rows } from "./helpers.js";

class Sink {
  readonly bars: OhlcBar[] = [];
  update(b: OhlcBar): void {
    const last = this.bars[this.bars.length - 1];
    if (last && b.time < last.time) throw new RangeError(`update: time ${b.time} is earlier than the series' last bar ${last.time}`);
    if (last && b.time === last.time) this.bars[this.bars.length - 1] = { ...b };
    else this.bars.push({ ...b });
  }
  asRows(): number[][] {
    return this.bars.map((b) => [b.time, b.open, b.high, b.low, b.close]);
  }
}

const ohlcRows = (s: BarStore) => rows(s).map((r) => r.slice(0, 5));

describe("syncSeries", () => {
  const bars = randomBars(400, 21, 100, 1.5);
  const trades = randomTrades(1500, 21, 100, 0.4);

  const barCases: [string, () => { store: BarStore; pushBar(b: OhlcBar): number; thick?: BarStore; takeThickDirty?(): number }][] = [
    ["renko", () => new Renko({ box: 1 })],
    ["renko ATR", () => new Renko({ atrPeriod: 10 })],
    ["range", () => new RangeBars(1.5)],
    ["line break", () => new LineBreak(3)],
    ["kagi", () => new Kagi({ amount: 1.5 })],
    ["point & figure", () => new PointFigure(1, 3)],
  ];
  for (const [name, make] of barCases) {
    it(`${name}: a series fed one source bar at a time ends equal to the batch`, () => {
      const t = make();
      const sink = new Sink(), thickSink = new Sink();
      for (const b of bars) {
        const from = t.pushBar(b);
        syncSeries(sink, t.store, from);
        if (t.thick) syncSeries(thickSink, t.thick, t.takeThickDirty!());
      }
      expect(sink.asRows()).toEqual(ohlcRows(t.store));
      if (t.thick) expect(thickSink.asRows()).toEqual(ohlcRows(t.thick));
    });
  }

  it("heikin-ashi, including the forming bar pushed again", () => {
    const ha = new HeikinAshi();
    const sink = new Sink();
    for (const b of bars) {
      // The forming bar first with a lower close, then the final one.
      for (const x of [{ ...b, close: Math.max(b.low, Math.min(b.high, b.open)) }, b]) syncSeries(sink, ha.store, ha.push(x));
    }
    const batch = new HeikinAshi();
    batch.pushAll(bars);
    expect(sink.asRows()).toEqual(ohlcRows(batch.store));
  });

  for (const kind of ["tick", "volume", "dollar"] as const) {
    it(`${kind} bars from a trade stream`, () => {
      const t = new TradeBars(kind, kind === "tick" ? 9 : kind === "volume" ? 120 : 12_000);
      const sink = new Sink();
      for (const tr of trades as Trade[]) syncSeries(sink, t.store, t.push(tr));
      expect(sink.asRows()).toEqual(ohlcRows(t.store));
      expect(t.store.length).toBeGreaterThan(20);
    });
  }
});
