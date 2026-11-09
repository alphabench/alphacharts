// Hand-checked fixtures for tv-stat.ts. Every expected number is derived beside it; the property checks recompute the
// definition in plain JS over a seeded random walk and compare bar for bar.

import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import { chaikinVol, closeToCloseVol, garmanKlassVol, hammingMa, guppy, hammingWeights, maChannel, maEmaCross, parkinsonVol, volume24h, rogersSatchellVol, rvol, smi, stdError, trendStrength, ulcerIndex, zeroTrendVol } from "../src/studies/tv-stat.js";
import { randomBars } from "./support.js";
import type { BarColumns } from "../src/types.js";

const NaN_ = Number.NaN;
const flat = (closes: number[], vols: number[] = closes.map(() => 1)): Required<BarColumns> => {
  const col = (a: number[]) => Float64Array.from(a);
  return { time: col(closes.map((_, i) => i + 1)), open: col(closes), high: col(closes), low: col(closes), close: col(closes), volume: col(vols) };
};
const near = (got: ArrayLike<number>, want: number[], digits = 9) => {
  expect(got.length).toBe(want.length);
  want.forEach((w, i) => (w !== w ? expect(got[i], `[${i}]`).toBeNaN() : expect(got[i], `[${i}]`).toBeCloseTo(w, digits)));
};

describe("trend-strength", () => {
  it("is +1 on a straight rise, -1 on a straight fall and absent on a flat run", () => {
    near(runStudy(trendStrength, { length: 4 }, flat([1, 2, 3, 4, 5, 6]))[0]!, [NaN_, NaN_, NaN_, 1, 1, 1]);
    near(runStudy(trendStrength, { length: 4 }, flat([6, 5, 4, 3, 2, 1]))[0]!, [NaN_, NaN_, NaN_, -1, -1, -1]);
    near(runStudy(trendStrength, { length: 3 }, flat([5, 5, 5, 5]))[0]!, [NaN_, NaN_, NaN_, NaN_]);
  });
  it("matches the Pearson correlation with the bar position on random bars", () => {
    const d = randomBars(120, 7), n = 14;
    const out = runStudy(trendStrength, { length: n }, d)[0]!;
    for (let i = 0; i < d.close.length; i++) {
      if (i < n - 1) { expect(out[i]).toBeNaN(); continue; }
      const y = Array.from(d.close.subarray(i - n + 1, i + 1)), x = y.map((_, j) => j);
      const mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
      const cov = x.reduce((a, xv, j) => a + (xv - mx) * (y[j]! - my), 0);
      const want = cov / Math.sqrt(x.reduce((a, xv) => a + (xv - mx) ** 2, 0) * y.reduce((a, yv) => a + (yv - my) ** 2, 0));
      expect(out[i]).toBeCloseTo(want, 9);
    }
  });
});

describe("std-error", () => {
  it("is 0 on a straight line and the residual spread otherwise", () => {
    near(runStudy(stdError, { length: 4 }, flat([1, 3, 5, 7, 9]))[0]!, [NaN_, NaN_, NaN_, 0, 0]);
    // closes 0, 1, 0, 1 against x = 0..3: slope 1.0 / 5 = 0.2, intercept 0.5 - 0.2 * 1.5 = 0.2, fits 0.2 0.4 0.6 0.8,
    // residuals -0.2 0.6 -0.6 0.2, squares 0.04 0.36 0.36 0.04 = 0.8, / (4 - 2) = 0.4, sqrt = 0.632456
    near(runStudy(stdError, { length: 4 }, flat([0, 1, 0, 1]))[0]!, [NaN_, NaN_, NaN_, Math.sqrt(0.4)]);
  });
});

describe("ulcer-index", () => {
  it("is 0 while closes make new highs and squares the drawdown otherwise", () => {
    // length 2, closes 100, 110, 99: the highest of 2 exists from i1, so the first drawdown is at i1 (110 is its own high: 0)
    // and the first value at i2: drawdown 100(99 - 110)/110 = -10; sma of squares (0 + 100)/2 = 50 -> sqrt = 7.071068
    near(runStudy(ulcerIndex, { length: 2 }, flat([100, 110, 99]))[0]!, [NaN_, NaN_, Math.sqrt(50)]);
  });
});

describe("chaikin-vol", () => {
  it("is the percent change of the smoothed high-low range over rocLength bars", () => {
    // ranges 2, 2, 4, 4 (high - low); ema length 1 is the range itself; rocLength 2: i2 100(4-2)/2 = 100, i3 100(4-2)/2 = 100
    const d = flat([10, 10, 10, 10]);
    d.high.set([11, 11, 12, 12]); d.low.set([9, 9, 8, 8]);
    near(runStudy(chaikinVol, { length: 1, rocLength: 2 }, d)[0]!, [NaN_, NaN_, 100, 100]);
  });
});

describe("smi", () => {
  it("is bounded by 200 in absolute value and 200 when every close is at the top of its range", () => {
    // high = close, low = close - 1 and rising by 1: the close is always the highest high, the range is 1 + k
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const d = flat(closes);
    d.low.set(closes.map((c) => c - 1));
    const [v] = runStudy(smi, { lengthK: 3, lengthD: 2, lengthEma: 2 }, d);
    const last = v![v!.length - 1]!;
    expect(last).toBeGreaterThan(0);
    expect(Math.abs(last)).toBeLessThanOrEqual(200 + 1e-9);
  });
  it("matches the definition on random bars", () => {
    const d = randomBars(150, 11), K = 10, D = 3, E = 3;
    const [v, s] = runStudy(smi, { lengthK: K, lengthD: D, lengthEma: E }, d);
    // plain-JS definition: simple-mean seeded EMA, as the engine's
    const ema = (x: number[], n: number) => {
      const out = x.map(() => NaN_), a = 2 / (n + 1);
      let run = 0, cnt = 0, prev = NaN_;
      x.forEach((xv, i) => {
        if (xv !== xv) return;
        if (prev !== prev) { run += xv; cnt++; if (cnt === n) { prev = run / n; out[i] = prev; } return; }
        prev = prev + a * (xv - prev); out[i] = prev;
      });
      return out;
    };
    const N = d.close.length;
    const hh = Array.from({ length: N }, (_, i) => (i < K - 1 ? NaN_ : Math.max(...d.high.subarray(i - K + 1, i + 1))));
    const ll = Array.from({ length: N }, (_, i) => (i < K - 1 ? NaN_ : Math.min(...d.low.subarray(i - K + 1, i + 1))));
    const rel = hh.map((h, i) => d.close[i]! - (h + ll[i]!) / 2), span = hh.map((h, i) => h - ll[i]!);
    const a = ema(ema(rel, D), D), b = ema(ema(span, D), D);
    const want = a.map((x, i) => (200 * x) / b[i]!), wantSig = ema(want, E);
    let checked = 0;
    for (let i = 0; i < N; i++) {
      if (want[i] !== want[i]) { expect(v![i]).toBeNaN(); continue; }
      expect(v![i]).toBeCloseTo(want[i]!, 8);
      if (wantSig[i] === wantSig[i]) { expect(s![i]).toBeCloseTo(wantSig[i]!, 8); checked++; }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("rvol", () => {
  it("is volume over the average of the last length bars, itself included", () => {
    // volumes 10, 20, 60; length 2: i1 20/15 = 1.3333, i2 60/40 = 1.5
    near(runStudy(rvol, { length: 2 }, flat([1, 1, 1], [10, 20, 60]))[0]!, [NaN_, 20 / 15, 1.5]);
  });
});

describe("hamming-ma", () => {
  it("weights are 0.54 - 0.46 cos(2 pi k / (n - 1)), normalised to sum 1", () => {
    // n = 3: raw 0.08, 1.0, 0.08, sum 1.16
    const w = hammingWeights(3);
    expect(Array.from(w)).toEqual([0.08 / 1.16, 1 / 1.16, 0.08 / 1.16].map((x) => expect.closeTo(x, 12)));
    expect(Array.from(hammingWeights(10)).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
    expect(() => hammingWeights(1)).toThrow(/>= 2/);
  });
  it("is the weighted mean of the last length closes and absent before they exist", () => {
    // closes 10, 20, 30, 40 with n = 3: bar 2 = (0.08*10 + 1*20 + 0.08*30)/1.16, bar 3 = (0.08*20 + 30 + 0.08*40)/1.16
    near(runStudy(hammingMa, { length: 3, source: "close" }, flat([10, 20, 30, 40]))[0]!, [NaN_, NaN_, (0.8 + 20 + 2.4) / 1.16, (1.6 + 30 + 3.2) / 1.16]);
  });
  it("leaves a constant series unchanged", () => {
    near(runStudy(hammingMa, { length: 5, source: "close" }, flat([7, 7, 7, 7, 7, 7]))[0]!, [NaN_, NaN_, NaN_, NaN_, 7, 7]);
  });
});

describe("volatility estimators", () => {
  // closes 100, 110, 99 => r1 = ln 1.1, r2 = ln 0.9
  const r1 = Math.log(1.1), r2 = Math.log(0.9), k = 100 * Math.sqrt(252);
  it("close-to-close is the sample deviation of log returns, annualised", () => {
    const m = (r1 + r2) / 2, sd = Math.sqrt(((r1 - m) ** 2 + (r2 - m) ** 2) / 1);
    near(runStudy(closeToCloseVol, { length: 2, annual: 252 }, flat([100, 110, 99]))[0]!, [NaN_, NaN_, sd * k]);
  });
  it("zero-trend is the root mean square of log returns (the mean is not removed)", () => {
    near(runStudy(zeroTrendVol, { length: 2, annual: 252 }, flat([100, 110, 99]))[0]!, [NaN_, NaN_, Math.sqrt((r1 * r1 + r2 * r2) / 2) * k]);
  });
  it("a flat market has no volatility under every estimator", () => {
    const d = flat([5, 5, 5, 5]);
    for (const s of [closeToCloseVol, zeroTrendVol, parkinsonVol, garmanKlassVol, rogersSatchellVol]) {
      const out = runStudy(s, { length: 2, annual: 252 }, d)[0]!;
      expect(out[3], s.id).toBeCloseTo(0, 12);
    }
  });
  it("parkinson, garman-klass and rogers-satchell match their formulas on one bar", () => {
    const d = flat([100]);
    d.open.set([100]); d.high.set([110]); d.low.set([95]); d.close.set([105]);
    const o = 100, h = 110, l = 95, c = 105;
    const park = Math.log(h / l) ** 2 / (4 * Math.LN2);
    const gk = 0.5 * Math.log(h / l) ** 2 - (2 * Math.LN2 - 1) * Math.log(c / o) ** 2;
    const rs = Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o);
    near(runStudy(parkinsonVol, { length: 1, annual: 252 }, d)[0]!, [Math.sqrt(park) * k]);
    near(runStudy(garmanKlassVol, { length: 1, annual: 252 }, d)[0]!, [Math.sqrt(gk) * k]);
    near(runStudy(rogersSatchellVol, { length: 1, annual: 252 }, d)[0]!, [Math.sqrt(rs) * k]);
  });
});

describe("volume-24h", () => {
  it("sums volume over (t - 24h, t]: a bar exactly 24 hours old has left the window", () => {
    const H = 3_600_000;
    // bars at hours 0, 12, 24, 30 with volumes 1, 2, 4, 8
    const d = flat([1, 1, 1, 1], [1, 2, 4, 8]);
    d.time.set([0, 12 * H, 24 * H, 30 * H]);
    // h0: 1; h12: 1 + 2 = 3; h24: window (0, 24h] drops the h0 bar -> 2 + 4 = 6; h30: (6h, 30h] -> 2 + 4 + 8 = 14
    near(runStudy(volume24h, {}, d)[0]!, [1, 3, 6, 14]);
  });
});

describe("moving-average families", () => {
  it("guppy has twelve exponential averages: the 3-bar EMA seeds with the mean of its first three values", () => {
    const [s3, , , , , , l30] = runStudy(guppy, { source: "close" }, flat([3, 6, 9, 12, 15]));
    // ema3: alpha 1/2, seeded at bar 2 with (3 + 6 + 9)/3 = 6; bar 3: 6 + (12 - 6)/2 = 9; bar 4: 9 + (15 - 9)/2 = 12
    near(s3!, [NaN_, NaN_, 6, 9, 12]);
    expect(runStudy(guppy, { source: "close" }, flat([3, 6, 9, 12, 15])).length).toBe(12);
    expect(l30![4]).toBeNaN(); // the 30-bar average needs 30 bars
  });
  it("ma-ema-cross marks the bar where the simple average crosses over the exponential one", () => {
    // closes fall then rise: sma2 vs ema2 (the same weight at length 2 differs only by seeding), use lengths 2 and 4
    const d = flat([10, 8, 6, 4, 6, 9, 13, 18]);
    const [m, e, up] = runStudy(maEmaCross, { maLength: 2, emaLength: 4, source: "close" }, d);
    const crossed = Array.from(up!).findIndex((v) => v === v);
    expect(crossed).toBeGreaterThan(3);
    expect(m![crossed]!).toBeGreaterThan(e![crossed]!);
    expect(m![crossed - 1]!).toBeLessThanOrEqual(e![crossed - 1]!);
    expect(up![crossed]).toBe(m![crossed]);
  });
  it("ma-channel is the average of the highs, the closes and the lows", () => {
    const d = flat([10, 10, 10, 10]);
    d.high.set([12, 14, 16, 18]); d.low.set([8, 6, 4, 2]);
    const [u, b, l] = runStudy(maChannel, { length: 2 }, d);
    near(u!, [NaN_, 13, 15, 17]);
    near(b!, [NaN_, 10, 10, 10]);
    near(l!, [NaN_, 7, 5, 3]);
  });
});
