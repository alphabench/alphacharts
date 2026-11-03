// TradingView trend studies. Studies with a TA-Lib counterpart are compared to
// TA-Lib in talib.test.ts (fixtures/cases/tv-trend.json). Everything here is
// checked against values worked out by hand on tiny inputs (the arithmetic is
// next to each expectation), plus structural invariants on random bars.

import { describe, expect, it } from "vitest";
import { runStudy, StudyEngine } from "../src/engine/study.js";
import type { StudyDef } from "../src/types.js";
import * as T from "../src/studies/tv-trend.js";
import { MAIN, randomBars } from "./support.js";

interface B { c?: number[]; h?: number[]; l?: number[]; v?: number[] }

/** Columnar bars; a missing high/low equals close, missing volume is 1. */
function bars(b: B) {
  const n = (b.c ?? b.h ?? b.l)!.length;
  const arr = (a: number[] | undefined, f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => a?.[i] ?? f(i));
  const c = arr(b.c, (i) => (b.h![i]! + b.l![i]!) / 2);
  return {
    time: Float64Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * 60_000),
    open: c, close: c, high: arr(b.h, (i) => c[i]!), low: arr(b.l, (i) => c[i]!), volume: arr(b.v, () => 1),
  };
}

const run = (def: StudyDef, inputs: Record<string, number | boolean | string>, b: B) => runStudy(def, inputs, bars(b));
const col = (def: StudyDef, name: string) => def.columns.indexOf(name);
const at = (out: Float64Array[], def: StudyDef, name: string) => out[col(def, name)]!;
const nan = (a: Float64Array, ...idx: number[]) => idx.forEach((i) => expect(a[i], `index ${i}`).toBeNaN());
const first = (a: Float64Array) => a.findIndex((x) => x === x);

describe("moving averages", () => {
  it("smma: SMA seed then Wilder smoothing", () => {
    const o = at(run(T.smma, { length: 3 }, { c: [1, 2, 3, 4, 5] }), T.smma, "smma");
    nan(o, 0, 1);
    expect(o[2]).toBeCloseTo(2, 12); // (1+2+3)/3
    expect(o[3]).toBeCloseTo(8 / 3, 12); // (2*2 + 4)/3
    expect(o[4]).toBeCloseTo(31 / 9, 12); // (8/3*2 + 5)/3 = (16/3 + 5)/3
  });

  it("vwma: volume-weighted mean of the window", () => {
    const o = at(run(T.vwma, { length: 2 }, { c: [10, 20, 30], v: [1, 3, 2] }), T.vwma, "vwma");
    nan(o, 0);
    expect(o[1]).toBeCloseTo(17.5, 12); // (10*1 + 20*3) / (1+3) = 70/4
    expect(o[2]).toBeCloseTo(24, 12); // (20*3 + 30*2) / (3+2) = 120/5
  });

  it("hma(4): wma(2*wma(2) - wma(4), 2)", () => {
    const o = at(run(T.hma, { length: 4 }, { c: [2, 4, 8, 16, 32] }), T.hma, "hma");
    nan(o, 0, 1, 2, 3);
    // x = 2,4,8,16,32. wma2 = (x[i-1] + 2 x[i]) / 3, wma4 = (x[i-3] + 2 x[i-2] + 3 x[i-1] + 4 x[i]) / 10
    // i=3: raw = 2*(8+32)/3 - (2+8+24+64)/10 = 80/3 - 9.8 = 253/15
    // i=4: raw = 2*(16+64)/3 - (4+16+48+128)/10 = 160/3 - 19.6 = 506/15
    // hma = (raw3 + 2 raw4) / 3 = (253 + 1012) / 45
    expect(o[4]).toBeCloseTo(1265 / 45, 10);
  });

  it("hma uses floor(n/2) and round(sqrt n) for odd n: hma(9) first value at bar 10", () => {
    // floor(9/2) = 4, round(sqrt 9) = 3: wma9 is valid from bar 8, the final wma3 two bars later
    expect(first(at(run(T.hma, {}, { c: Array.from({ length: 30 }, (_, i) => i + 1) }), T.hma, "hma"))).toBe(10);
  });

  it("hma of a line is the line (no lag): 2*wma - wma keeps linear series exact", () => {
    const x = Array.from({ length: 30 }, (_, i) => 3 + 2 * i);
    const o = at(run(T.hma, { length: 9 }, { c: x }), T.hma, "hma");
    expect(o[20]).toBeCloseTo(x[20]!, 9);
  });

  it("alma(3, 0.85, 6): Gaussian weights centred at m = floor(0.85*2) = 1", () => {
    const o = at(run(T.alma, { length: 3 }, { c: [1, 2, 4] }), T.alma, "alma");
    nan(o, 0, 1);
    // s = 3/6 = 0.5 -> w_k = exp(-(k-1)^2 / (2*0.25)): w0 = w2 = e^-2, w1 = 1; the newest bar has k = 2
    // sum = 1*e^-2 + 2*1 + 4*e^-2 = 2 + 5 e^-2, norm = 1 + 2 e^-2
    expect(o[2]).toBeCloseTo((2 + 5 * Math.exp(-2)) / (1 + 2 * Math.exp(-2)), 12);
  });

  it("alma of a constant is the constant", () => {
    const o = at(run(T.alma, {}, { c: new Array(20).fill(7) }), T.alma, "alma");
    expect(o[19]).toBeCloseTo(7, 12);
  });

  it("lsma: regression value at the newest bar; offset moves back along the line", () => {
    // y = 1,2,4 at x = 0,1,2: slope = (4-1)/2 = 1.5, mean = 7/3, line at x=2: 7/3 + 1.5
    const o0 = at(run(T.lsma, { length: 3, offset: 0 }, { c: [1, 2, 4] }), T.lsma, "lsma");
    nan(o0, 0, 1);
    expect(o0[2]).toBeCloseTo(7 / 3 + 1.5, 12);
    // offset 1 reads the line one bar earlier, x=1: 7/3
    expect(at(run(T.lsma, { length: 3, offset: 1 }, { c: [1, 2, 4] }), T.lsma, "lsma")[2]).toBeCloseTo(7 / 3, 12);
    // offset -1 reads one bar ahead, x=3: 7/3 + 1.5*2
    expect(at(run(T.lsma, { length: 3, offset: -1 }, { c: [1, 2, 4] }), T.lsma, "lsma")[2]).toBeCloseTo(7 / 3 + 3, 12);
  });

  it("mcginley(2): ema seed, then the adaptive recursion", () => {
    const o = at(run(T.mcginley, { length: 2 }, { c: [10, 10, 12] }), T.mcginley, "mcginley");
    nan(o, 0);
    expect(o[1]).toBeCloseTo(10, 12); // ema(2) seed = (10+10)/2
    // 10 + (12 - 10) / (2 * (12/10)^4) = 10 + 2 / (2 * 2.0736)
    expect(o[2]).toBeCloseTo(10 + 1 / 2.0736, 12);
  });
});

describe("ribbon and cross", () => {
  it("ma-ribbon: first values of the eight SMAs and ordering on a rising series", () => {
    const x = Array.from({ length: 70 }, (_, i) => i + 1);
    const out = run(T.maRibbon, {}, { c: x });
    expect(T.maRibbon.columns.length).toBe(8);
    // SMA(p) of 1..n at bar p-1 is (p+1)/2: p = 20 -> 10.5, p = 55 -> 28
    expect(first(out[0]!)).toBe(19);
    expect(out[0]![19]).toBeCloseTo(10.5, 12);
    expect(first(out[7]!)).toBe(54);
    expect(out[7]![54]).toBeCloseTo(28, 12);
    // a rising series: shorter averages sit above longer ones
    for (let i = 54; i < 70; i++) for (let k = 0; k < 7; k++) expect(out[k]![i]!).toBeGreaterThan(out[k + 1]![i]!);
  });

  it("ma-ribbon: inputs set the first period and step; an 8th period past the limit fails loudly", () => {
    const out = run(T.maRibbon, { first: 2, step: 1 }, { c: Array.from({ length: 12 }, (_, i) => i + 1) });
    expect(out[0]![8]).toBeCloseTo(8.5, 12); // SMA2 at x=9: (8+9)/2
    expect(out[7]![8]).toBeCloseTo(5, 12); // SMA9 of 1..9
    expect(() => new StudyEngine(T.maRibbon, { first: 4900, step: 100 })).toThrow(RangeError);
  });

  it("ma-cross: markers only at crossovers, on the fast average", () => {
    // close 5,4,3,4,5,6,5,4,3; SMA2 = _,4.5,3.5,3.5,4.5,5.5,5.5,4.5,3.5; SMA3 = _,_,4,11/3,4,5,16/3,5,4
    const c = [5, 4, 3, 4, 5, 6, 5, 4, 3];
    const out = run(T.maCross, { fast: 2, slow: 3 }, { c });
    const up = at(out, T.maCross, "crossUp"), dn = at(out, T.maCross, "crossDown");
    // bar 4: fast 4.5 > slow 4 and the bar before had fast 3.5 <= slow 11/3
    expect(up[4]).toBeCloseTo(4.5, 12);
    // bar 7: fast 4.5 < slow 5 and the bar before had fast 5.5 >= slow 16/3
    expect(dn[7]).toBeCloseTo(4.5, 12);
    c.forEach((_, i) => { if (i !== 4) expect(up[i]).toBeNaN(); if (i !== 7) expect(dn[i]).toBeNaN(); });
  });

  it("ma-cross with ema type uses ema", () => {
    // ema(2) of 10,20,40: seed 15 at bar 1, then 15 + (40-15)*2/3 = 31 2/3
    const out = run(T.maCross, { type: "ema", fast: 2, slow: 3 }, { c: [10, 20, 40] });
    expect(at(out, T.maCross, "fast")[2]).toBeCloseTo(15 + (25 * 2) / 3, 12);
    expect(() => run(T.maCross, { type: "wma" }, { c: [1, 2, 3] })).toThrow(RangeError);
  });
});

describe("bands and channels", () => {
  it("envelopes: sma basis +- percent", () => {
    const out = run(T.envelopes, { length: 3, percent: 10 }, { c: [10, 20, 30] });
    expect(at(out, T.envelopes, "basis")[2]).toBeCloseTo(20, 12); // (10+20+30)/3
    expect(at(out, T.envelopes, "upper")[2]).toBeCloseTo(22, 12); // 20 * 1.1
    expect(at(out, T.envelopes, "lower")[2]).toBeCloseTo(18, 12); // 20 * 0.9
  });

  it("envelopes: ema basis", () => {
    const out = run(T.envelopes, { length: 2, percent: 10, basis: "ema" }, { c: [10, 20, 40] });
    const basis = 15 + (25 * 2) / 3; // seed 15, alpha 2/3
    expect(at(out, T.envelopes, "basis")[2]).toBeCloseTo(basis, 12);
    expect(at(out, T.envelopes, "upper")[2]).toBeCloseTo(basis * 1.1, 12);
  });

  // shared bars: high 12,14,18  low 8,10,12  close 10,12,15
  // Pine true range (ta.tr(true)): bar 0 = 12-8... high-low = 4; bar 1 = max(4, |14-10|, |10-10|) = 4;
  // bar 2 = max(6, |18-12|, |12-12|) = 6. ta.atr(2) = rma: bar 1 = (4+4)/2 = 4 (seeded on bar 0's range), bar 2 = 4 + (6-4)/2 = 5
  const K = { h: [12, 14, 18], l: [8, 10, 12], c: [10, 12, 15] };
  it("keltner: ema basis +- mult * Pine atr", () => {
    const out = run(T.keltner, { length: 2, mult: 2, atrLength: 2 }, K);
    const b = at(out, T.keltner, "basis"), u = at(out, T.keltner, "upper"), l = at(out, T.keltner, "lower");
    nan(b, 0);
    expect(b[1]).toBeCloseTo(11, 12); // ema seed (10+12)/2
    expect(u[1]).toBeCloseTo(11 + 2 * 4, 12); // atr(bar 1) = 4: the Pine atr exists here, TA-Lib's would not
    expect(l[1]).toBeCloseTo(11 - 2 * 4, 12);
    const e = 11 + (15 - 11) * (2 / 3); // ema bar 2
    expect(b[2]).toBeCloseTo(e, 12);
    expect(u[2]).toBeCloseTo(e + 10, 12); // + 2 * 5
    expect(l[2]).toBeCloseTo(e - 10, 12);
  });

  it("keltner: useEma off takes the sma", () => {
    const out = run(T.keltner, { length: 2, mult: 2, atrLength: 2, useEma: false }, K);
    expect(at(out, T.keltner, "basis")[2]).toBeCloseTo(13.5, 12); // (12+15)/2
    expect(at(out, T.keltner, "upper")[2]).toBeCloseTo(23.5, 12);
  });

  it("donchian: highest high, lowest low, midpoint", () => {
    const out = run(T.donchian, { length: 3 }, { h: [5, 7, 6, 9, 8], l: [3, 2, 4, 3, 5] });
    const u = at(out, T.donchian, "upper"), l = at(out, T.donchian, "lower"), b = at(out, T.donchian, "basis");
    nan(u, 0, 1);
    expect([u[2], l[2], b[2]]).toEqual([7, 2, 4.5]); // max(5,7,6), min(3,2,4), (7+2)/2
    expect([u[3], l[3], b[3]]).toEqual([9, 2, 5.5]); // max(7,6,9), min(2,4,3)
    expect([u[4], l[4], b[4]]).toEqual([9, 3, 6]); // max(6,9,8), min(4,3,5)
  });

  it("price-channel: highest high, lowest low, center", () => {
    const out = run(T.priceChannel, { length: 3 }, { h: [5, 7, 6, 9, 8], l: [3, 2, 4, 3, 5] });
    expect([at(out, T.priceChannel, "upper")[3], at(out, T.priceChannel, "lower")[3], at(out, T.priceChannel, "center")[3]]).toEqual([9, 2, 5.5]);
  });

  it("chande-kroll-stop(p=2, x=1, q=2)", () => {
    const out = run(T.chandeKrollStop, { p: 2, x: 1, q: 2 }, K);
    // atr(2): bar 1 = 4, bar 2 = 5 (see keltner). first_high = highest(high,2) - atr: bar 1 = 14-4 = 10, bar 2 = 18-5 = 13
    // first_low = lowest(low,2) + atr: bar 1 = 8+4 = 12, bar 2 = 10+5 = 15
    // stop_short = highest(first_high, 2) at bar 2 = max(10,13); stop_long = lowest(first_low, 2) = min(12,15)
    const s = at(out, T.chandeKrollStop, "stopShort"), l = at(out, T.chandeKrollStop, "stopLong");
    nan(s, 0, 1);
    expect(s[2]).toBeCloseTo(13, 12);
    expect(l[2]).toBeCloseTo(12, 12);
  });

  it("linreg-channel: base is the regression value, bands are base +- dev * residual stdev", () => {
    const out = run(T.linregChannel, { length: 3, upperDev: 2, lowerDev: 1 }, { c: [1, 2, 4] });
    // line through (0,1),(1,2),(2,4): slope 1.5, mean 7/3, fit = 0.8333, 2.3333, 3.8333; residuals 1/6, -1/3, 1/6
    // population variance = (1/36 + 1/9 + 1/36) / 3 = (1/6)/3 = 1/18
    const sd = Math.sqrt(1 / 18), base = 7 / 3 + 1.5;
    expect(at(out, T.linregChannel, "base")[2]).toBeCloseTo(base, 12);
    expect(at(out, T.linregChannel, "upper")[2]).toBeCloseTo(base + 2 * sd, 12);
    expect(at(out, T.linregChannel, "lower")[2]).toBeCloseTo(base - sd, 12);
  });

  it("median: middle of the window, ATR band", () => {
    // window (10, 30, 20) sorts to 10, 20, 30; atr(2) at bar 2 = 5 (K bars), mult 1
    const out = run(T.median, { length: 3, atrLength: 2, mult: 1, source: "close" }, { h: [12, 32, 33], l: [8, 28, 17], c: [10, 30, 20] });
    // atr: bar0 tr = 4, bar1 tr = max(4, |32-10|, |28-10|) = 22 -> atr1 = 13, bar2 tr = max(16, |33-30|, |17-30|) = 16 -> atr2 = 13 + (16-13)/2 = 14.5
    expect(at(out, T.median, "median")[2]).toBe(20);
    expect(at(out, T.median, "upper")[2]).toBeCloseTo(34.5, 12);
    expect(at(out, T.median, "lower")[2]).toBeCloseTo(5.5, 12);
  });

  it("median: even length averages the two middle values; default source is hl2", () => {
    // hl2 = (12+8)/2 = 10, (14+10)/2 = 12 -> median of two = 11
    expect(at(run(T.median, { length: 2, atrLength: 2 }, K), T.median, "median")[1]).toBe(11);
  });

  it("upper >= basis >= lower on random bars (all band studies)", () => {
    const d = randomBars(300, 5);
    for (const [def, u, b, l] of [
      [T.envelopes, "upper", "basis", "lower"], [T.keltner, "upper", "basis", "lower"], [T.donchian, "upper", "basis", "lower"],
      [T.priceChannel, "upper", "center", "lower"], [T.linregChannel, "upper", "base", "lower"], [T.median, "upper", "median", "lower"],
    ] as const) {
      const out = runStudy(def, {}, d);
      const U = at(out, def, u), B = at(out, def, b), L = at(out, def, l);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        if (U[i] !== U[i]) continue;
        n++;
        expect(U[i]! >= B[i]! && B[i]! >= L[i]!, `${def.id}[${i}]`).toBe(true);
      }
      expect(n, def.id).toBeGreaterThan(100);
    }
  });
});

describe("ichimoku", () => {
  // high 10,12,11,14,13  low 6,8,7,9,10  close 8,10,9,12,11; conversion 2, base 3, span B 4
  const IB = { h: [10, 12, 11, 14, 13], l: [6, 8, 7, 9, 10], c: [8, 10, 9, 12, 11] };
  const out = run(T.ichimoku, { conversion: 2, base: 3, spanB: 4 }, IB);
  it("conversion / base / span A / span B", () => {
    const c = at(out, T.ichimoku, "conversion"), b = at(out, T.ichimoku, "base"), a = at(out, T.ichimoku, "spanA"), sb = at(out, T.ichimoku, "spanB");
    // conversion = (max high + min low)/2 over 2: bar 1 (12+6)/2 = 9, bar 2 (12+7)/2 = 9.5, bar 3 (14+7)/2 = 10.5, bar 4 (14+9)/2 = 11.5
    expect([c[1], c[2], c[3], c[4]]).toEqual([9, 9.5, 10.5, 11.5]);
    // base over 3: bar 2 (12+6)/2 = 9, bar 3 (14+7)/2 = 10.5, bar 4 (14+7)/2 = 10.5
    expect([b[2], b[3], b[4]]).toEqual([9, 10.5, 10.5]);
    // span A = (conversion + base)/2: bar 2 (9.5+9)/2 = 9.25, bar 3 (10.5+10.5)/2 = 10.5, bar 4 (11.5+10.5)/2 = 11
    expect([a[2], a[3], a[4]]).toEqual([9.25, 10.5, 11]);
    nan(a, 0, 1);
    // span B over 4: bar 3 (14+6)/2 = 10, bar 4 (14+7)/2 = 10.5
    nan(sb, 0, 1, 2);
    expect([sb[3], sb[4]]).toEqual([10, 10.5]);
  });
  it("lagging span is the close, undisplaced", () => {
    expect(Array.from(at(out, T.ichimoku, "lagging"))).toEqual(IB.c);
  });
  it("plots displace the spans by 25 and the lagging span by -25; a fill joins the spans", () => {
    const p = (k: string) => T.ichimoku.plots.find((x) => x.key === k)!;
    expect(p("spanA")).toMatchObject({ kind: "line", offset: 25 });
    expect(p("spanB")).toMatchObject({ kind: "line", offset: 25 });
    expect(p("lagging")).toMatchObject({ kind: "line", offset: -25 });
    expect(p("cloud")).toMatchObject({ kind: "fill", a: "spanA", b: "spanB" });
  });
  it("defaults warm up at 8 / 25 / 25 / 51", () => {
    const o = runStudy(T.ichimoku, {}, MAIN);
    expect([0, 1, 2, 3].map((k) => first(o[k]!))).toEqual([8, 25, 25, 51]);
  });
});

describe("supertrend", () => {
  // bar: high low close   0: 11 9 10   1: 12 10 11   2: 14 12 13   3: 13 10 10   4: 9 7 8   5: 16 12 15 ; atr 2, factor 1
  const S = { h: [11, 12, 14, 13, 9, 16], l: [9, 10, 12, 10, 7, 12], c: [10, 11, 13, 10, 8, 15] };
  it("bands, ratcheting and the flip, by hand", () => {
    const out = run(T.supertrend, { atrLength: 2, factor: 1 }, S);
    const up = at(out, T.supertrend, "up"), dn = at(out, T.supertrend, "down"), dir = at(out, T.supertrend, "direction");
    // true range (bar 0 = high-low): 2, max(2,|12-10|,|10-10|) = 2, max(2,|14-11|,|12-11|) = 3, max(3,0,|10-13|) = 3, max(2,|9-10|,|7-10|) = 3, max(4,|16-8|,|12-8|) = 8
    // atr(2) = rma: bar 1 = (2+2)/2 = 2, bar 2 = 2+(3-2)/2 = 2.5, bar 3 = 2.5+0.25 = 2.75, bar 4 = 2.75+0.125 = 2.875, bar 5 = 2.875+(8-2.875)/2 = 5.4375
    nan(dir, 0);
    // bar 1 (first atr): hl2 11, upper 11+2 = 13, direction 1 (down) -> supertrend = upper
    // bar 2: hl2 13, raw upper 15.5 > 13 and prev close 11 <= 13: keeps 13; close 13 not > 13 -> still down, line 13
    // bar 3: hl2 11.5, raw upper 14.25 > 13, prev close 13 not > 13: keeps 13; close 10 -> down, line 13
    // bar 4: hl2 8, raw upper 8+2.875 = 10.875 < 13: ratchets down; close 8 -> down, line 10.875
    expect(Array.from(dir.subarray(1, 5))).toEqual([1, 1, 1, 1]);
    expect(Array.from(dn.subarray(1, 5))).toEqual([13, 13, 13, 10.875]);
    // bar 5: hl2 14, raw lower 14-5.4375 = 8.5625 > prev lower 5.125, upper stays 10.875; close 15 > 10.875 -> flips up, line = lower
    expect(dir[5]).toBe(-1);
    expect(up[5]).toBeCloseTo(8.5625, 12);
    expect(dn[5]).toBeNaN();
    expect(up[4]).toBeNaN();
  });

  it("random bars: the line is on the right side of price and the direction flips only when close crosses it", () => {
    const d = randomBars(500, 17);
    const out = runStudy(T.supertrend, {}, d);
    const [up, dn, dir] = out as [Float64Array, Float64Array, Float64Array];
    const start = first(dir);
    expect(start).toBe(9);
    let flips = 0;
    for (let i = start + 1; i < 500; i++) {
      if (dir[i] === -1) {
        expect(up[i]).toBeLessThanOrEqual(d.close[i]!); // uptrend: close at or above the line
        expect(dn[i]).toBeNaN();
      } else {
        expect(dn[i]).toBeGreaterThanOrEqual(d.close[i]!); // downtrend: close at or below the line
        expect(up[i]).toBeNaN();
      }
      if (dir[i] !== dir[i - 1]) {
        flips++;
        // a flip to up means close broke above the band, to down below it
        if (dir[i] === -1) expect(d.close[i]!).toBeGreaterThan(up[i]!);
        else expect(d.close[i]!).toBeLessThan(dn[i]!);
      }
    }
    expect(flips).toBeGreaterThan(2);
  });
});

describe("alligator", () => {
  it("smma of hl2 with the three offsets on the plots", () => {
    // hl2 = 10, 12, 15 (K bars). lips(1) = hl2; teeth(2): seed (10+12)/2 = 11, then 11 + (15-11)/2 = 13; jaw(3) = (10+12+15)/3
    const out = run(T.alligator, { jawLength: 3, teethLength: 2, lipsLength: 1 }, { h: [12, 14, 18], l: [8, 10, 12], c: [10, 12, 15] });
    expect(Array.from(at(out, T.alligator, "lips"))).toEqual([10, 12, 15]);
    expect(Array.from(at(out, T.alligator, "teeth").subarray(1))).toEqual([11, 13]);
    expect(at(out, T.alligator, "jaw")[2]).toBeCloseTo(37 / 3, 12);
    expect(T.alligator.plots.map((p) => (p.kind === "line" ? p.offset : undefined))).toEqual([8, 5, 3]);
  });
});

describe("fractals", () => {
  it("confirms two bars late with the fractal's price", () => {
    // highs 13,14,17,15,14,16,18,16,15: bar 2 (17) is above 14, 13 and 15, 14 -> known at bar 4; bar 6 (18) above 16, 14 and 16, 15 -> bar 8
    // lows 9,8,7,6,5,4,6,7,8: bar 5 (4) is below 5, 6 and 6, 7 -> known at bar 7
    const out = run(T.fractals, {}, { h: [13, 14, 17, 15, 14, 16, 18, 16, 15], l: [9, 8, 7, 6, 5, 4, 6, 7, 8], c: [10, 9, 8, 7, 6, 5, 7, 8, 9] });
    const up = at(out, T.fractals, "up"), dn = at(out, T.fractals, "down");
    up.forEach((v, i) => (i === 4 ? expect(v).toBe(17) : i === 8 ? expect(v).toBe(18) : expect(v, `up ${i}`).toBeNaN()));
    dn.forEach((v, i) => (i === 7 ? expect(v).toBe(4) : expect(v, `down ${i}`).toBeNaN()));
    for (const p of T.fractals.plots) expect(p).toMatchObject({ kind: "markers", offset: -2 });
  });

  it("an equal high on the left does not cancel the fractal when the bar beyond it is lower", () => {
    // highs 5,7,7,6,5: bar 2 (7) beats 6, 5 on the right; on the left bar 1 ties (7) and bar 0 (5) is lower -> fractal known at bar 4
    const out = run(T.fractals, {}, { h: [5, 7, 7, 6, 5], l: [1, 1, 1, 1, 1], c: [3, 4, 4, 3, 3] });
    expect(at(out, T.fractals, "up")[4]).toBe(7);
    // bar 1 is not a fractal: its right neighbour ties
    expect(at(out, T.fractals, "up")[3]).toBeNaN();
  });

  it("no fractal on a flat series", () => {
    const out = run(T.fractals, {}, { h: new Array(10).fill(5), l: new Array(10).fill(4), c: new Array(10).fill(4.5) });
    expect(first(at(out, T.fractals, "up"))).toBe(-1);
    expect(first(at(out, T.fractals, "down"))).toBe(-1);
  });
});

describe("zigzag", () => {
  const P = [100, 105, 112, 108, 100, 95, 110, 120, 118, 107];
  const piv = (a: Float64Array, bk: Float64Array) => Array.from(a, (v, i) => (v === v ? [i, v, bk[i]!] : null)).filter(Boolean);

  it("deviation 10, depth 2: pivots at confirmation with their distance back", () => {
    const out = run(T.zigzag, { deviation: 10, depth: 2 }, { h: P, l: P, c: P });
    const price = at(out, T.zigzag, "price"), back = at(out, T.zigzag, "back");
    // bar 2: 112 >= 100 * 1.1 after the low at bar 0 -> low pivot 100, 2 bars back
    // bar 4: 100 <= 112 * 0.9 = 100.8 -> high pivot 112 (bar 2), 2 back
    // bar 6: 110 >= 95 * 1.1 = 104.5 -> low pivot 95 (bar 5), 1 back
    // bar 9: 107 <= 120 * 0.9 = 108 -> high pivot 120 (bar 7), 2 back
    expect(piv(price, back)).toEqual([[2, 100, 2], [4, 112, 2], [6, 95, 1], [9, 120, 2]]);
  });

  it("the unconfirmed running extreme is carried as live / liveBack", () => {
    const out = run(T.zigzag, { deviation: 10, depth: 2 }, { h: P, l: P, c: P });
    const live = at(out, T.zigzag, "live"), lb = at(out, T.zigzag, "liveBack");
    nan(live, 0, 1); // before the first pivot there is no leg
    expect([live[2], lb[2]]).toEqual([112, 0]); // after the first pivot the up leg's high is bar 2
    expect([live[8], lb[8]]).toEqual([120, 1]); // bar 7's 120 still the extreme one bar later
    expect([live[9], lb[9]]).toEqual([107, 0]); // after the high pivot at bar 9 the down leg starts at 107
  });

  it("depth delays a confirmation until enough bars have passed since the previous pivot", () => {
    const out = run(T.zigzag, { deviation: 10, depth: 5 }, { h: P, l: P, c: P });
    // bar 4 would confirm 112 but 4 - 0 < 5, so it waits for bar 5 (low 95 <= 100.8; 5 - 0 = 5)
    // bar 6 would confirm 95 (6 - 2 = 4 < 5): waits for bar 7 (120 >= 104.5; 7 - 2 = 5), 95 is 2 bars back
    // bar 9 (107 <= 108) is blocked: 9 - 5 = 4 < 5
    expect(piv(at(out, T.zigzag, "price"), at(out, T.zigzag, "back"))).toEqual([[2, 100, 2], [5, 112, 3], [7, 95, 2]]);
    expect(at(out, T.zigzag, "liveBack")[9]).toBe(2); // the high at bar 7 is still the extreme
  });

  it("random bars: pivots alternate, legs reach the deviation, spacing respects depth, indices increase", () => {
    const d = randomBars(1500, 3);
    const dev = 1, depth = 4;
    const out = runStudy(T.zigzag, { deviation: dev, depth }, d);
    const price = out[0]!, back = out[1]!;
    const pv: { conf: number; idx: number; p: number }[] = [];
    for (let i = 0; i < price.length; i++) if (price[i]! === price[i]!) pv.push({ conf: i, idx: i - back[i]!, p: price[i]! });
    expect(pv.length).toBeGreaterThan(20);
    for (let k = 1; k < pv.length; k++) {
      const a = pv[k - 1]!, b = pv[k]!;
      expect(b.idx).toBeGreaterThan(a.idx);
      expect(b.conf - a.idx).toBeGreaterThanOrEqual(depth);
      if (k >= 2) expect(Math.sign(b.p - a.p), `pivot ${k}`).toBe(-Math.sign(a.p - pv[k - 2]!.p)); // high, low, high, ...
      const hi = Math.max(a.p, b.p), lo = Math.min(a.p, b.p);
      expect(hi / lo - 1, `leg ${k}`).toBeGreaterThanOrEqual(dev / 100 - 1e-12);
    }
    // each pivot is the true extreme of its own bar's range
    for (const q of pv) expect(q.p === d.high[q.idx] || q.p === d.low[q.idx]).toBe(true);
  });
});

describe("inputs and warm-up", () => {
  it("invalid parameters fail loudly", () => {
    expect(() => new StudyEngine(T.hma, { length: 1 })).toThrow(RangeError);
    expect(() => new StudyEngine(T.smma, { length: 0 })).toThrow(RangeError);
    expect(() => new StudyEngine(T.supertrend, { factor: 0 })).toThrow(RangeError);
    expect(() => new StudyEngine(T.zigzag, { deviation: 0 })).toThrow(RangeError);
    expect(() => new StudyEngine(T.alma, { sigma: 0 })).toThrow(RangeError);
    expect(() => new StudyEngine(T.fractals, { n: 3 })).toThrow(RangeError); // n is not an input: the plot offset is fixed
    expect(() => new StudyEngine(T.linregChannel, { length: 1 })).toThrow(RangeError);
  });

  it("warm-up bars are NaN and the first value lands where the definition says (defaults, 400 bars)", () => {
    const f = (def: StudyDef) => runStudy(def, {}, MAIN).map(first);
    expect(f(T.smma)).toEqual([6]); // sma(7) seed
    expect(f(T.vwma)).toEqual([19]);
    expect(f(T.alma)).toEqual([8]);
    expect(f(T.lsma)).toEqual([24]);
    expect(f(T.mcginley)).toEqual([13]); // first ema(14)
    expect(f(T.maRibbon)).toEqual([19, 24, 29, 34, 39, 44, 49, 54]);
    expect(f(T.maCross).slice(0, 2)).toEqual([8, 20]);
    expect(f(T.envelopes)).toEqual([19, 19, 19]);
    expect(f(T.keltner)).toEqual([19, 19, 19]); // ema(20) is the later of ema and atr(10)
    expect(f(T.donchian)).toEqual([19, 19, 19]);
    expect(f(T.chandeKrollStop)).toEqual([17, 17]); // atr(10) / highest(10) at bar 9, then highest over 9 first stops
    expect(f(T.linregChannel)).toEqual([99, 99, 99]);
    expect(f(T.median)).toEqual([2, 13, 13]); // median(3), atr(14)
    expect(f(T.supertrend)[2]).toBe(9);
    expect(f(T.alligator)).toEqual([12, 7, 4]);
  });
});
