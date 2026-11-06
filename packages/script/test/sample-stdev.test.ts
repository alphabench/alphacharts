// ta.stdev / ta.variance: population (divide by n) by default, sample (divide by n - 1) with sample=true.
// Hand case, windows of 3: closes 1,2,4,8 -> window {1,2,4}: mean 7/3, squares of deviations sum to 42/9 = 14/3,
// population variance 14/9, sample variance 7/3 = 2.333333; window {2,4,8}: sum of squared deviations 56/3 (population 56/9, sample 28/3).
import { describe, expect, it } from "vitest";
import { runStudy } from "@alphacharts/indicators";
import { ok } from "./support.js";

const closes = [1, 2, 4, 8];
const data = {
  time: Float64Array.from(closes, (_, i) => 1_700_000_000_000 + i * 60_000), open: Float64Array.from(closes), high: Float64Array.from(closes),
  low: Float64Array.from(closes), close: Float64Array.from(closes), volume: new Float64Array(4).fill(1),
};
const out = (src: string) => runStudy(ok(src).study, {}, data)[0]!;

describe("sample deviation", () => {
  it("variance: population 14/9 and 56/9 -> sample 7/3 and 28/3 (hand: sum of squared deviations 14/3 and 56/3, over 3 and over 2)", () => {
    // {2,4,8}: mean 14/3; deviations -8/3, -2/3, 10/3; squares 64/9 + 4/9 + 100/9 = 168/9 = 56/3
    expect(out("plot(ta.variance(close, 3))")[2]).toBeCloseTo(14 / 9, 12);
    expect(out("plot(ta.variance(close, 3, true))")[2]).toBeCloseTo(7 / 3, 12);
    expect(out("plot(ta.variance(close, 3))")[3]).toBeCloseTo(56 / 9, 12);
    expect(out("plot(ta.variance(close, 3, true))")[3]).toBeCloseTo(28 / 3, 12);
  });
  it("stdev is the root of it; sample=false is the default", () => {
    expect(out("plot(ta.stdev(close, 3, true))")[3]).toBeCloseTo(Math.sqrt(28 / 3), 12);
    expect(out("plot(ta.stdev(close, 3))")[3]).toBeCloseTo(Math.sqrt(56 / 9), 12);
    expect(out("plot(ta.stdev(close, 3, sample=false))")[3]).toBeCloseTo(Math.sqrt(56 / 9), 12);
  });
  it("a window of one has no sample deviation: refused", () => {
    expect(() => out("plot(ta.stdev(close, 1, true))")).toThrow(/at least|between 2/);
  });
});
