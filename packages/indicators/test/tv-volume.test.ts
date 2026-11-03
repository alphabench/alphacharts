// Hand-checked fixtures for the TradingView volume group (tv-volume.ts). Every
// expected number is derived in the comment beside it; the two TA-Lib-comparable
// pieces (volume MA, volume oscillator) live in fixtures/cases/tv-volume.json.

import { describe, expect, it } from "vitest";
import { runStudy, resolveParams } from "../src/engine/study.js";
import { adr, anchoredVwap, chaikinMf, eom, elderForce, histVol, klinger, netVolume, pivotPoints, pvt, volume, volumeOsc, vwap } from "../src/studies/tv-volume.js";
import { MAIN } from "./support.js";
import type { BarColumns } from "../src/types.js";

const NaN_ = Number.NaN;
type Row = [time: number, open: number, high: number, low: number, close: number, volume: number];

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);

function bars(rows: Row[]): Required<BarColumns> {
  const col = (k: number) => Float64Array.from(rows.map((r) => r[k]!));
  return { time: col(0), open: col(1), high: col(2), low: col(3), close: col(4), volume: col(5) };
}
/** Bars with explicit closes only (open=high=low=close), volume given. */
const flat = (times: number[], closes: number[], vols: number[]) => bars(closes.map((c, i) => [times[i]!, c, c, c, c, vols[i]!]));
const same = (times: number[], v = 1) => times.map(() => v);

function expectSeries(got: ArrayLike<number>, want: number[], digits = 6): void {
  expect(got.length).toBe(want.length);
  want.forEach((w, i) => {
    if (w !== w) expect(got[i], `[${i}] should be absent`).toBeNaN();
    else expect(got[i], `[${i}]`).toBeCloseTo(w, digits);
  });
}

describe("volume", () => {
  it("splits volume by close vs open and averages it", () => {
    // open 10 each; close 11 (up), 9 (down), 10 (not up -> down)
    const d = bars([[1, 10, 12, 8, 11, 100], [2, 10, 12, 8, 9, 200], [3, 10, 12, 8, 10, 300]]);
    const [v, up, dn, ma] = runStudy(volume, { maLength: 2 }, d);
    expectSeries(v!, [100, 200, 300]);
    expectSeries(up!, [100, NaN_, NaN_]);
    expectSeries(dn!, [NaN_, 200, 300]);
    expectSeries(ma!, [NaN_, 150, 250]); // (100+200)/2, (200+300)/2
  });
});

describe("volume-osc", () => {
  it("is 100 (ema short - ema long) / ema long", () => {
    // volumes 10..50; ema2 (alpha 2/3) seeded at i1 with (10+20)/2 = 15, i2: 15+2/3(30-15)=25, i3: 25+2/3(40-25)=35, i4: 45
    // ema3 (alpha 1/2) seeded at i2 with (10+20+30)/3 = 20, i3: 20+(40-20)/2=30, i4: 30+(50-30)/2=40
    const t = [1, 2, 3, 4, 5];
    const [o] = runStudy(volumeOsc, { short: 2, long: 3 }, flat(t, [1, 1, 1, 1, 1], [10, 20, 30, 40, 50]));
    // i2: 100(25-20)/20 = 25; i3: 100(35-30)/30 = 16.6667; i4: 100(45-40)/40 = 12.5
    expectSeries(o!, [NaN_, NaN_, 25, 16.666667, 12.5]);
  });
});

describe("pvt / net-volume", () => {
  it("pvt accumulates change/previous close times volume from the second bar", () => {
    // closes 10, 12, 9; volumes 100, 200, 300
    // i1: (12-10)/10*200 = 40; i2: (9-12)/12*300 = -75 -> 40-75 = -35
    const [x] = runStudy(pvt, {}, flat([1, 2, 3], [10, 12, 9], [100, 200, 300]));
    expectSeries(x!, [NaN_, 40, -35]);
  });
  it("net volume signs volume by the close change", () => {
    // closes 10, 11, 11, 10; volumes 5, 6, 7, 8 -> up +6, unchanged 0, down -8
    const [x] = runStudy(netVolume, {}, flat([1, 2, 3, 4], [10, 11, 11, 10], [5, 6, 7, 8]));
    expectSeries(x!, [NaN_, 6, 0, -8]);
  });
});

describe("elder-force", () => {
  it("is the EMA of change(close) * volume", () => {
    // closes 10,12,11,15,16 volumes 1..5 -> raw: -, 2*2=4, -1*3=-3, 4*4=16, 1*5=5
    // ema2 (alpha 2/3) seeded at i2 with (4-3)/2 = 0.5; i3: 0.5+2/3(16-0.5) = 65/6 = 10.8333; i4: 65/6+2/3(5-65/6) = 125/18 = 6.9444
    const [x] = runStudy(elderForce, { length: 2 }, flat([1, 2, 3, 4, 5], [10, 12, 11, 15, 16], [1, 2, 3, 4, 5]));
    expectSeries(x!, [NaN_, NaN_, 0.5, 65 / 6, 125 / 18]);
  });
});

describe("eom", () => {
  it("is the SMA of divisor * change(hl2) * range / volume", () => {
    // highs 12,14,16 lows 10,12,12 -> hl2 11,13,14 (change -,2,1), range 2,2,4, volume 1000,2000,4000
    // i1: 10000*2*2/2000 = 20; i2: 10000*1*4/4000 = 10; sma2 at i2 = 15
    const d = bars([[1, 11, 12, 10, 11, 1000], [2, 13, 14, 12, 13, 2000], [3, 14, 16, 12, 14, 4000]]);
    const [x] = runStudy(eom, { length: 2 }, d);
    expectSeries(x!, [NaN_, NaN_, 15]);
  });
});

describe("chaikin-mf", () => {
  it("is sum(ad)/sum(volume) with ad zero on a flat bar", () => {
    // bar0 h12 l10 c12: (24-10-12)/2 = 1 -> ad 100; bar1 c11: (22-10-12)/2 = 0 -> 0; bar2 h14 c10: (20-10-14)/4 = -1 -> -200
    const d = bars([[1, 11, 12, 10, 12, 100], [2, 11, 12, 10, 11, 100], [3, 11, 14, 10, 10, 200]]);
    const [x] = runStudy(chaikinMf, { length: 2 }, d);
    expectSeries(x!, [NaN_, 100 / 200, -200 / 300]); // i1: (100+0)/(100+100); i2: (0-200)/(100+200)
  });
  it("counts a bar with high == low as zero flow", () => {
    const d = bars([[1, 5, 5, 5, 5, 100], [2, 5, 6, 4, 6, 100]]);
    // bar1: (12-4-6)/2 = 1 -> 100; sum = 0 + 100 over 200
    expectSeries(runStudy(chaikinMf, { length: 2 }, d)[0]!, [NaN_, 0.5]);
  });
});

describe("klinger", () => {
  it("is ema(sv,fast) - ema(sv,slow) with an EMA signal", () => {
    // flat bars so hlc3 = close: closes 10,11,10,10,12,9 volumes 1..6; change -,+1,-1,0,+2,-3
    // sv = volume if change >= 0 else -volume: -, 2, -3, 4, 5, -6
    // ema2 (2/3) seeded at i2: (2-3)/2 = -0.5; i3: -0.5+2/3(4.5) = 2.5; i4: 2.5+2/3(2.5) = 25/6; i5: 25/6+2/3(-6-25/6) = -47/18
    // ema3 (1/2) seeded at i3: (2-3+4)/3 = 1; i4: 1+(5-1)/2 = 3; i5: 3+(-6-3)/2 = -1.5
    // kvo i3 = 2.5-1 = 1.5; i4 = 25/6-3 = 7/6; i5 = -47/18+3/2 = -10/9
    // signal ema2 (2/3) seeded at i4: (1.5+7/6)/2 = 4/3; i5: 4/3+2/3(-10/9-4/3) = -8/27
    const d = flat([1, 2, 3, 4, 5, 6], [10, 11, 10, 10, 12, 9], [1, 2, 3, 4, 5, 6]);
    const [k, s] = runStudy(klinger, { fast: 2, slow: 3, signal: 2 }, d);
    expectSeries(k!, [NaN_, NaN_, NaN_, 1.5, 7 / 6, -10 / 9]);
    expectSeries(s!, [NaN_, NaN_, NaN_, NaN_, 4 / 3, -8 / 27]);
  });
});

describe("vwap", () => {
  const T = [utc(2026, 1, 5, 10), utc(2026, 1, 5, 11), utc(2026, 1, 6, 9)];
  // hlc3: (12+8+10)/3 = 10 (v 100), (15+9+12)/3 = 12 (v 300), (20+16+18)/3 = 18 (v 50)
  const d = bars([[T[0]!, 10, 12, 8, 10, 100], [T[1]!, 12, 15, 9, 12, 300], [T[2]!, 18, 20, 16, 18, 50]]);

  it("accumulates within the session and restarts on the next day, with stdev bands", () => {
    const [w, up, lo] = runStudy(vwap, {}, d);
    // i1: (10*100 + 12*300)/400 = 11.5; mean of squares (100*100 + 144*300)/400 = 133; variance 133-11.5^2 = 0.75; sd 0.866025
    expectSeries(w!, [10, 11.5, 18]);
    expectSeries(up!, [10, 11.5 + 0.866025, 18]);
    expectSeries(lo!, [10, 11.5 - 0.866025, 18]);
  });
  it("band multiplier scales the stdev", () => {
    const [, up] = runStudy(vwap, { bandMult: 2 }, d);
    expectSeries(up!, [10, 11.5 + 2 * Math.sqrt(0.75), 18]); // sd = sqrt(0.75)
  });
  it("the session boundary follows the exchange time zone offset", () => {
    // 18:00 and 19:00 UTC on Jan 5: one UTC day, but at +330 min the second is 00:30 on Jan 6
    const t = [utc(2026, 1, 5, 18), utc(2026, 1, 5, 19)];
    const e = flat(t, [10, 20], [1, 1]);
    expectSeries(runStudy(vwap, { source: "close" }, e)[0]!, [10, 15]);
    expectSeries(runStudy(vwap, { source: "close", utcOffsetMinutes: 330 }, e)[0]!, [10, 20]);
  });
  it("weeks start on Monday, months and years on their first day", () => {
    // volume 1, source close: a VWAP is the running mean within the period
    const run = (anchor: string, t: number[]) => runStudy(vwap, { anchor, source: "close" }, flat(t, [10, 20, 30, 40], same(t)))[0]!;
    // Sun Jan 4 | Mon Jan 5 .. Sun Jan 11 | Mon Jan 12 -> 10 | 20, (20+30)/2 | 40
    expectSeries(run("week", [utc(2026, 1, 4), utc(2026, 1, 5), utc(2026, 1, 11), utc(2026, 1, 12)]), [10, 20, 25, 40]);
    expectSeries(run("month", [utc(2026, 1, 31), utc(2026, 2, 1), utc(2026, 2, 28), utc(2026, 3, 1)]), [10, 20, 25, 40]);
    expectSeries(run("year", [utc(2025, 12, 31), utc(2026, 1, 1), utc(2026, 12, 31), utc(2027, 1, 1)]), [10, 20, 25, 40]);
    // a leap day stays in February
    expectSeries(run("month", [utc(2024, 2, 28), utc(2024, 2, 29), utc(2024, 3, 1), utc(2024, 3, 2)]), [10, 15, 30, 35]);
  });
  it("stays between the session's lowest low and highest high, with symmetric bands", () => {
    const [w, up, lo] = runStudy(vwap, {}, MAIN);
    let day = -1, hi = 0, lw = 0;
    for (let i = 0; i < MAIN.time.length; i++) {
      const dd = Math.floor(MAIN.time[i]! / 86_400_000);
      if (dd !== day) { day = dd; hi = MAIN.high[i]!; lw = MAIN.low[i]!; }
      hi = Math.max(hi, MAIN.high[i]!); lw = Math.min(lw, MAIN.low[i]!);
      expect(w![i]!).toBeGreaterThanOrEqual(lw - 1e-9);
      expect(w![i]!).toBeLessThanOrEqual(hi + 1e-9);
      expect(up![i]! - w![i]!).toBeCloseTo(w![i]! - lo![i]!, 9);
    }
  });
});

describe("anchored-vwap", () => {
  const t = [10, 20, 30, 40];
  const d = flat(t, [10, 20, 30, 50], same(t));
  it("is absent before the anchor and accumulates from its bar", () => {
    // anchored at t=30: bar2 = 30; bar3 = (30+50)/2 = 40, pv2 mean (900+2500)/2 = 1700, variance 1700-1600 = 100, sd 10
    const [w, up, lo] = runStudy(anchoredVwap, { anchorTime: 30, source: "close" }, d);
    expectSeries(w!, [NaN_, NaN_, 30, 40]);
    expectSeries(up!, [NaN_, NaN_, 30, 50]);
    expectSeries(lo!, [NaN_, NaN_, 30, 30]);
  });
  it("an anchor between bars starts at the next bar, and one past the data gives nothing", () => {
    expectSeries(runStudy(anchoredVwap, { anchorTime: 25, source: "close" }, d)[0]!, [NaN_, NaN_, 30, 40]);
    expectSeries(runStudy(anchoredVwap, { anchorTime: 99, source: "close" }, d)[0]!, [NaN_, NaN_, NaN_, NaN_]);
  });
  it("resets only at its anchor (default anchor covers every bar)", () => {
    expectSeries(runStudy(anchoredVwap, { source: "close" }, d)[0]!, [10, 15, 20, 27.5]); // running mean 10, 30/2, 60/3, 110/4
  });
});

describe("pivot-points", () => {
  // day 1 (Mon Jan 5): O10 H20 L8 C15, then O15 H18 L5 C12 -> period O10 H20 L5 C12; day 2: two bars
  const D1 = utc(2026, 1, 5, 10), D2 = utc(2026, 1, 6, 10);
  const d = bars([[D1, 10, 20, 8, 15, 1], [D1 + 3.6e6, 15, 18, 5, 12, 1], [D2, 12, 13, 11, 12, 1], [D2 + 3.6e6, 12, 14, 10, 13, 1]]);
  const levelsOf = (kind: string) => runStudy(pivotPoints, { kind }, d);
  // columns: p r1 r2 r3 r4 s1 s2 s3 s4
  const at = (cols: Float64Array[], i: number) => cols.map((c) => c[i]!);
  const P = 37 / 3; // (20+5+12)/3, range 15

  it("is absent in the first period and constant over the next", () => {
    const c = levelsOf("standard");
    expect(at(c, 0).every(Number.isNaN)).toBe(true);
    expect(at(c, 1).every(Number.isNaN)).toBe(true);
    expect(at(c, 3)).toEqual(at(c, 2));
  });
  it("standard", () => {
    // R1 = 2P-L = 19.6667, S1 = 2P-H = 4.6667, R2 = P+15, S2 = P-15, R3 = 2P+H-2L = 34.6667, S3 = 2P-(2H-L) = -10.3333, R4 = 3P+H-3L = 42, S4 = 3P-(3H-L) = -18
    expectSeries(at(levelsOf("standard"), 2), [P, 59 / 3, P + 15, 104 / 3, 42, 14 / 3, P - 15, -31 / 3, -18]);
  });
  it("fibonacci", () => {
    // P +/- 0.382*15 = 5.73, 0.618*15 = 9.27, 15; no fourth level
    expectSeries(at(levelsOf("fibonacci"), 2), [P, P + 5.73, P + 9.27, P + 15, NaN_, P - 5.73, P - 9.27, P - 15, NaN_]);
  });
  it("woodie", () => {
    // P = (20+5+24)/4 = 12.25; R1 = 24.5-5 = 19.5, S1 = 24.5-20 = 4.5, R2 = 27.25, S2 = -2.75, R3 = H+2*15 = 50, S3 = L-30 = -25, R4 = 65, S4 = -40
    expectSeries(at(levelsOf("woodie"), 2), [12.25, 19.5, 27.25, 50, 65, 4.5, -2.75, -25, -40]);
  });
  it("classic", () => {
    // P = 37/3; R1 = 2P-L, S1 = 2P-H; R2..R4 = P + 15, 30, 45; S2..S4 = P - 15, 30, 45
    expectSeries(at(levelsOf("classic"), 2), [P, 59 / 3, P + 15, P + 30, P + 45, 14 / 3, P - 15, P - 30, P - 45]);
  });
  it("camarilla", () => {
    // C = 12, 1.1*15 = 16.5: R1..R4 = 12 + 16.5/12, /6, /4, /2 = 13.375, 14.75, 16.125, 20.25
    expectSeries(at(levelsOf("camarilla"), 2), [P, 13.375, 14.75, 16.125, 20.25, 10.625, 9.25, 7.875, 3.75]);
  });
  it("dm picks its numerator from the previous open vs close", () => {
    // O10 C12 (close > open): X = 2H+L+C = 57, P = 14.25, R1 = X/2-L = 23.5, S1 = X/2-H = 8.5
    expectSeries(at(levelsOf("dm"), 2), [14.25, 23.5, NaN_, NaN_, NaN_, 8.5, NaN_, NaN_, NaN_]);
    const pv = (o: number, c: number) => at(runStudy(pivotPoints, { kind: "dm" }, bars([[D1, o, 20, 5, c, 1], [D2, 1, 2, 1, 1, 1]])), 1).slice(0, 2);
    expectSeries(pv(12, 10), [10, 15]); // close < open: X = H+2L+C = 40 -> P 10, R1 = 20-5
    expectSeries(pv(10, 10), [11.25, 17.5]); // equal: X = H+L+2C = 45 -> P 11.25, R1 = 22.5-5
  });
  it("rolls at the day, week, month and year boundary", () => {
    // first period holds A (H10 L2 C6 O3) and B (H8 L4 C5 O6) -> H10 L2 C5, P = 17/3; then two bars of the next period
    const run = (period: string, t: number[]) => {
      const rows: Row[] = [[t[0]!, 3, 10, 2, 6, 1], [t[1]!, 6, 8, 4, 5, 1], [t[2]!, 5, 9, 5, 7, 1], [t[3]!, 7, 9, 6, 8, 1]];
      return runStudy(pivotPoints, { period }, bars(rows))[0]!;
    };
    const want = [NaN_, NaN_, 17 / 3, 17 / 3];
    expectSeries(run("day", [utc(2026, 1, 5, 10), utc(2026, 1, 5, 11), utc(2026, 1, 6, 10), utc(2026, 1, 6, 11)]), want);
    expectSeries(run("week", [utc(2026, 1, 5), utc(2026, 1, 11), utc(2026, 1, 12), utc(2026, 1, 13)]), want); // Sunday Jan 11 still belongs to the week of Monday Jan 5
    expectSeries(run("month", [utc(2026, 1, 1), utc(2026, 1, 31), utc(2026, 2, 1), utc(2026, 2, 2)]), want);
    expectSeries(run("year", [utc(2025, 1, 1), utc(2025, 12, 31), utc(2026, 1, 1), utc(2026, 1, 2)]), want);
  });
  it("shifts the boundary with the exchange offset", () => {
    // 18:30 UTC is midnight at +330: bars at 18:00 and 18:30 UTC fall in different days only with the offset
    const t = [utc(2026, 1, 5, 18, 0), utc(2026, 1, 5, 18, 30)];
    const e = bars([[t[0]!, 3, 10, 2, 6, 1], [t[1]!, 6, 8, 4, 5, 1]]);
    expectSeries(runStudy(pivotPoints, { utcOffsetMinutes: 330 }, e)[0]!, [NaN_, (10 + 2 + 6) / 3]);
    expectSeries(runStudy(pivotPoints, {}, e)[0]!, [NaN_, NaN_]);
  });
  it("orders S3 < S2 < S1 < P < R1 < R2 < R3 for standard pivots", () => {
    const c = runStudy(pivotPoints, { kind: "standard" }, MAIN);
    const [p, r1, r2, r3, , s1, s2, s3] = c;
    let seen = 0;
    for (let i = 0; i < MAIN.time.length; i++) {
      if (p![i]! !== p![i]!) continue;
      seen++;
      expect(s3![i]!).toBeLessThan(s2![i]!);
      expect(s2![i]!).toBeLessThan(s1![i]!);
      expect(s1![i]!).toBeLessThan(p![i]!);
      expect(p![i]!).toBeLessThan(r1![i]!);
      expect(r1![i]!).toBeLessThan(r2![i]!);
      expect(r2![i]!).toBeLessThan(r3![i]!);
    }
    expect(seen).toBeGreaterThan(100);
  });
});

describe("hist-vol", () => {
  it("is 100 * population stdev of log returns * sqrt(annual / days)", () => {
    // closes 100, 110, 99, 108.9: returns ln1.1 = 0.0953102, ln0.9 = -0.1053605, ln1.1 = 0.0953102
    // population stdev of two values = |a-b|/2 = 0.2006707/2 = 0.10033535 (a sample stdev would be 1.41421 times larger)
    // annual 1: 100*0.10033535 = 10.033535; annual 252: 10.033535*sqrt(252) = 10.033535*15.8745079 = 159.2774
    const d = flat([1, 2, 3, 4], [100, 110, 99, 108.9], same([1, 2, 3, 4]));
    expectSeries(runStudy(histVol, { length: 2, annual: 1 }, d)[0]!, [NaN_, NaN_, 10.033535, 10.033535], 5);
    expectSeries(runStudy(histVol, { length: 2 }, d)[0]!, [NaN_, NaN_, 159.2774, 159.2774], 2);
    // 7 days per bar: sqrt(252/7) = 6 -> 60.2012
    expectSeries(runStudy(histVol, { length: 2, periodDays: 7 }, d)[0]!, [NaN_, NaN_, 60.2012, 60.2012], 3);
  });
});

describe("adr", () => {
  it("is the SMA of high - low", () => {
    // ranges 2, 4, 6, 8
    const d = bars([[1, 5, 6, 4, 5, 1], [2, 5, 7, 3, 5, 1], [3, 5, 8, 2, 5, 1], [4, 5, 9, 1, 5, 1]]);
    expectSeries(runStudy(adr, { length: 2 }, d)[0]!, [NaN_, 3, 5, 7]);
  });
});

describe("parameters", () => {
  it("fail loudly", () => {
    expect(() => resolveParams(vwap, { anchor: "hour" })).toThrow(RangeError);
    expect(() => resolveParams(pivotPoints, { kind: "pitchfork" })).toThrow(RangeError);
    expect(() => resolveParams(volumeOsc, { short: 0 })).toThrow(RangeError);
    expect(() => resolveParams(vwap, { utcOffsetMinutes: 1.5 })).toThrow(RangeError);
    expect(() => resolveParams(histVol, { length: 1 })).toThrow(RangeError);
  });
});
