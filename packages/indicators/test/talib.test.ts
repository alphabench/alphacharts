// Every study with a TA-Lib counterpart must equal TA-Lib's output on the seeded
// dataset (fixtures/talib/*.json, generated offline by scripts/gen_fixtures.py
// from fixtures/cases/*.json). Warm-up bars must be absent exactly where
// TA-Lib has none; values match within each case's tolerance (default 1e-9).

/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { runStudy } from "../src/engine/study.js";
import { ALL_STUDIES } from "../src/studies/all.js";
import { toColumns, MAIN, close } from "./support.js";
import cdl from "../fixtures/dataset-cdl.json";

interface Case {
  id: string;
  study: string;
  inputs: Record<string, number | boolean | string>;
  talib: { fn: string; map: (string | null)[]; int?: boolean };
  tol?: number;
  dataset?: "main" | "cdl";
  /** Why this study differs from TA-Lib, if it does (documented in the README). */
  note?: string;
  /** Our study has values before TA-Lib's first output (TA-Lib's MACD line starts with its signal line). */
  lead?: boolean;
  /** Absolute tolerance for values that are numerical noise around zero. */
  abs?: number;
}

const caseFiles = import.meta.glob<Case[]>("../fixtures/cases/*.json", { eager: true, import: "default" });
const fixFiles = import.meta.glob<Record<string, Record<string, (number | null)[]>>>("../fixtures/talib/*.json", { eager: true, import: "default" });
const byId = new Map(ALL_STUDIES.map((s) => [s.id, s]));
const CDL = toColumns(cdl);

for (const [path, cases] of Object.entries(caseFiles)) {
  const group = path.split("/").pop()!.replace(".json", "");
  const fixtures = fixFiles[`../fixtures/talib/${group}.json`] ?? {};
  describe(`TA-Lib: ${group}`, () => {
    for (const c of cases) {
      it(`${c.id} (${c.talib.fn})`, () => {
        const def = byId.get(c.study);
        expect(def, `study ${c.study} is not registered`).toBeDefined();
        const ref = fixtures[c.id];
        expect(ref, `no fixture for ${c.id}: run pnpm fixtures`).toBeDefined();
        const out = runStudy(def!, c.inputs, c.dataset === "cdl" ? CDL : MAIN);
        for (const [col, want] of Object.entries(ref!)) {
          const k = def!.columns.indexOf(col);
          expect(k, `${c.study} has no column ${col}`).toBeGreaterThanOrEqual(0);
          const got = out[k]!;
          expect(got.length).toBe(want.length);
          let first = -1;
          for (let i = 0; i < want.length; i++) {
            const w = want[i] === null ? Number.NaN : want[i]!;
            const g = got[i]!;
            if (first < 0 && w === w) first = i;
            if (c.lead && w !== w) continue;
            if (!close(g, w, c.tol ?? 1e-9, c.abs ?? 1e-12)) throw new Error(`${c.id}.${col}[${i}]: got ${g}, TA-Lib ${w} (first TA-Lib value at ${first})`);
          }
        }
      });
    }
  });
}
