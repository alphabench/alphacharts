// Incremental == batch, for every transform, on seeded random walks.
//
// Three properties per transform:
//   1. Feeding the input in random chunks, one row at a time, gives exactly the
//      store a single batch push gives (every column, bit for bit).
//   2. The index each push returns is honest: every bar below it is unchanged
//      since before the push, and it is at most the previous last index (only
//      the last bar may be rewritten, which is all Series.update can apply).
//   3. A series mirror that applies each delta (truncate to `from`, copy the
//      rest) ends equal to the store.

import type { OhlcBar, Trade } from "@alphacharts/core";
import { describe, expect, it } from "vitest";
import { HeikinAshi, Kagi, LineBreak, PointFigure, RangeBars, Renko, TradeBars, type BarStore } from "../src/index.js";
import { chunks, randomBars, randomTrades, rows } from "./helpers.js";

interface Driver<In> {
  store: BarStore;
  extra?: BarStore;
  push(x: In): number;
  pushAll(xs: readonly In[]): number;
  /** Extra store's changed index since the last call, if there is one. */
  extraDirty?(): number;
}

/** Apply one delta to a mirror: keep [0, from), copy the rest from `after`. */
function mirrorApply(mirror: number[][], after: number[][], from: number): void {
  mirror.length = Math.min(mirror.length, from);
  for (let i = from; i < after.length; i++) mirror[i] = after[i]!;
}

function check<In>(make: () => Driver<In>, input: readonly In[], seed: number): void {
  const batch = make();
  batch.pushAll(input);
  const inc = make();
  const mirror: number[][] = [];
  const mirrorExtra: number[][] = [];
  for (const chunk of chunks(input, seed)) {
    for (const x of chunk) {
      const before = rows(inc.store);
      const beforeExtra = inc.extra ? rows(inc.extra) : [];
      const from = inc.push(x);
      const after = rows(inc.store);
      // Only the previous last bar may be rewritten.
      expect(from).toBeLessThanOrEqual(before.length);
      if (from < before.length) expect(from).toBe(before.length - 1);
      for (let i = 0; i < Math.min(from, before.length); i++) expect(after[i]).toEqual(before[i]);
      mirrorApply(mirror, after, from);
      if (inc.extra) {
        const af = rows(inc.extra);
        const ef = inc.extraDirty!();
        expect(ef).toBeLessThanOrEqual(beforeExtra.length);
        if (ef < beforeExtra.length) expect(ef).toBe(beforeExtra.length - 1);
        for (let i = 0; i < Math.min(ef, beforeExtra.length); i++) expect(af[i]).toEqual(beforeExtra[i]);
        mirrorApply(mirrorExtra, af, ef);
      }
    }
  }
  expect(rows(inc.store)).toEqual(rows(batch.store));
  expect(mirror).toEqual(rows(batch.store));
  if (inc.extra) {
    expect(rows(inc.extra)).toEqual(rows(batch.extra!));
    expect(mirrorExtra).toEqual(rows(batch.extra!));
  }
}

const SEEDS = [1, 2, 3, 4, 5];

type Extra = (t: never) => { extra: BarStore; dirty(): number };

function bars(make: () => { store: BarStore; pushBar(b: OhlcBar): number; pushBars(b: readonly OhlcBar[]): number }, extraOf?: Extra) {
  return (): Driver<OhlcBar> => {
    const t = make();
    const x = extraOf?.(t as never);
    return { store: t.store, push: (b) => t.pushBar(b), pushAll: (b) => t.pushBars(b), ...(x ? { extra: x.extra, extraDirty: x.dirty } : {}) };
  };
}

function trades(make: () => { store: BarStore; pushTrade(b: Trade): number; pushTrades(b: readonly Trade[]): number }, extraOf?: Extra) {
  return (): Driver<Trade> => {
    const t = make();
    const x = extraOf?.(t as never);
    return { store: t.store, push: (b) => t.pushTrade(b), pushAll: (b) => t.pushTrades(b), ...(x ? { extra: x.extra, extraDirty: x.dirty } : {}) };
  };
}

const kagiExtra: Extra = (k) => ({ extra: (k as Kagi).thick, dirty: () => (k as Kagi).takeThickDirty() });

describe("incremental == batch", () => {
  for (const seed of SEEDS) {
    const b = randomBars(220, seed, 100, 1.5);
    const t = randomTrades(500, seed, 100, 0.4);
    it(`heikin-ashi, seed ${seed}`, () => {
      check<OhlcBar>(() => {
        const h = new HeikinAshi();
        return { store: h.store, push: (x) => h.push(x), pushAll: (x) => h.pushAll(x) };
      }, b, seed);
    });
    it(`renko fixed, bars and trades, seed ${seed}`, () => {
      check(bars(() => new Renko({ box: 1.25 })), b, seed);
      check(trades(() => new Renko({ box: 0.75 })), t, seed);
    });
    it(`renko ATR, seed ${seed}`, () => {
      check(bars(() => new Renko({ atrPeriod: 14 })), b, seed);
    });
    it(`range bars, seed ${seed}`, () => {
      check(bars(() => new RangeBars(2)), b, seed);
      check(trades(() => new RangeBars(0.9)), t, seed);
    });
    it(`line break, seed ${seed}`, () => {
      check(bars(() => new LineBreak(3)), b, seed);
    });
    it(`kagi amount and percent, seed ${seed}`, () => {
      check(bars(() => new Kagi({ amount: 2 }), kagiExtra), b, seed);
      check(trades(() => new Kagi({ percent: 0.8 }), kagiExtra), t, seed);
    });
    it(`point & figure, seed ${seed}`, () => {
      check(bars(() => new PointFigure(1, 3)), b, seed);
      check(trades(() => new PointFigure(0.5, 2)), t, seed);
    });
    it(`tick, volume and dollar bars, seed ${seed}`, () => {
      for (const [kind, size] of [["tick", 7], ["volume", 90], ["dollar", 9000]] as const) {
        check<Trade>(() => {
          const x = new TradeBars(kind, size);
          return { store: x.store, push: (tr) => x.push(tr), pushAll: (tr) => x.pushAll(tr) };
        }, t, seed);
      }
    });
  }

  it("the runs exercise reversals, extensions and several bars per row", () => {
    const b = randomBars(600, 1, 100, 1.5);
    const kagi = new Kagi({ amount: 2 });
    kagi.pushBars(b);
    expect(kagi.store.length).toBeGreaterThan(10);
    expect(kagi.thick.length).toBeGreaterThan(3);
    const renko = new Renko({ box: 0.5 });
    renko.pushBars(b);
    expect(renko.store.length).toBeGreaterThan(b.length / 4);
    const pf = new PointFigure(1, 3);
    pf.pushBars(b);
    expect(pf.store.length).toBeGreaterThan(5);
    const vb = new TradeBars("volume", 90);
    vb.pushAll(randomTrades(1500, 1));
    expect(vb.store.length).toBeGreaterThan(50);
  });

  it("every derived bar is a valid OHLC row for the core, with ordered times and source ranges", () => {
    const b = randomBars(2000, 9, 100, 2);
    const t = randomTrades(4000, 9);
    const all: BarStore[] = [];
    const ha = new HeikinAshi();
    ha.pushAll(b);
    all.push(ha.store);
    const renko = new Renko({ box: 1 });
    renko.pushBars(b);
    all.push(renko.store);
    const atr = new Renko({ atrPeriod: 10 });
    atr.pushBars(b);
    all.push(atr.store);
    const range = new RangeBars(1.5);
    range.pushTrades(t);
    all.push(range.store);
    const lb = new LineBreak(3);
    lb.pushBars(b);
    all.push(lb.store);
    const kagi = new Kagi({ amount: 1.5 });
    kagi.pushBars(b);
    all.push(kagi.store, kagi.thick);
    const pf = new PointFigure(1, 3);
    pf.pushBars(b);
    all.push(pf.store);
    const vb = new TradeBars("volume", 100);
    vb.pushAll(t);
    all.push(vb.store);
    for (const s of all) {
      expect(s.length).toBeGreaterThan(0);
      for (let i = 0; i < s.length; i++) {
        const o = s.open[i]!, h = s.high[i]!, l = s.low[i]!, c = s.close[i]!;
        expect(l <= o && l <= c && h >= o && h >= c, `row ${i}`).toBe(true);
        expect(s.fromTime[i]!).toBeLessThanOrEqual(s.toTime[i]!);
        if (i > 0) expect(s.time[i]!).toBeGreaterThan(s.time[i - 1]!);
      }
    }
  });
});

describe("readout lookups", () => {
  it("sourceRangeAt resolves a chart time to the bar's true time range", () => {
    const rk = new Renko({ box: 2 });
    rk.pushTrades([{ time: 10, price: 100, size: 1, side: "unknown" }, { time: 30, price: 102, size: 1, side: "unknown" }]);
    const bar0 = rk.store.bar(0);
    expect(rk.store.sourceRangeAt(bar0.time)).toEqual({ fromTime: 10, toTime: 30 });
    expect(rk.store.sourceRangeAt(bar0.time + 1)).toBeUndefined();
  });
});
