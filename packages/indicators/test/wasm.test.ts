// Enabling the WASM batch kernels must not change a single value: every study,
// with default inputs, on a series long enough to trigger them, gives
// bit-identical columns with and without.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKernels } from "@alphacharts/wasm";
import { setKernels } from "../src/engine/kernels.js";
import { runStudy } from "../src/engine/study.js";
import { ALL_STUDIES } from "../src/studies/all.js";
import { randomBars } from "./support.js";

const d = randomBars(9000, 31);

describe("WASM kernels leave every study unchanged", () => {
  beforeAll(() => setKernels(null));
  afterAll(() => setKernels(null));

  for (const def of ALL_STUDIES) {
    it(def.id, async () => {
      setKernels(null);
      const js = runStudy(def, {}, d);
      setKernels(await loadKernels());
      const wasm = runStudy(def, {}, d);
      setKernels(null);
      js.forEach((col, k) => {
        for (let i = 0; i < col.length; i++) {
          if (!Object.is(col[i], wasm[k]![i]) && col[i] !== wasm[k]![i]) throw new Error(`${def.id}.${def.columns[k]}[${i}]: js ${col[i]}, wasm ${wasm[k]![i]}`);
        }
      });
      expect(js.length).toBe(wasm.length);
    });
  }
});
