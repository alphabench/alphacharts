// Independent cross-check of every study that has no TA-Lib counterpart (the TA-Lib set is checked against TA-Lib in
// talib.test.ts). fixtures/reference/reference.json is written by scripts/gen_reference.py from each study's published
// definition with plain numpy loops, sharing no code with the engine. The engine must agree bar for bar: the same bars have
// a value, and the values match to 1e-9 relative. A guard counts the comparisons so an empty fixture cannot pass.

/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import { ALL_STUDIES } from "../src/studies/all.js";
import { MAIN } from "./support.js";
import cases from "../fixtures/reference/reference.json";

interface RefCase { id: string; study: string; inputs: Record<string, number | boolean | string>; cols: Record<string, Array<number | null>> }
const byId = new Map(ALL_STUDIES.map((s) => [s.id, s]));
const REL = 1e-9;

describe("independent reference values", () => {
  it("covers a meaningful number of studies and comparisons", () => {
    const list = cases as RefCase[];
    expect(list.length).toBeGreaterThanOrEqual(55);
    const values = list.reduce((a, c) => a + Object.values(c.cols).reduce((b, col) => b + col.filter((v) => v !== null).length, 0), 0);
    expect(values).toBeGreaterThan(20_000);
  });

  for (const c of cases as RefCase[]) {
    it(`${c.id}`, () => {
      const def = byId.get(c.study);
      expect(def, `study ${c.study} is not registered`).toBeDefined();
      const out = runStudy(def!, c.inputs, MAIN);
      for (const [col, want] of Object.entries(c.cols)) {
        const k = def!.columns.indexOf(col);
        expect(k, `${c.study} has no column ${col}`).toBeGreaterThanOrEqual(0);
        const got = out[k]!;
        expect(got.length).toBe(want.length);
        let compared = 0;
        for (let i = 0; i < want.length; i++) {
          const w = want[i] === null ? Number.NaN : want[i]!, g = got[i]!;
          if (w !== w || g !== g) {
            if ((w !== w) !== (g !== g)) throw new Error(`${c.id}.${col}[${i}]: reference ${w}, engine ${g} (one has no value)`);
            continue;
          }
          const err = Math.abs(g - w) / Math.max(1e-12, Math.abs(w), Math.abs(g));
          if (err > REL) throw new Error(`${c.id}.${col}[${i}]: reference ${w}, engine ${g} (relative error ${err.toExponential(2)})`);
          compared++;
        }
        // a column the definition leaves empty (Fibonacci has no R4) is checked for emptiness above; any other must have been compared
        if (want.some((v) => v !== null)) expect(compared, `${c.id}.${col} compared nothing`).toBeGreaterThan(0);
      }
    });
  }
});
