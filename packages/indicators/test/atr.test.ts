// ATR and NATR are Wilder's, not TA-Lib's (TA-Lib skips the first true range; see the
// studies' `reference`). Checked against a hand case and against an independent loop written from the definition.

import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import { atr, natr } from "../src/studies/volatility.js";
import { MAIN } from "./support.js";

// ATR(3) on H/L/C (110,90,100) (102,98,100) (103,99,101) (104,100,102) (105,101,103) (106,102,104).
// TR0 = 110-90 = 20; TR1..TR5 = 4 each (the previous close is inside every range).
// Seed at bar 2 = (20+4+4)/3; then a = a' + (TR - a')/3.
const H = [110, 102, 103, 104, 105, 106], L = [90, 98, 99, 100, 101, 102], C = [100, 100, 101, 102, 103, 104];
const hand = (() => {
  const a = [NaN, NaN, 28 / 3];
  for (let i = 3; i < 6; i++) a.push(a[i - 1]! + (4 - a[i - 1]!) / 3);
  return a;
})();
const small = () => ({
  time: Float64Array.from(H, (_, i) => 1_700_000_000_000 + i * 60_000),
  open: Float64Array.from(C), high: Float64Array.from(H), low: Float64Array.from(L), close: Float64Array.from(C), volume: new Float64Array(6).fill(1),
});

/** Wilder's definition, written out: TR0 = H-L, seed = mean(TR[0..p-1]) at bar p-1, then (a*(p-1) + TR)/p. */
function wilder(h: Float64Array, l: Float64Array, c: Float64Array, p: number): number[] {
  const n = h.length, tr: number[] = [], out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) tr.push(i === 0 ? h[i]! - l[i]! : Math.max(h[i]! - l[i]!, Math.abs(h[i]! - c[i - 1]!), Math.abs(l[i]! - c[i - 1]!)));
  let s = 0;
  for (let i = 0; i < p; i++) s += tr[i]!;
  out[p - 1] = s / p;
  for (let i = p; i < n; i++) out[i] = (out[i - 1]! * (p - 1) + tr[i]!) / p;
  return out;
}

describe("atr is Wilder's", () => {
  it("hand case: 9.333333, 7.555556, 6.370370, 5.580247 from bar 2", () => {
    const a = runStudy(atr, { length: 3 }, small())[0]!;
    expect(a[0]).toBeNaN();
    expect(a[1]).toBeNaN();
    expect(a[2]).toBeCloseTo(9.333333, 6);
    expect(a[3]).toBeCloseTo(7.555556, 6);
    expect(a[4]).toBeCloseTo(6.37037, 6);
    expect(a[5]).toBeCloseTo(5.580247, 6);
    for (let i = 2; i < 6; i++) expect(a[i]).toBeCloseTo(hand[i]!, 12);
  });

  it.each([1, 5, 14, 50])("matches the definition on the 400-bar set, length %i", (p) => {
    const want = wilder(MAIN.high, MAIN.low, MAIN.close, p);
    const got = runStudy(atr, { length: p }, MAIN)[0]!;
    for (let i = 0; i < want.length; i++) {
      if (want[i] !== want[i]) expect(got[i], `bar ${i}`).toBeNaN();
      else expect(got[i]!, `bar ${i}`).toBeCloseTo(want[i]!, 9);
    }
  });

  it("natr = 100 * atr / close", () => {
    const want = wilder(MAIN.high, MAIN.low, MAIN.close, 14);
    const got = runStudy(natr, { length: 14 }, MAIN)[0]!;
    for (let i = 0; i < want.length; i++) {
      if (want[i] !== want[i]) expect(got[i]).toBeNaN();
      else expect(got[i]!).toBeCloseTo((100 * want[i]!) / MAIN.close[i]!, 9);
    }
  });
});
