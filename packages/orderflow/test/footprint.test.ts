import { describe, expect, it } from "vitest";
import { OrderFlow } from "../src/flow.js";
import { analyzeBar, buildRects, cellTexts, lodFor, RectBatch, type FootprintColors, type FootprintParams, type RectView } from "../src/footprint-layout.js";
import { levelTrades } from "./helpers.js";

const P: FootprintParams = { mode: "bidAsk", imbalanceRatio: 3, imbalanceMinVolume: 1, stackedImbalances: 3, showPoc: true, showUnfinished: true, minCellHeight: 10, minBarWidth: 40 };
const C: FootprintColors = { up: 0x00ff00ff, down: 0xff0000ff, buy: 0x00ff00ff, sell: 0xff0000ff, neutral: 0x0000ffff, imbalanceBuy: 0x00ee00ff, imbalanceSell: 0xee0000ff, poc: 0xffff00ff, unfinished: 0xff00ffff };

// Prices 10..13 as [buy, sell, unknown].
const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
f.addMany(levelTrades(0, { 10: [1, 5, 0], 11: [9, 2, 4], 12: [10, 1, 0], 13: [4, 3, 0] }));

describe("analysis (hand computed)", () => {
  it("diagonal imbalances at ratio 3", () => {
    const a = analyzeBar(f.bars, 0, P);
    // buy[k] >= 3·sell[k-1]: 10: sell[9]=0 -> yes; 11: 9 >= 15 no; 12: 10 >= 6 yes; 13: 4 >= 3 yes.
    expect(Array.from(a.imbBuy)).toEqual([1, 0, 1, 1]);
    // sell[k] >= 3·buy[k+1]: 10: 5 >= 27 no; 11: 2 >= 30 no; 12: 1 >= 12 no; 13: 3 >= 0 yes.
    expect(Array.from(a.imbSell)).toEqual([0, 0, 0, 1]);
  });
  it("minimum volume and ratio are configurable", () => {
    const a = analyzeBar(f.bars, 0, { ...P, imbalanceMinVolume: 5 });
    // Only 12 keeps both: 10 >= 6 and 10 >= 5. 10 and 13 hold < 5 buy; 11 (9) fails the ratio (9 < 15).
    expect(Array.from(a.imbBuy)).toEqual([0, 0, 1, 0]);
  });
  it("stacked imbalances need N in a row", () => {
    expect(Array.from(analyzeBar(f.bars, 0, P).stackBuy)).toEqual([0, 0, 0, 0]);
    expect(Array.from(analyzeBar(f.bars, 0, { ...P, stackedImbalances: 2 }).stackBuy)).toEqual([0, 0, 1, 1]);
  });
  it("POC (tie goes to the lower of the two middle levels), unfinished auctions, unknown kept apart", () => {
    const a = analyzeBar(f.bars, 0, P);
    // totals incl. unknown: 6, 15, 11, 7 -> POC 11.
    expect(a.pocK).toBe(11);
    expect(a.unfinishedHigh).toBe(true); // 13: buy 4 and sell 3
    expect(a.unfinishedLow).toBe(true); // 10: buy 1 and sell 5
    expect(Array.from(a.unknown)).toEqual([0, 4, 0, 0]);
  });
});

describe("level of detail", () => {
  it("cells need both width and height; narrower falls back to shaded, then plain", () => {
    expect(lodFor(40, 10, P)).toBe("cells");
    expect(lodFor(39.9, 10, P)).toBe("shaded");
    expect(lodFor(80, 9.9, P)).toBe("shaded");
    expect(lodFor(5.9, 50, P)).toBe("plain");
  });
});

function view(spacing: number, pxPerTick: number, dpr = 1): RectView {
  // Price p sits at y = (20 - p) · pxPerTick; one bar at x = 100.
  return {
    dpr, width: 400, height: 400, spacing, lo: 0, hi: 0,
    xOf: () => 100 * dpr, yOf: (p) => (20 - p) * pxPerTick * dpr, priceAt: (y) => 20 - y / dpr / pxPerTick,
    barAt: (i) => (i === 0 ? 0 : -1),
    open: () => 11, high: () => 13, low: () => 10, close: () => 12, range: () => {},
  };
}

describe("rectangles", () => {
  it("cells: rows share edges, so there are no gaps or overlaps, and POC is outlined", () => {
    const out = new RectBatch();
    const lod = buildRects(out, view(60, 20), f, P, C, (b) => analyzeBar(f.bars, b, P));
    expect(lod).toBe("cells");
    // bid and ask half for each of 4 levels, strip, POC outline (4), stacked none, 2 unfinished markers.
    const rects: number[][] = [];
    for (let i = 0; i < out.n; i++) rects.push([out.xy[i * 4]!, out.xy[i * 4 + 1]!, out.xy[i * 4 + 2]!, out.xy[i * 4 + 3]!, out.rgba[i]!]);
    const poc = rects.filter((r) => r[4] === C.poc);
    expect(poc.length).toBe(4);
    const level11 = rects.filter((r) => r[1] === rects.find((q) => q[4] === C.poc)![1] && r[4] !== C.poc);
    expect(level11.length).toBeGreaterThanOrEqual(2);
    for (const r of rects) expect(r[2]! > r[0]! && r[3]! > r[1]!).toBe(true);
    // 20 px per tick: the level for price p spans y from (20-p-0.5)·20 to (20-p+0.5)·20 less a 1 px gap.
    const bid13 = rects.find((r) => r[4] === ((C.imbalanceSell & 0xffffff00) | Math.round(0.95 * 255)) >>> 0)!;
    expect([bid13[1], bid13[3]]).toEqual([Math.round((20 - 13.5) * 20), Math.round((20 - 12.5) * 20) - 1]);
    // Unfinished markers use their colour.
    expect(rects.filter((r) => r[4] === C.unfinished).length).toBe(2);
  });

  it("an approximate flow shows volume only, with no sides, imbalance, or unfinished markers", () => {
    const a = OrderFlow.fromBars([{ time: 0, open: 11, high: 13, low: 10, close: 12, volume: 40 }], { tickSize: 1, periodMs: 60_000 });
    const out = new RectBatch();
    buildRects(out, view(60, 20), a, P, C, (b) => analyzeBar(a.bars, b, P));
    const colors = new Set(Array.from(out.rgba.subarray(0, out.n)).map((c) => c >>> 8));
    expect(colors.has(C.buy >>> 8) && colors.has(C.sell >>> 8)).toBe(false);
    expect(colors.has(C.unfinished >>> 8)).toBe(false);
    const texts: string[] = [];
    cellTexts(view(60, 20), a, P, (b) => analyzeBar(a.bars, b, P), (t) => texts.push(`${t.side}:${t.value}`));
    expect(texts).toEqual(["cell:10", "cell:10", "cell:10", "cell:10"]);
  });

  it("too small for cells: a shaded candle, and no cell texts are requested at the same LOD", () => {
    const out = new RectBatch();
    expect(buildRects(out, view(20, 20), f, P, C, (b) => analyzeBar(f.bars, b, P))).toBe("shaded");
    expect(out.n).toBeGreaterThan(1);
    expect(buildRects(new RectBatch(), view(3, 20), f, P, C, (b) => analyzeBar(f.bars, b, P))).toBe("plain");
  });

  it("texts carry the exact numbers: sell (bid) on the left, buy (ask) on the right", () => {
    const got: string[] = [];
    cellTexts(view(60, 20), f, P, (b) => analyzeBar(f.bars, b, P), (t) => got.push(`${t.side}:${t.value}`));
    expect(got).toEqual(["bid:5", "ask:1", "bid:2", "ask:9", "bid:1", "ask:10", "bid:3", "ask:4"]);
  });
});

// Price scales other than linear: every edge comes from the scale's y().
describe("price scale modes", () => {
  type Map1 = { name: string; y: (p: number) => number; price: (y: number) => number };
  const L0 = Math.log(8), L1 = Math.log(21);
  const maps: Map1[] = [
    { name: "linear", y: (p) => (20 - p) * 20, price: (y) => 20 - y / 20 },
    { name: "inverted", y: (p) => (p - 8) * 20, price: (y) => y / 20 + 8 },
    { name: "log", y: (p) => 400 * (1 - (Math.log(p) - L0) / (L1 - L0)), price: (y) => Math.exp(L0 + (1 - y / 400) * (L1 - L0)) },
    { name: "log inverted", y: (p) => 400 * ((Math.log(p) - L0) / (L1 - L0)), price: (y) => Math.exp(L0 + (y / 400) * (L1 - L0)) },
    // percent and indexed are affine in price too, with their own slope and offset (base price 11).
    { name: "percent", y: (p) => 400 - ((p / 11 - 1) * 100 + 40) * 5, price: (y) => ((400 - y) / 5 - 40) / 100 * 11 + 11 },
    { name: "percent inverted", y: (p) => ((p / 11 - 1) * 100 + 40) * 5, price: (y) => (y / 5 - 40) / 100 * 11 + 11 },
  ];
  const mkView = (m: Map1): RectView => ({
    dpr: 1, width: 400, height: 400, spacing: 60, lo: 0, hi: 0,
    xOf: () => 100, yOf: m.y, priceAt: m.price,
    barAt: (i) => (i === 0 ? 0 : -1),
    open: () => 11, high: () => 13, low: () => 10, close: () => 12, range: () => {},
  });
  const rectsOf = (m: Map1) => {
    const out = new RectBatch();
    const lod = buildRects(out, mkView(m), f, P, C, (b) => analyzeBar(f.bars, b, P));
    const r: number[][] = [];
    for (let i = 0; i < out.n; i++) r.push([out.xy[i * 4]!, out.xy[i * 4 + 1]!, out.xy[i * 4 + 2]!, out.xy[i * 4 + 3]!, out.rgba[i]!]);
    return { lod, r };
  };
  const base = rectsOf(maps[0]!);

  for (const m of maps) {
    it(`${m.name}: the same cells, each between its own price edges from y()`, () => {
      const { lod, r } = rectsOf(m);
      expect(lod).toBe("cells");
      // Nothing dropped for being upside down: same number of rectangles as the linear scale.
      expect(r.length).toBe(base.r.length);
      // Level 12's ask cell (buy 10, imbalance colour) spans exactly the rounded y of its price edges.
      const ask12 = r.find((q) => q[4] === ((C.imbalanceBuy & 0xffffff00) | Math.round(0.95 * 255)) >>> 0 && Math.abs((q[1]! + q[3]!) / 2 - (m.y(12) as number)) < 14)!;
      expect(ask12).toBeDefined();
      const e0 = Math.round(m.y(11.5)), e1 = Math.round(m.y(12.5));
      expect(ask12[1]).toBe(Math.min(e0, e1));
      expect(ask12[3]! + (ask12[3]! - ask12[1]! > 3 ? 1 : 0)).toBe(Math.max(e0, e1));
      // Unfinished markers sit just outside the bar's high edge and low edge.
      const marks = r.filter((q) => q[4] === C.unfinished);
      expect(marks.length).toBe(2);
      const hiEdge = m.y(13.5), loEdge = m.y(9.5);
      const dHigh = Math.min(...marks.map((q) => Math.abs((q[1]! + q[3]!) / 2 - hiEdge)));
      const dLow = Math.min(...marks.map((q) => Math.abs((q[1]! + q[3]!) / 2 - loEdge)));
      expect(dHigh).toBeLessThan(8);
      expect(dLow).toBeLessThan(8);
      // The marker is outside the cell column span, not on top of a level.
      for (const q of marks) {
        const mid = (q[1]! + q[3]!) / 2;
        const inside = [10, 11, 12, 13].some((p) => mid > Math.min(m.y(p - 0.5), m.y(p + 0.5)) + 1 && mid < Math.max(m.y(p - 0.5), m.y(p + 0.5)) - 1);
        expect(inside).toBe(false);
      }
    });
    it(`${m.name}: cell texts are centred in the rows, with a positive height`, () => {
      const got: [number, number][] = [];
      cellTexts(mkView(m), f, P, (b) => analyzeBar(f.bars, b, P), (t) => got.push([t.yMid, t.h]));
      expect(got.length).toBe(8);
      for (const [yMid, h] of got) {
        expect(h).toBeGreaterThan(0);
        expect([10, 11, 12, 13].some((p) => Math.abs(yMid - m.y(p)) <= 1.5)).toBe(true);
      }
    });
    it(`${m.name}: shaded and plain candles draw rectangles of positive height`, () => {
      for (const sp of [20, 3]) {
        const out = new RectBatch();
        buildRects(out, { ...mkView(m), spacing: sp }, f, P, C, (b) => analyzeBar(f.bars, b, P));
        expect(out.n).toBeGreaterThan(1);
        const ys = [];
        for (let i = 0; i < out.n; i++) ys.push([out.xy[i * 4 + 1]!, out.xy[i * 4 + 3]!]);
        // the wick spans high to low as drawn
        const wick = ys[0]!;
        expect(wick[0]).toBe(Math.min(Math.round(m.y(13)), Math.round(m.y(10))));
        expect(wick[1]).toBe(Math.max(Math.round(m.y(13)), Math.round(m.y(10))));
      }
    });
  }
});
