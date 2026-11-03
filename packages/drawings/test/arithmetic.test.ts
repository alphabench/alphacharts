// Exact arithmetic of every value a tool prints. Each expectation shows the
// calculation it checks.

import { describe, expect, it } from "vitest";
import { ArrayBarSource } from "../src/source.js";
import { regression, regressionOf } from "../src/tools/channels.js";
import { fibExtensionPrice, fibRetracementPrice, FIB_SEQUENCE } from "../src/tools/fib.js";
import { gannBoxPrice, gannFanPrice } from "../src/tools/gann.js";
import { abcdRatios, cypherRatios, driveRatios, waveLabel, xabcdRatios } from "../src/tools/patterns.js";
import { ghostBars, patternBars, positionStats, projectionTarget, seeded } from "../src/tools/position.js";
import { sineY } from "../src/tools/cycles.js";
import { anchoredVwap, startIndex, volumeProfile } from "../src/tools/volume.js";
import { barsText, fmtDuration, measure, measureLines } from "../src/tools/util.js";
import { T0, STEP, bars, ctx, k, plugin } from "./helpers.js";

describe("measure / info line", () => {
  it("Δ price, percent of the start price, bars and duration", () => {
    const src = bars();
    // 100 → 112.5: Δ = 12.5, 12.5 / 100 · 100 = 12.5 %. Bars 20 → 80 = 60. 60 × 1 min = 1h 0m.
    const m = measure(k(20, 100), k(80, 112.5), src);
    expect(m.dPrice).toBe(12.5);
    expect(m.pct).toBe(12.5);
    expect(m.bars).toBe(60);
    expect(m.dTime).toBe(60 * STEP);
    expect(measureLines(m, ctx(src))).toEqual(["+12.50 (+12.50%)", "60 bars, 1h"]);
  });

  it("a falling move uses |start| and shows a minus sign", () => {
    const m = measure(k(0, 200), k(30, 150), bars());
    expect(m.dPrice).toBe(-50);
    expect(m.pct).toBe(-25);
    expect(measureLines(m, ctx())[0]).toBe("-50.00 (-25.00%)");
  });

  it("without a source there is no bar count (not an estimate); from price 0 there is no percent", () => {
    expect(measure(k(0, 10), k(10, 11), null).bars).toBeNull();
    expect(measure(k(0, 0), k(10, 11), null).pct).toBeNull();
  });

  it("bars between bar times are integers; between bars they are fractional; past the data they extrapolate by the median interval", () => {
    const src = bars();
    expect(src.logical(T0 + 10 * STEP)).toBe(10);
    expect(src.logical(T0 + 10.5 * STEP)).toBe(10.5);
    expect(src.logical(T0 + 205 * STEP)).toBe(205);
    expect(src.logical(T0 - 3 * STEP)).toBe(-3);
    expect(barsText(2.5)).toBe("2.5");
    expect(fmtDuration(90 * 60_000 + 25 * 86_400_000)).toBe("25d 1h 30m");
  });

  it("the info line prints these numbers (via the drawing)", () => {
    const { p } = plugin();
    const d = p.add({ tool: "infoLine", anchors: [k(20, 100), k(80, 112.5)] });
    const text = p.toolDef("infoLine").shapes(d, ctx()).find((s) => s.k === "text");
    expect(text && text.k === "text" && text.text.split("\n").slice(0, 2)).toEqual(["+12.50 (+12.50%)", "60 bars, 1h"]);
  });
});

describe("position tools", () => {
  it("long: risk 5, reward 10, R:R 2; 1 % of 100000 = 1000 risked → floor(1000 / 5) = 200 units; profit 200·10 = 2000, loss 200·5 = 1000", () => {
    const s = positionStats("long", 100, 110, 95, { accountSize: 100000, riskPercent: 1, lotSize: 1 });
    expect(s.risk).toBe(5);
    expect(s.reward).toBe(10);
    expect(s.rr).toBe(2);
    expect(s.qty).toBe(200);
    expect(s.profit).toBe(2000);
    expect(s.loss).toBe(1000);
    expect(s.riskPct).toBe(5);
    expect(s.rewardPct).toBe(10);
  });

  it("short mirrors it", () => {
    const s = positionStats("short", 100, 90, 104, { accountSize: 50000, riskPercent: 2, lotSize: 1 });
    // risk 4, reward 10, 2 % of 50000 = 1000 → 250 units
    expect([s.risk, s.reward, s.rr, s.qty, s.profit, s.loss]).toEqual([4, 10, 2.5, 250, 2500, 1000]);
  });

  it("lot size rounds the quantity down to whole lots: 1000 / 7 = 142.857… → 5 lots of 25 = 125", () => {
    expect(positionStats("long", 100, 120, 93, { accountSize: 100000, riskPercent: 1, lotSize: 25 }).qty).toBe(125);
  });

  it("floating-point quotients just under an integer still floor to it: 0.3 / 0.1", () => {
    // 0.3 / 0.1 = 2.9999999999999996 in IEEE doubles
    expect(positionStats("long", 1, 2, 0.9, { accountSize: 30, riskPercent: 1, lotSize: 1 }).qty).toBe(3);
  });

  it("no account size, no quantity; zero risk, no quantity and no R:R", () => {
    const s = positionStats("long", 100, 110, 95);
    expect([s.qty, s.profit, s.loss]).toEqual([null, null, null]);
    const z = positionStats("long", 100, 110, 100, { accountSize: 1000, riskPercent: 1, lotSize: 1 });
    expect([z.qty, z.rr]).toEqual([null, null]);
  });

  it("wrong side is refused with the numbers", () => {
    expect(() => positionStats("long", 100, 90, 95)).toThrow(/got target 90, entry 100, stop 95/);
    expect(() => positionStats("long", 100, 110, 95, { accountSize: -1, riskPercent: 1, lotSize: 1 })).toThrow(/positive/);
    expect(() => positionStats("long", 100, 110, 95, { accountSize: 1000 })).toThrow(/required/);
    expect(() => positionStats("long", 0, 1, -1, {})).toThrow(/entry price 0/);
    expect(() => positionStats("long", 100, 110, 95, { accountSize: 1000, riskPercent: 1, lotSize: 0.1 })).toThrow(/whole number/);
  });

  it("the quantity never loses more than the risk budget, even at crore scale", () => {
    // ₹1000 cr, 1 %, 0.05 per unit: exactly 2,000,000,000 units
    const s = positionStats("long", 100, 110, 99.95, { accountSize: 1e10, riskPercent: 1, lotSize: 1 });
    expect(s.qty).toBe(2_000_000_000);
  });

  it("the drawing prints entry, target, stop, R:R and quantity", () => {
    const { p } = plugin();
    const d = p.add({ tool: "longPosition", anchors: [k(20, 100), k(60, 110), k(60, 95)], props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } });
    const texts = p.toolDef("longPosition").shapes(d, ctx()).filter((s) => s.k === "text").map((s) => (s.k === "text" ? s.text : ""));
    expect(texts).toContain("Target 110.00 (+10.00, 10.00%)\nP&L 2000.00");
    expect(texts).toContain("Stop 95.00 (-5.00, 5.00%)\nP&L -1000.00");
    expect(texts).toContain("Entry 100.00  R:R 2.00  Qty 200");
  });

  it("projection: the projected end is a2 plus the exact a0→a1 price move", () => {
    expect(projectionTarget(k(0, 100), k(10, 112.5), k(20, 105))).toBe(117.5);
  });
});

describe("Fibonacci", () => {
  it("retracement: level 0 is the end anchor, 1 the start; price = end + (start − end)·r", () => {
    const a0 = k(10, 200), a1 = k(60, 100);
    // swing down 200 → 100: 0.5 → 100 + 100·0.5 = 150; 0.618 → 100 + 61.8 = 161.8
    expect(fibRetracementPrice(a0, a1, 0)).toBe(100);
    expect(fibRetracementPrice(a0, a1, 1)).toBe(200);
    expect(fibRetracementPrice(a0, a1, 0.5)).toBe(150);
    expect(fibRetracementPrice(a0, a1, 0.618)).toBeCloseTo(161.8, 12);
    expect(fibRetracementPrice(a0, a1, 0.236)).toBeCloseTo(123.6, 12);
  });

  it("extension: price = c + (b − a)·r", () => {
    // a 100 → b 150 (move +50), c = 130: 1 → 180, 1.618 → 130 + 80.9 = 210.9, 0 → 130
    expect(fibExtensionPrice(k(0, 100), k(10, 150), k(20, 130), 0)).toBe(130);
    expect(fibExtensionPrice(k(0, 100), k(10, 150), k(20, 130), 1)).toBe(180);
    expect(fibExtensionPrice(k(0, 100), k(10, 150), k(20, 130), 1.618)).toBeCloseTo(210.9, 12);
  });

  it("the retracement drawing labels each level with the formatter's text of that price", () => {
    const { p } = plugin();
    const d = p.add({ tool: "fibRetracement", anchors: [k(10, 120), k(60, 100)], props: { levels: [0, 0.5, 1] } });
    const labels = p.toolDef("fibRetracement").shapes(d, ctx()).filter((s) => s.k === "text").map((s) => (s.k === "text" ? s.text : ""));
    expect(labels).toEqual(["0 (100.00)", "0.5 (110.00)", "1 (120.00)"]);
  });

  it("time zones sit at Fibonacci multiples of the first interval in x", () => {
    expect(FIB_SEQUENCE.slice(0, 7)).toEqual([0, 1, 2, 3, 5, 8, 13]);
    const { p } = plugin();
    const d = p.add({ tool: "fibTimeZone", anchors: [k(10, 100), k(14, 100)], props: { levels: [0, 1, 2, 3, 5, 8] } });
    const xs = p.toolDef("fibTimeZone").shapes(d, ctx()).filter((s) => s.k === "line" && s.y1 === 0).map((s) => (s.k === "line" ? s.x1 : NaN));
    // 4 bars apart · 4 px per bar = 16 px per zone, starting at bar 10 = x 40
    expect(xs).toEqual([40, 56, 72, 88, 120, 168]);
  });
});

describe("Gann", () => {
  it("box: price at fraction r is a0 + (a1 − a0)·r", () => {
    expect(gannBoxPrice(k(0, 100), k(10, 140), 0.25)).toBe(110);
    expect(gannBoxPrice(k(0, 100), k(10, 140), 0.382)).toBeCloseTo(115.28, 12);
  });

  it("fan: the n×m line is the 1×1 slope times n/m, read at the second anchor's time", () => {
    const a0 = k(0, 100), a1 = k(10, 120);
    expect(gannFanPrice(a0, a1, 1, 1)).toBe(120);
    expect(gannFanPrice(a0, a1, 2, 1)).toBe(140);
    expect(gannFanPrice(a0, a1, 1, 2)).toBe(110);
    expect(gannFanPrice(a0, a1, 1, 8)).toBe(102.5);
    expect(gannFanPrice(a0, a1, 8, 1)).toBe(260);
  });

  it("fixed square is square on screen: height = width in px", () => {
    const { p } = plugin();
    const d = p.add({ tool: "gannSquareFixed", anchors: [k(20, 100), k(60, 110)] });
    const h = p.toolDef("gannSquareFixed").handlePoints!(d, ctx());
    expect(h[1]!.x - h[0]!.x).toBe(160);
    expect(Math.abs(h[1]!.y - h[0]!.y)).toBe(160);
  });
});

describe("regression channel", () => {
  it("OLS on a known line is exact with zero residual", () => {
    const r = regression([3, 5, 7, 9, 11]);
    expect([r.slope, r.intercept, r.sigma]).toEqual([2, 3, 0]);
  });

  it("residual deviation: y = [1, 2, 2, 4] → slope 1, intercept 0.5, σ = √0.275", () => {
    // mean x 1.5, mean y 2.25; sxy = (−1.5)(−1.25)+(−0.5)(−0.25)+(0.5)(−0.25)+(1.5)(1.75) = 1.875+0.125−0.125+2.625 = 4.5; sxx = 5 → slope 0.9
    const r = regression([1, 2, 2, 4]);
    expect(r.slope).toBeCloseTo(0.9, 12);
    expect(r.intercept).toBeCloseTo(2.25 - 0.9 * 1.5, 12);
    // residuals: 1−0.9=0.1, 2−1.8=0.2, 2−2.7=−0.7, 4−3.6=0.4 → Σ² = .01+.04+.49+.16 = .70 → σ = √(.70/4)
    expect(r.sigma).toBeCloseTo(Math.sqrt(0.175), 12);
  });

  it("uses the source's closes between the anchors", () => {
    const src = bars();
    const { reg, lo, hi } = regressionOf(src, T0 + 10 * STEP, T0 + 60 * STEP);
    expect([lo, hi]).toEqual([10, 61]);
    const closes = Array.from({ length: 51 }, (_, i) => src.at(10 + i).close);
    expect(reg).toEqual(regression(closes));
  });
});

describe("anchored VWAP", () => {
  it("is Σ(typical·volume)/Σ(volume), typical = (H+L+C)/3, from the anchor's bar on", () => {
    const src = new ArrayBarSource({
      time: [0, 1, 2].map((i) => T0 + i * STEP), open: [10, 11, 12], high: [12, 13, 15], low: [9, 10, 11], close: [11, 12, 14], volume: [100, 300, 200],
    });
    const s = anchoredVwap(src, 0);
    // bar 0: typical (12+9+11)/3 = 32/3; bar 1: 35/3; bar 2: 40/3
    expect(s.values[0]).toBeCloseTo(32 / 3, 12);
    expect(s.values[1]).toBeCloseTo((32 / 3 * 100 + 35 / 3 * 300) / 400, 12);
    expect(s.values[2]).toBeCloseTo((32 / 3 * 100 + 35 / 3 * 300 + 40 / 3 * 200) / 600, 12);
    expect(anchoredVwap(src, 1).values[0]).toBeCloseTo(35 / 3, 12);
  });

  it("anchors on the bar at or before the anchor time; none after the last bar", () => {
    const src = bars();
    expect(startIndex(src, T0 + 30 * STEP)).toBe(30);
    expect(startIndex(src, T0 + 30.5 * STEP)).toBe(30);
    expect(startIndex(src, T0 - 5 * STEP)).toBe(0);
    expect(startIndex(src, T0 + 500 * STEP)).toBeNull();
  });

  it("zero volume yields no value rather than a number", () => {
    const src = new ArrayBarSource({ time: [T0, T0 + STEP], open: [1, 1], high: [2, 2], low: [1, 1], close: [1, 1], volume: [0, 0] });
    expect(Number.isNaN(anchoredVwap(src, 0).values[1])).toBe(true);
  });
});

describe("volume profile (bar-level approximation)", () => {
  it("spreads each bar's volume over its rows in proportion to overlap; the rows sum to the total", () => {
    const src = new ArrayBarSource({ time: [T0, T0 + STEP], open: [10, 10], high: [14, 12], low: [10, 10], close: [12, 11], volume: [400, 100] });
    const vp = volumeProfile(src, 0, 2, 4);
    // range 10..14 in 4 rows of height 1. bar 0 spans all four rows: 100 each. bar 1 spans rows 0,1: 50 each.
    expect(vp.volumes).toEqual([150, 150, 100, 100]);
    expect(vp.poc).toBe(0);
    expect(vp.volumes.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it("the tool's label says it is an approximation", () => {
    expect(plugin().p.toolDef("volumeProfile").label).toMatch(/approximation/);
  });

  it("totals match on real-looking bars", () => {
    const src = bars();
    const vp = volumeProfile(src, 5, 150, 24);
    let total = 0;
    for (let i = 5; i < 150; i++) total += src.at(i).volume;
    expect(vp.volumes.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6);
  });
});

describe("patterns", () => {
  it("XABCD ratios are |leg| / |leg|", () => {
    const [x, a, b, c, d] = [k(0, 100), k(10, 120), k(20, 107.64), k(30, 114.82), k(40, 104)];
    const r = xabcdRatios(x, a, b, c, d);
    // XA 20, AB 12.36 → 0.618; BC 7.18 → 7.18/12.36; CD 10.82; AD 16 → 0.8
    expect(r.abXa).toBeCloseTo(0.618, 12);
    expect(r.bcAb).toBeCloseTo(7.18 / 12.36, 12);
    expect(r.cdBc).toBeCloseTo(10.82 / 7.18, 12);
    expect(r.adXa).toBeCloseTo(0.8, 12);
  });

  it("a ratio over a zero leg is null, never 0 or Infinity", () => {
    expect(xabcdRatios(k(0, 100), k(1, 100), k(2, 90), k(3, 95), k(4, 92)).abXa).toBeNull();
    expect(abcdRatios(k(0, 100), k(1, 100), k(2, 90), k(3, 95)).bcAb).toBeNull();
  });

  it("cypher and ABCD ratios", () => {
    const r = cypherRatios(k(0, 100), k(1, 120), k(2, 108), k(3, 130), k(4, 112));
    // XA 20, AB 12 → .6; XC 30 → 1.5; CD 18 / XC 30 → .6
    expect([r.abXa, r.xcXa, r.cdXc]).toEqual([0.6, 1.5, 0.6]);
    expect(abcdRatios(k(0, 100), k(1, 120), k(2, 110), k(3, 130))).toEqual({ bcAb: 0.5, cdBc: 2 });
  });

  it("three drives: five successive leg ratios", () => {
    const pts = [100, 120, 110, 130, 118, 140].map((p, i) => k(i, p));
    pts.push(k(6, 125));
    // legs 20, 10, 20, 12, 22, 15 → 10/20, 20/10, 12/20, 22/12, 15/22
    const got = driveRatios(pts);
    [0.5, 2, 0.6, 22 / 12, 15 / 22].forEach((v, i) => expect(got[i]).toBeCloseTo(v, 12));
  });

  it("Elliott labels by degree", () => {
    expect(["minuette", "minor", "intermediate", "primary"].map((d) => waveLabel(d as never, "3"))).toEqual(["((3))", "3", "(3)", "[3]"]);
  });
});

describe("bar overlays", () => {
  it("bars pattern shifts every price by the same amount so the first close lands on the anchor price", () => {
    const src = bars();
    const copy = patternBars([src.at(20), src.at(21), src.at(22)], 105);
    const shift = 105 - src.at(20).close;
    expect(copy[0]!.close).toBe(105);
    expect(copy[1]!.high).toBe(src.at(21).high + shift);
    expect(copy.map((b) => b.offsetMs)).toEqual([0, STEP, 2 * STEP]);
  });

  it("ghost feed is deterministic for a seed and chains each bar from the previous close", () => {
    const hist = [bars().at(20), bars().at(21), bars().at(22)];
    const a = ghostBars(hist, 105, 10, 42), b = ghostBars(hist, 105, 10, 42), c = ghostBars(hist, 105, 10, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a[0]!.open).toBe(105);
    for (let i = 1; i < a.length; i++) expect(a[i]!.open).toBe(a[i - 1]!.close);
    const r = seeded(1);
    expect(Array.from({ length: 3 }, r)).toEqual(Array.from({ length: 3 }, seeded(1)));
  });
});

describe("sine line", () => {
  it("passes through both anchors as consecutive extrema and the mean line at the quarter points", () => {
    expect(sineY(0, 100, 40, 200, 0)).toBe(100);
    expect(sineY(0, 100, 40, 200, 40)).toBeCloseTo(200, 12);
    expect(sineY(0, 100, 40, 200, 20)).toBeCloseTo(150, 12);
    expect(sineY(0, 100, 40, 200, 80)).toBeCloseTo(100, 12);
  });
});
