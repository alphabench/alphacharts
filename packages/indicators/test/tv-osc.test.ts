// Hand-checked values for the TradingView oscillators. Every expected number is
// derived on paper in the comment above it (from the definition in the study's
// `reference`), never copied from a run. Invariant tests follow.

import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import * as S from "../src/studies/tv-osc.js";
import { ema as emaStudy, sma as smaStudy } from "../src/studies/overlap.js";
import { MAIN, randomBars } from "./support.js";
import type { BarColumns } from "../src/types.js";

interface In { open?: number[]; high?: number[]; low?: number[]; close?: number[] }

/** Bars from plain arrays; missing OHLC columns default to the close. */
function bars(d: In): Required<BarColumns> {
  const n = (d.close ?? d.high ?? d.low ?? d.open)!.length;
  const f = (a: number[] | undefined, alt: number[] | undefined) => Float64Array.from(a ?? alt ?? new Array(n).fill(1));
  const close = f(d.close, d.high);
  return {
    time: Float64Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * 60_000),
    open: f(d.open, d.close), high: f(d.high, d.close), low: f(d.low, d.close), close, volume: new Float64Array(n).fill(1),
  };
}

const run = (def: Parameters<typeof runStudy>[0], inputs: Record<string, number | boolean | string>, d: In | Required<BarColumns>) =>
  runStudy(def, inputs, "time" in d ? d : bars(d));

const first = (a: Float64Array) => a.findIndex((v) => v === v);
const at = (a: Float64Array, i: number, want: number) => expect(a[i], `index ${i}`).toBeCloseTo(want, 9);
const absent = (a: Float64Array, upTo: number) => { for (let i = 0; i < upTo; i++) expect(a[i], `index ${i}`).toBeNaN(); };

describe("fisher", () => {
  // length 3 on hl2 = x (high = low = close): x = 1 2 3 2 4
  it("matches the recursion", () => {
    const [f, t] = run(S.fisher, { length: 3 }, { close: [1, 2, 3, 2, 4] });
    absent(f!, 2);
    // bar 2: window 1 2 3 -> pos (3-1)/(3-1) = 1; value = 0.66 (1 - 0.5) + 0.67 * 0 = 0.33; fish = 0.5 ln(1.33 / 0.67)
    const f2 = 0.5 * Math.log(1.33 / 0.67);
    at(f!, 2, f2);
    // bar 3: window 2 3 2 -> pos 0; value = 0.66 (0 - 0.5) + 0.67 * 0.33 = -0.1089; fish = 0.5 ln(0.8911 / 1.1089) + 0.5 f2
    const f3 = 0.5 * Math.log(0.8911 / 1.1089) + 0.5 * f2;
    at(f!, 3, f3);
    // bar 4: window 3 2 4 -> pos (4-2)/(4-2) = 1; value = 0.33 + 0.67 * (-0.1089) = 0.257037
    at(f!, 4, 0.5 * Math.log(1.257037 / 0.742963) + 0.5 * f3);
    // trigger = fish[1]
    absent(t!, 3);
    at(t!, 3, f2);
    at(t!, 4, f3);
  });
  it("clamps the value at 0.999 so the transform stays finite", () => {
    const [f] = run(S.fisher, { length: 3 }, { close: Array.from({ length: 40 }, (_, i) => i + 1) });
    // a steady rise drives value = 0.33 + 0.67 value[1] towards 1: it must saturate at 0.999 (fish <= 0.5 ln(1.999/0.001) / 0.5)
    const max = Math.log(1.999 / 0.001); // fixed point of fish = 0.5 ln(..) + 0.5 fish
    for (const v of f!) if (v === v) expect(v).toBeLessThanOrEqual(max + 1e-9);
    expect(f![39]).toBeCloseTo(max, 6);
  });
});

describe("kst", () => {
  // roc 1 2 3 4, sma 1 1 1 1 (identity), signal 2; close 10 11 12 12 15 15
  it("weights the four smoothed rocs 1 2 3 4", () => {
    const [k, s] = run(S.kst, { roc1: 1, roc2: 2, roc3: 3, roc4: 4, sma1: 1, sma2: 1, sma3: 1, sma4: 1, signal: 2 }, { close: [10, 11, 12, 12, 15, 15] });
    absent(k!, 4);
    // bar 4: roc1 = 100 (15-12)/12 = 25; roc2 = 100 (15-12)/12 = 25 (close[2] = 12); roc3 = 100 (15-11)/11 = 400/11; roc4 = 100 (15-10)/10 = 50
    const k4 = 25 + 2 * 25 + 3 * (400 / 11) + 4 * 50;
    at(k!, 4, k4);
    // bar 5: roc1 = 0; roc2 = 100 (15-12)/12 = 25; roc3 = 100 (15-12)/12 = 25 (close[2]); roc4 = 100 (15-11)/11 = 400/11
    const k5 = 0 + 2 * 25 + 3 * 25 + 4 * (400 / 11);
    at(k!, 5, k5);
    absent(s!, 5);
    at(s!, 5, (k4 + k5) / 2);
  });
  it("first values land where the longest chain is full (roc 30 + sma 15, signal 9)", () => {
    const [k, s] = run(S.kst, {}, MAIN);
    expect(first(k!)).toBe(30 + 15 - 1); // roc4 valid from bar 30, its sma 15 from 30 + 14
    expect(first(s!)).toBe(30 + 15 - 1 + 8);
  });
});

describe("tsi", () => {
  // long 2, short 2, signal 1 (identity); close 10 11 13 12 12 -> change: -, 1, 2, -1, 0
  it("double-smooths the change and its magnitude", () => {
    const [t, s] = run(S.tsi, { long: 2, short: 2, signal: 1 }, { close: [10, 11, 13, 12, 12] });
    absent(t!, 3);
    // num: ema2 of change (seed = mean of first two = 1.5 at bar 2), bar 3: 1.5 + 2/3 (-1 - 1.5) = -1/6, bar 4: -1/6 + 2/3 (0 + 1/6) = -1/18
    //      ds seed at bar 3 = (1.5 - 1/6) / 2 = 2/3; bar 4: 2/3 + 2/3 (-1/18 - 2/3) = 5/27
    // den: ema2 of |change| (1.5 at bar 2), bar 3: 1.5 + 2/3 (1 - 1.5) = 7/6, bar 4: 7/6 + 2/3 (0 - 7/6) = 7/18
    //      ds seed at bar 3 = (1.5 + 7/6) / 2 = 4/3; bar 4: 4/3 + 2/3 (7/18 - 4/3) = 19/27
    at(t!, 3, (100 * (2 / 3)) / (4 / 3)); // 50
    at(t!, 4, (100 * (5 / 27)) / (19 / 27)); // 500/19
    at(s!, 4, 500 / 19);
  });
  it("is bounded by +-100", () => {
    const [t] = run(S.tsi, {}, MAIN);
    expect(first(t!)).toBe(1 + 24 + 12); // change from bar 1, ema 25, then ema 13 over it
    for (const v of t!) if (v === v) expect(Math.abs(v)).toBeLessThanOrEqual(100);
  });
});

describe("vortex", () => {
  // length 2; high 5 6 7 6, low 3 4 4 3, close 4 5 6 5
  const d = { high: [5, 6, 7, 6], low: [3, 4, 4, 3], close: [4, 5, 6, 5] };
  it("sums the vortex movements over the sum of true ranges", () => {
    const [p, m] = run(S.vortex, { length: 2 }, d);
    absent(p!, 2);
    // VM+ = |high - low[1]|: bar 1 |6-3| = 3, bar 2 |7-4| = 3, bar 3 |6-4| = 2
    // VM- = |low - high[1]|: bar 1 |4-5| = 1, bar 2 |4-6| = 2, bar 3 |3-7| = 4
    // TR: bar 1 max(2, |6-4|, |4-4|) = 2, bar 2 max(3, |7-5|, |4-5|) = 3, bar 3 max(3, |6-6|, |3-6|) = 3
    at(p!, 2, (3 + 3) / (2 + 3)); at(m!, 2, (1 + 2) / (2 + 3));
    at(p!, 3, (3 + 2) / (3 + 3)); at(m!, 3, (2 + 4) / (3 + 3));
  });
});

describe("coppock", () => {
  it("is the weighted mean of the two rocs", () => {
    // wma 2, long roc 2, short roc 1; close 10 12 12 15
    const [c] = run(S.coppock, { length: 2, longRoc: 2, shortRoc: 1 }, { close: [10, 12, 12, 15] });
    absent(c!, 3);
    // sum of rocs: bar 2 = 100 (12-10)/10 + 100 (12-12)/12 = 20 + 0 = 20; bar 3 = 100 (15-12)/12 + 100 (15-12)/12 = 25 + 25 = 50
    // wma2 (newest weight 2) at bar 3 = (1 * 20 + 2 * 50) / 3
    at(c!, 3, (20 + 2 * 50) / 3);
  });
  it("defaults: wma 10 over roc 14", () => {
    expect(first(run(S.coppock, {}, MAIN)[0]!)).toBe(14 + 9);
  });
});

describe("connors-rsi", () => {
  // rsi 2, updown 2, roc rank 2; close 10 11 12 11 13 13
  it("averages rsi, streak rsi and the percent rank", () => {
    const [c] = run(S.connorsRsi, { rsiLength: 2, updownLength: 2, rocLength: 2 }, { close: [10, 11, 12, 11, 13, 13] });
    absent(c!, 3);
    // rsi(close, 2): up 1 1 0 2 0 / down 0 0 1 0 0 from bar 1; Wilder alpha 1/2 seeded by the mean of two
    //   bar 2: up 1, down 0 -> 100; bar 3: up 0.5, down 0.5 -> 50; bar 4: up 1.25, down 0.25 -> 100 - 100 / 6; bar 5: up 0.625, down 0.125 -> 100 - 100 / 6
    // streak: bar 1 +1, bar 2 +2, bar 3 -1, bar 4 +1, bar 5 0; its change from bar 2: +1 -3 +2 -1
    //   up 1 0 2 0 / down 0 3 0 1: bar 3 up 0.5, down 1.5 -> 100 - 100 / (1 + 1/3) = 25; bar 4 up 1.25, down 0.75 -> 100 - 100 / (1 + 5/3) = 62.5;
    //   bar 5 up 0.625, down 0.875 -> 100 - 100 / (1 + 5/7)
    // roc(close, 1): bar 1 10, bar 2 100/11, bar 3 -100/12, bar 4 200/11, bar 5 0
    //   percentrank over the 2 previous values <= current: bar 3: 0 of 2 -> 0; bar 4: 2 of 2 -> 100; bar 5: bar 3 only -> 1 of 2 -> 50
    at(c!, 3, (50 + 25 + 0) / 3);
    at(c!, 4, (100 - 100 / 6 + 62.5 + 100) / 3);
    at(c!, 5, (100 - 100 / 6 + (100 - 100 / (1 + 5 / 7)) + 50) / 3);
  });
  it("defaults: first value after 100 rocs and one more bar", () => {
    const [c] = run(S.connorsRsi, {}, MAIN);
    expect(first(c!)).toBe(101);
    for (const v of c!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
});

describe("choppiness", () => {
  it("is 100 log10(sum tr / range) / log10(n)", () => {
    // length 2; same bars as the vortex test: tr = 2 2 3 3 (the first bar's tr is high - low = 2)
    const [c] = run(S.choppiness, { length: 2 }, { high: [5, 6, 7, 6], low: [3, 4, 4, 3], close: [4, 5, 6, 5] });
    absent(c!, 1);
    // bar 1: sum tr = 2 + 2 = 4; highest high 6, lowest low 3 -> range 3
    at(c!, 1, (100 * Math.log10(4 / 3)) / Math.log10(2));
    // bar 2: sum tr = 2 + 3 = 5; highest high 7, lowest low 4 -> range 3
    at(c!, 2, (100 * Math.log10(5 / 3)) / Math.log10(2));
  });
  it("stays within 0..100 on the dataset; first value at bar 13", () => {
    const [c] = run(S.choppiness, {}, MAIN);
    expect(first(c!)).toBe(13);
    for (const v of c!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
});

describe("rvi-vigor", () => {
  it("is sma(swma(close - open)) / sma(swma(high - low)), signal swma", () => {
    // length 2; open 0, close 1..8 (close - open = 1..8), high 2, low 0 (range 2)
    const close = [1, 2, 3, 4, 5, 6, 7, 8];
    const [r, s] = run(S.rviVigor, { length: 2 }, { open: close.map(() => 0), close, high: close.map(() => 2), low: close.map(() => 0) });
    // swma(d)[k] = (d + 2 d1 + 2 d2 + d3) / 6 = (6 d_k - 9) / 6 = d_k - 1.5 for d_k = k + 1: bar 3 2.5, bar 4 3.5, bar 5 4.5, ...
    // swma(range 2) = (2 + 4 + 4 + 2) / 6 = 2
    absent(r!, 4);
    at(r!, 4, ((2.5 + 3.5) / 2) / 2); // 1.5
    at(r!, 5, ((3.5 + 4.5) / 2) / 2); // 2
    at(r!, 6, 2.5);
    at(r!, 7, 3);
    // signal bar 7 = swma(rvi bars 4..7 = 1.5 2 2.5 3) = (3 + 2 * 2.5 + 2 * 2 + 1.5) / 6
    absent(s!, 7);
    at(s!, 7, (3 + 5 + 4 + 1.5) / 6);
  });
});

describe("rvi-volatility", () => {
  // stdev length 2 (population: |a - b| / 2); close 10 12 11 11 14
  const d = { close: [10, 12, 11, 11, 14] };
  // stdev: bar 1 1, bar 2 0.5, bar 3 0, bar 4 1.5; change: +2 -1 0 +3
  // upper input (change <= 0 ? 0 : stdev): 1 0 0 1.5; lower input (change > 0 ? 0 : stdev): 0 0.5 0 0
  it("ema smoothing", () => {
    const [r] = run(S.rviVolatility, { length: 2, smoothing: 2 }, d);
    absent(r!, 2);
    // ema2 (alpha 2/3, seed = mean of the first two): upper bar 2 0.5, bar 3 1/6, bar 4 1/6 + 2/3 (1.5 - 1/6) = 19/18
    //                                                 lower bar 2 0.25, bar 3 1/12, bar 4 1/12 - 2/3 / 12 = 1/36
    at(r!, 2, (100 * 0.5) / (0.5 + 0.25));
    at(r!, 3, (100 * (1 / 6)) / (1 / 6 + 1 / 12));
    at(r!, 4, (100 * (19 / 18)) / (19 / 18 + 1 / 36));
  });
  it("rma (Wilder) smoothing", () => {
    const [r] = run(S.rviVolatility, { length: 2, smoothing: 2, ma: "rma" }, d);
    // rma2 (alpha 1/2): upper bar 2 0.5, bar 3 0.25, bar 4 0.25 + 0.5 (1.5 - 0.25) = 0.875; lower 0.25, 0.125, 0.0625
    at(r!, 4, (100 * 0.875) / (0.875 + 0.0625));
  });
  it("is within 0..100", () => {
    const [r] = run(S.rviVolatility, {}, MAIN);
    expect(first(r!)).toBe(9 + 13);
    for (const v of r!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
});

describe("smi-ergodic", () => {
  it("is the double-smoothed momentum ratio, signal and oscillator", () => {
    // long 2, short 2: the same numbers as the tsi test (close 10 11 13 12 12): erg bar 3 = 50, bar 4 = 500/19
    const [e, s, o] = run(S.smiErgodic, { longLength: 2, shortLength: 2, signal: 2 }, { close: [10, 11, 13, 12, 12] });
    at(e!, 3, 50);
    at(e!, 4, 500 / 19);
    // signal ema2 seeded with the mean of bars 3 and 4
    absent(s!, 4);
    at(s!, 4, (50 + 500 / 19) / 2);
    at(o!, 4, 500 / 19 - (50 + 500 / 19) / 2); // = (500/19 - 50) / 2
  });
  it("defaults: first erg at 4 + 20, signal 4 more bars later", () => {
    const [e, s] = run(S.smiErgodic, {}, MAIN);
    expect(first(e!)).toBe(24);
    expect(first(s!)).toBe(28);
  });
});

describe("rank-corr", () => {
  const rho = (x: number[], length = 4) => run(S.rankCorr, { length }, { close: x })[0]!;
  it("is +1 for a rise and -1 for a fall", () => {
    at(rho([1, 2, 3, 4]), 3, 1);
    at(rho([9, 7, 5, 2]), 3, -1);
  });
  it("uses Spearman's formula 1 - 6 sum d^2 / (n (n^2 - 1)) without ties", () => {
    // ranks 2 1 4 3 vs time 1 2 3 4: d = 1 -1 1 -1, sum d^2 = 4 -> 1 - 24 / 60
    at(rho([20, 10, 40, 30]), 3, 1 - 24 / 60);
    // window [2 3 4 0] -> ranks 2 3 4 1: d = 1 1 1 -3, sum d^2 = 12 -> 1 - 72 / 60
    at(rho([1, 2, 3, 4, 0]), 4, 1 - 72 / 60);
  });
  it("gives tied values the mean rank (Pearson of ranks)", () => {
    // x = 1 1 2 2 -> ranks 1.5 1.5 3.5 3.5, mean 2.5; time ranks 1..4
    // cov = (-1)(-1.5) + (-1)(-0.5) + (1)(0.5) + (1)(1.5) = 4; var(rank) = 4; var(time) = 5 -> 4 / sqrt(20)
    at(rho([1, 1, 2, 2]), 3, 4 / Math.sqrt(20));
  });
  it("is absent for an all-equal window and before the window is full", () => {
    const r = rho([5, 5, 5, 5, 6]);
    absent(r, 4);
    expect(r[4]).toBeDefined();
    expect(Number.isFinite(r[4]!)).toBe(true);
  });
  it("stays within [-1, 1]", () => {
    for (const v of run(S.rankCorr, {}, MAIN)[0]!) if (v === v) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

describe("bull-bear-power", () => {
  it("is high / low minus ema(close)", () => {
    // length 2; close 10 12 11 13: ema2 (alpha 2/3, seed mean of two) bar 1 = 11, bar 2 = 11 + 2/3 (11 - 11) = 11, bar 3 = 11 + 2/3 (13 - 11) = 37/3
    const [bu, be] = run(S.bullBearPower, { length: 2 }, { close: [10, 12, 11, 13], high: [11, 13, 12, 14], low: [9, 11, 10, 12] });
    absent(bu!, 1);
    at(bu!, 1, 13 - 11); at(be!, 1, 11 - 11);
    at(bu!, 3, 14 - 37 / 3); at(be!, 3, 12 - 37 / 3);
  });
  it("equals high / low minus the TA-Lib verified ema on the dataset", () => {
    const [bu, be] = run(S.bullBearPower, {}, MAIN);
    const [e] = runStudy(emaStudy, { length: 13 }, MAIN);
    for (let i = 0; i < e!.length; i++) {
      if (e![i]! !== e![i]!) { expect(bu![i]).toBeNaN(); continue; }
      expect(bu![i]).toBeCloseTo(MAIN.high[i]! - e![i]!, 9);
      expect(be![i]).toBeCloseTo(MAIN.low[i]! - e![i]!, 9);
    }
  });
});

describe("awesome", () => {
  // fast 2, slow 3, hl2 = x: 1 2 4 7 7
  const x = [1, 2, 4, 7, 7];
  it("is sma(hl2, fast) - sma(hl2, slow) coloured by its change", () => {
    const [ao, up, down] = run(S.awesome, { fast: 2, slow: 3 }, { close: x });
    absent(ao!, 2);
    // sma2: bar 2 3, bar 3 5.5, bar 4 7; sma3: bar 2 7/3, bar 3 13/3, bar 4 6
    at(ao!, 2, 3 - 7 / 3); at(ao!, 3, 5.5 - 13 / 3); at(ao!, 4, 7 - 6);
    // bar 3 rises (7/6 > 2/3), bar 4 falls (1 <= 7/6); bar 2 has no previous bar
    expect(up![2]).toBeNaN(); expect(down![2]).toBeNaN();
    at(up!, 3, 7 / 6); expect(down![3]).toBeNaN();
    at(down!, 4, 1); expect(up![4]).toBeNaN();
  });
  it("equals sma(hl2, 5) - sma(hl2, 34) from the TA-Lib verified sma", () => {
    const [ao] = run(S.awesome, {}, MAIN);
    const [a] = runStudy(smaStudy, { length: 5, source: "hl2" }, MAIN);
    const [b] = runStudy(smaStudy, { length: 34, source: "hl2" }, MAIN);
    expect(first(ao!)).toBe(33);
    for (let i = 33; i < ao!.length; i++) expect(ao![i]).toBeCloseTo(a![i]! - b![i]!, 9);
  });
  it("rejects fast >= slow", () => {
    expect(() => run(S.awesome, { fast: 34, slow: 5 }, MAIN)).toThrow(RangeError);
  });
});

describe("accelerator", () => {
  it("is AO minus its sma", () => {
    // fast 2, slow 3, signal 2, hl2 = 1 2 4 7 7: ao bar 2 2/3, bar 3 7/6, bar 4 1
    const [ac, up, down] = run(S.accelerator, { fast: 2, slow: 3, signal: 2 }, { close: [1, 2, 4, 7, 7] });
    absent(ac!, 3);
    // sma2(ao): bar 3 (2/3 + 7/6) / 2 = 11/12, bar 4 (7/6 + 1) / 2 = 13/12
    at(ac!, 3, 7 / 6 - 11 / 12); // 1/4
    at(ac!, 4, 1 - 13 / 12); // -1/12
    at(down!, 4, 1 - 13 / 12); expect(up![4]).toBeNaN();
  });
  it("defaults start at bar 37", () => {
    expect(first(run(S.accelerator, {}, MAIN)[0]!)).toBe(33 + 4);
  });
});

describe("mass-index", () => {
  it("sums the ratio of the single to the double ema of the range", () => {
    // ema length 2, sum 2; range high - low = 2 4 2 6
    const [m] = run(S.massIndex, { length: 2, emaLength: 2 }, { high: [2, 4, 2, 6], low: [0, 0, 0, 0], close: [1, 1, 1, 1] });
    absent(m!, 3);
    // e1: bar 1 (2 + 4) / 2 = 3, bar 2 3 + 2/3 (2 - 3) = 7/3, bar 3 7/3 + 2/3 (6 - 7/3) = 43/9
    // e2 (ema of e1 from bar 1): bar 2 (3 + 7/3) / 2 = 8/3, bar 3 8/3 + 2/3 (43/9 - 8/3) = 110/27
    // ratio: bar 2 (7/3) / (8/3) = 7/8, bar 3 (43/9) / (110/27) = 129/110
    at(m!, 3, 7 / 8 + 129 / 110);
  });
  it("is positive; defaults start at bar 25", () => {
    const [m] = run(S.massIndex, {}, MAIN);
    expect(first(m!)).toBe(8 + 8 + 9);
    for (const v of m!) if (v === v) expect(v).toBeGreaterThan(0);
  });
});

describe("dpo", () => {
  const close = [1, 2, 3, 4, 5, 6, 7, 8];
  it("subtracts the sma from barsback = floor(n/2) + 1 bars earlier", () => {
    // length 4 -> barsback 3; sma4 first at bar 3 = 2.5, bar 4 = 3.5; dpo[6] = close[6] - sma4[3]
    const [d] = run(S.dpo, { length: 4 }, { close });
    absent(d!, 6);
    at(d!, 6, 7 - 2.5);
    at(d!, 7, 8 - 3.5);
  });
  it("centered: the close barsback bars earlier minus the sma now", () => {
    const [d] = run(S.dpo, { length: 4, centered: true }, { close });
    absent(d!, 3);
    at(d!, 3, 1 - 2.5); // close[0] - sma4[3]
    at(d!, 4, 2 - 3.5); // close[1] - sma4[4]
  });
  it("default 21: barsback 11 puts the first value at bar 31 (20 centered)", () => {
    expect(first(run(S.dpo, {}, MAIN)[0]!)).toBe(20 + 11);
    expect(first(run(S.dpo, { centered: true }, MAIN)[0]!)).toBe(20);
  });
});

describe("schaff-tc", () => {
  it("double stochastic of the macd", () => {
    // fast 1 (ema = close), slow 2, cycle 2, d1 1 (identity), d2 2; close 1 3 2 5 4 6
    const [s] = run(S.schaffTc, { fast: 1, slow: 2, cycle: 2, d1: 1, d2: 2 }, { close: [1, 3, 2, 5, 4, 6] });
    // ema2 (alpha 2/3): bar 1 seed 2, bar 2 2, bar 3 2 + 2/3 * 3 = 4, bar 4 4, bar 5 4 + 2/3 * 2 = 16/3
    // macd = close - ema2: bar 1 1, bar 2 0, bar 3 1, bar 4 0, bar 5 2/3
    // k = stoch(macd, 2): bar 2 window (1, 0) at its low -> 0; bar 3 (0, 1) -> 100; bar 4 (1, 0) -> 0; bar 5 (0, 2/3) -> 100
    // kd = stoch(k, 2): bar 3 window (0, 100) -> 100; bar 4 (100, 0) -> 0; bar 5 (0, 100) -> 100
    // stc = ema2(kd): bar 4 seed (100 + 0) / 2 = 50; bar 5 50 + 2/3 (100 - 50) = 250/3
    absent(s!, 4);
    at(s!, 4, 50);
    at(s!, 5, 250 / 3);
  });
  it("stays within 0..100; defaults need bar 71 (49 macd + 9 + 2 + 9 + 2)", () => {
    const [s] = run(S.schaffTc, {}, MAIN);
    // the dataset opens with ten bars of d pinned at 100 (a flat range, nothing to carry yet): absent until it moves
    expect(first(s!)).toBeGreaterThanOrEqual(49 + 9 + 2 + 9 + 2);
    for (const v of s!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
});

describe("stoch-tv", () => {
  it("is 100 (close - lowest low) / (highest high - lowest low)", () => {
    // length 3, smoothing 1, %D 2; high 10 12 11 13, low 8 9 9 10, close 9 11 10 12
    const [k, d] = run(S.stochTv, { kLength: 3, kSmooth: 1, dLength: 2 }, { high: [10, 12, 11, 13], low: [8, 9, 9, 10], close: [9, 11, 10, 12] });
    absent(k!, 2);
    at(k!, 2, (100 * (10 - 8)) / (12 - 8)); // 50
    at(k!, 3, (100 * (12 - 9)) / (13 - 9)); // 75
    absent(d!, 3);
    at(d!, 3, (50 + 75) / 2);
  });
  it("a flat range is absent (TradingView division by zero), not 0", () => {
    const [k] = run(S.stochTv, { kLength: 2 }, { high: [5, 5, 5], low: [5, 5, 5], close: [5, 5, 5] });
    expect(k![2]).toBeNaN();
  });
});

describe("invariants on random walks", () => {
  const d = randomBars(500, 7);
  it("every output is finite or absent; no infinities", () => {
    for (const def of Object.values(S)) {
      for (const col of runStudy(def, {}, d)) for (const v of col) expect(v === v ? Number.isFinite(v) : true).toBe(true);
    }
  });
  it("fisher has a value from bar length - 1", () => {
    const [f, t] = runStudy(S.fisher, {}, d);
    expect(first(f!)).toBe(8);
    expect(first(t!)).toBe(9);
  });
  it("bounded studies stay in range", () => {
    for (const v of runStudy(S.connorsRsi, {}, d)[0]!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    for (const v of runStudy(S.rviVolatility, {}, d)[0]!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    for (const v of runStudy(S.massIndex, {}, d)[0]!) if (v === v) expect(v).toBeGreaterThan(0);
    for (const v of runStudy(S.stochTv, {}, d)[0]!) if (v === v) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
  it("vortex is non-negative", () => {
    for (const col of runStudy(S.vortex, {}, d)) for (const v of col) if (v === v) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("parameters", () => {
  it("reject out-of-range input loudly", () => {
    expect(() => run(S.fisher, { length: 0 }, MAIN)).toThrow(RangeError);
    expect(() => run(S.choppiness, { length: 1 }, MAIN)).toThrow(RangeError);
    expect(() => run(S.rankCorr, { length: 1.5 }, MAIN)).toThrow(RangeError);
    expect(() => run(S.rviVolatility, { ma: "sma" }, MAIN)).toThrow(RangeError);
  });
});
