// Incremental == batch, for every registered study: bars appended one at a time
// with random last-bar revisions (tick updates) in between must leave exactly
// the columns a one-shot batch run gives. Exact equality, NaN included.

import { describe, expect, it } from "vitest";
import { StudyEngine } from "../src/engine/study.js";
import { ALL_STUDIES } from "../src/studies/all.js";
import { randomBars, rng } from "./support.js";
import type { BarInput } from "../src/types.js";

const N = 320;

function bar(d: ReturnType<typeof randomBars>, i: number): BarInput {
  return { time: d.time[i]!, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, volume: d.volume[i]! };
}

/** A different but valid bar at the same time. */
function wiggle(b: BarInput, r: () => number): BarInput {
  const c = b.close * (1 + (r() - 0.5) * 0.01);
  const o = b.open;
  return { time: b.time, open: o, close: c, high: Math.max(o, c, b.high) + r(), low: Math.max(0.01, Math.min(o, c, b.low) - r()), volume: Math.round(b.volume * (0.5 + r())) };
}

describe("incremental == batch", () => {
  for (const def of ALL_STUDIES) {
    it(def.id, () => {
      const d = randomBars(N, 1234);
      const r = rng(99);
      const batch = new StudyEngine(def);
      batch.load(d);
      const live = new StudyEngine(def);
      for (let i = 0; i < N; i++) {
        const b = bar(d, i);
        live.push(wiggle(b, r));
        for (let k = r() * 4; k > 0; k--) live.reviseLast(wiggle(b, r));
        live.reviseLast(b);
      }
      expect(live.length).toBe(N);
      for (let k = 0; k < def.columns.length; k++) {
        const a = batch.column(k), b = live.column(k);
        for (let i = 0; i < N; i++) {
          if (!Object.is(a[i], b[i]) && !(a[i] === b[i])) throw new Error(`${def.id}.${def.columns[k]}[${i}]: batch ${a[i]}, incremental ${b[i]}`);
        }
      }
    });
  }
});

describe("period-1 windows", () => {
  it("wma(1) equals its input and hma(2), hma(3) have values", async () => {
    const { runStudy } = await import("../src/engine/study.js");
    const d = randomBars(30, 4);
    const byId = new Map(ALL_STUDIES.map((s) => [s.id, s]));
    expect(Array.from(runStudy(byId.get("wma")!, { length: 1 }, d)[0]!)).toEqual(Array.from(d.close));
    for (const length of [2, 3]) {
      const h = runStudy(byId.get("hma")!, { length }, d)[0]!;
      expect(h.some((v) => v === v)).toBe(true);
    }
  });
});
