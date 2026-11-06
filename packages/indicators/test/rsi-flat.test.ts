// RSI with an undefined RS (the first `length` changes all zero): 100, the convention of charting
// packages, not TA-Lib's 0. Hand case: closes 100,100,100,100,101,100, length 3.
//   changes 0,0,0,+1,-1 ; seed at bar 3 = mean of changes 1..3: gain 0, loss 0 -> RS = 0/0 -> 100
//   bar 4: gain (0*2+1)/3 = 1/3, loss 0 -> 100
//   bar 5: gain (1/3*2+0)/3 = 2/9, loss (0*2+1)/3 = 1/3 -> RSI = 100*(2/9)/(2/9+1/3) = 40

import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import { rsi } from "../src/studies/momentum.js";

describe("rsi flat opening", () => {
  it("is 100 while RS is 0/0, then 100, 100, 40", () => {
    const c = Float64Array.from([100, 100, 100, 100, 101, 100]);
    const out = runStudy(rsi, { length: 3 }, {
      time: Float64Array.from(c, (_, i) => 1_700_000_000_000 + i * 60_000), open: c, high: c, low: c, close: c, volume: new Float64Array(6).fill(1),
    })[0]!;
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(100);
    expect(out[4]).toBeCloseTo(100, 12);
    expect(out[5]).toBeCloseTo(40, 12);
  });
});
