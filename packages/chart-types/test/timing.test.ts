// Transform throughput on 1M inputs. Not a gate (the bound is generous so a
// loaded machine does not flake); the figures are printed for the record.

import { describe, expect, it } from "vitest";
import { HeikinAshi, Kagi, LineBreak, PointFigure, RangeBars, Renko, TradeBars } from "../src/index.js";
import { randomBars, randomTrades } from "./helpers.js";

describe("1M-input timing", () => {
  const bars = randomBars(1_000_000, 5, 100, 0.8);
  const trades = randomTrades(1_000_000, 5, 100, 0.2);
  const cases: [string, () => number][] = [
    ["heikin-ashi 1M bars", () => { const t = new HeikinAshi(); t.pushAll(bars); return t.store.length; }],
    ["renko 1M bars", () => { const t = new Renko({ box: 1 }); t.pushBars(bars); return t.store.length; }],
    ["renko ATR 1M bars", () => { const t = new Renko({ atrPeriod: 14 }); t.pushBars(bars); return t.store.length; }],
    ["range 1M trades", () => { const t = new RangeBars(1); t.pushTrades(trades); return t.store.length; }],
    ["kagi 1M bars", () => { const t = new Kagi({ amount: 1 }); t.pushBars(bars); return t.store.length; }],
    ["point & figure 1M bars", () => { const t = new PointFigure(1, 3); t.pushBars(bars); return t.store.length; }],
    ["line break 1M bars", () => { const t = new LineBreak(3); t.pushBars(bars); return t.store.length; }],
    ["tick 1M trades", () => { const t = new TradeBars("tick", 100); t.pushAll(trades); return t.store.length; }],
    ["volume 1M trades", () => { const t = new TradeBars("volume", 1000); t.pushAll(trades); return t.store.length; }],
    ["dollar 1M trades", () => { const t = new TradeBars("dollar", 100_000); t.pushAll(trades); return t.store.length; }],
  ];
  for (const [name, run] of cases) {
    it(name, () => {
      const t0 = performance.now();
      const n = run();
      const ms = performance.now() - t0;
      console.log(`${name}: ${ms.toFixed(0)} ms, ${n.toLocaleString()} derived bars`);
      expect(n).toBeGreaterThan(0);
      expect(ms).toBeLessThan(20_000);
    });
  }
});
