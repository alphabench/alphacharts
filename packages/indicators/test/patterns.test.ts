// Candlestick patterns: every one fires on the CDL dataset (a silent always-zero study cannot pass), and a few
// are checked by hand on short sequences with the arithmetic written out. Equality with TA-Lib on the whole
// dataset is in talib.test.ts.

import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import type { StudyDef } from "../src/types.js";
import * as patterns from "../src/studies/patterns.js";
import { toColumns } from "./support.js";
import cdl from "../fixtures/dataset-cdl.json";

const DEFS = Object.values(patterns) as StudyDef[];
const DATA = toColumns(cdl);

describe("candlestick patterns on the CDL dataset", () => {
  it("defines all 61 TA-Lib patterns with unique ids", () => {
    expect(DEFS.length).toBe(61);
    expect(new Set(DEFS.map((d) => d.id)).size).toBe(61);
    for (const d of DEFS) {
      expect(d.id).toMatch(/^cdl-[0-9a-z]+$/);
      expect(d.family).toBe("pattern");
      expect(d.columns).toEqual(["signal"]);
    }
  });

  for (const def of DEFS) {
    it(`${def.id} fires`, () => {
      const [signal] = runStudy(def, {}, DATA);
      let hits = 0;
      for (const v of signal!) if (v === v && v !== 0) hits++;
      expect(hits).toBeGreaterThan(0);
    });
  }
});

/** [open, high, low, close] rows to columns. */
function bars(rows: number[][]) {
  const n = rows.length;
  return {
    time: Float64Array.from(rows, (_, i) => 1_700_000_000_000 + i * 60_000),
    open: Float64Array.from(rows, (r) => r[0]!), high: Float64Array.from(rows, (r) => r[1]!),
    low: Float64Array.from(rows, (r) => r[2]!), close: Float64Array.from(rows, (r) => r[3]!),
    volume: new Float64Array(n).fill(1000),
  };
}

// Quiet context: o 100, c 101, h 101.5, l 99.5. Body 1, high-low range 2, shadows 0.5 each. So every average over
// context bars is: BodyLong = BodyShort = 1, BodyDoji = 0.1 * 2 = 0.2, ShadowVeryShort = 0.2, Near = 0.2 * 2 = 0.4.
const Q = [100, 101.5, 99.5, 101];
const ctx = (n: number) => Array.from({ length: n }, () => Q);
const last = (a: Float64Array) => a[a.length - 1]!;

describe("hand-built sequences", () => {
  it("doji: body <= 0.1 of the average high-low range of the 10 bars before", () => {
    // 0.1 <= 0.1 * 2 = 0.2 -> doji; 0.3 > 0.2 -> not
    const yes = runStudy(patterns.cdlDoji, {}, bars([...ctx(12), [100, 101, 99, 100.1]]))[0]!;
    const no = runStudy(patterns.cdlDoji, {}, bars([...ctx(12), [100, 101, 99, 100.3]]))[0]!;
    expect(last(yes)).toBe(100);
    expect(last(no)).toBe(0);
    expect(yes[9]).toBeNaN(); // lookback of 10
    expect(yes[10]).toBe(0);
  });

  it("engulfing: 100 when the body engulfs strictly, 80 when it opens exactly at the prior close", () => {
    // black 102 -> 101, then white 100.5 -> 102.5: close 102.5 >= 102 and open 100.5 < 101, no equal edge -> +100
    const full = runStudy(patterns.cdlEngulfing, {}, bars([...ctx(3), [102, 102.2, 100.8, 101], [100.5, 102.7, 100.4, 102.5]]))[0]!;
    // white opens at 101 = the black's close (equal edge) -> +80
    const weak = runStudy(patterns.cdlEngulfing, {}, bars([...ctx(3), [102, 102.2, 100.8, 101], [101, 102.7, 100.9, 102.5]]))[0]!;
    expect(last(full)).toBe(100);
    expect(last(weak)).toBe(80);
  });

  it("hammer: short body, long lower shadow, tiny upper shadow, near the previous low", () => {
    // body 0.2 < BodyShort avg 1; lower shadow 0.8 > its body 0.2; upper 0.05 < 0.2;
    // min(o, c) 99.8 <= previous low 99.5 + Near 0.4 = 99.9
    const r = runStudy(patterns.cdlHammer, {}, bars([...ctx(12), [99.8, 100.05, 99, 100]]))[0]!;
    expect(last(r)).toBe(100);
    // the same candle with a 0.5 upper shadow is not a hammer
    const no = runStudy(patterns.cdlHammer, {}, bars([...ctx(12), [99.8, 100.5, 99, 100]]))[0]!;
    expect(last(no)).toBe(0);
  });

  it("morning star: long black, gapped-down small star, white closing past 30% of the black body", () => {
    // black 105 -> 100: body 5 > BodyLong avg 1 (context only)
    // star 99 -> 99.2: body 0.2 <= BodyShort avg (9 * 1 + 5) / 10 = 1.4; its body top 99.2 < black body bottom 100
    // white 99.5 -> 103: body 3.5 > BodyShort avg (8 * 1 + 5 + 0.2) / 10 = 1.32;
    //   close 103 > 100 + 5 * 0.3 = 101.5 -> +100
    const seq = [...ctx(14), [105, 105.1, 99.9, 100], [99, 99.3, 98.9, 99.2]];
    expect(last(runStudy(patterns.cdlMorningStar, {}, bars([...seq, [99.5, 103.1, 99.4, 103]]))[0]!)).toBe(100);
    // closing at 101 < 101.5 -> no pattern
    expect(last(runStudy(patterns.cdlMorningStar, {}, bars([...seq, [99.5, 101.1, 99.4, 101]]))[0]!)).toBe(0);
    // with penetration 0.1 the threshold is 100.5, so 101 qualifies
    expect(last(runStudy(patterns.cdlMorningStar, { penetration: 0.1 }, bars([...seq, [99.5, 101.1, 99.4, 101]]))[0]!)).toBe(100);
  });

  it("hikkake: false break of an inside bar, +100 at the break and +200 when price confirms", () => {
    const flat = Array.from({ length: 10 }, () => [15, 16, 14, 15]);
    // mother 10..20, inside bar 12..18 (lower high, higher low), then a lower high and lower low (17, 11) -> +100,
    // saved high 18 / low 12 and 4 bars to confirm
    const seq = [...flat, [15, 20, 10, 15], [15, 18, 12, 15], [14, 17, 11, 14], [14, 17.5, 13, 16], [16, 19.5, 15, 19]];
    const r = runStudy(patterns.cdlHikkake, {}, bars(seq))[0]!;
    expect(r[12]).toBe(100); // the break
    expect(r[13]).toBe(0); // close 16 <= saved high 18: still waiting
    expect(r[14]).toBe(200); // close 19 > 18 inside the 4 bars
    expect(r[4]).toBeNaN(); // lookback of 5
  });
});
