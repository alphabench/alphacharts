// Compute timings (no chart): `AC_BENCH=1 pnpm -C packages/indicators test -- bench` prints
// batch time for the ten playground studies over 1M bars, JS and WASM kernels, and the cost
// of one tick (a revised last bar) per study set. Skipped in normal runs.

import { describe, it } from "vitest";
import { loadKernels } from "@alphacharts/wasm";
import { setKernels } from "../src/engine/kernels.js";
import { StudyEngine } from "../src/engine/study.js";
import { ALL_STUDIES } from "../src/studies/all.js";
import { randomBars } from "./support.js";

const on = Boolean((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AC_BENCH);
const SET: [string, Record<string, number>][] = [["sma", { length: 20 }], ["ema", { length: 50 }], ["bbands", { length: 20 }], ["supertrend", {}], ["sar", {}], ["rsi", { length: 14 }], ["macd", {}], ["stoch", {}], ["atr", { length: 14 }], ["obv", {}]];
const byId = new Map(ALL_STUDIES.map((s) => [s.id, s]));

describe.skipIf(!on)("compute timings", () => {
  for (const n of [1_000_000, 10_000_000]) {
    it(`${n} bars x 10 studies`, async () => {
      const d = randomBars(n, 3);
      const run = () => {
        const t0 = performance.now();
        const engines = SET.map(([id, inp]) => {
          const e = new StudyEngine(byId.get(id)!, inp);
          e.load(d);
          return e;
        });
        const batch = performance.now() - t0;
        const last = { time: d.time[n - 1]!, open: d.open[n - 1]!, high: d.high[n - 1]!, low: d.low[n - 1]!, close: d.close[n - 1]!, volume: d.volume[n - 1]! };
        const t1 = performance.now();
        const K = 20_000;
        for (let k = 0; k < K; k++) for (const e of engines) e.reviseLast({ ...last, close: last.close + (k % 7) * 0.01 });
        return { batch, perTickUs: ((performance.now() - t1) / K) * 1000 };
      };
      setKernels(null);
      const js = run();
      setKernels(await loadKernels());
      const wasm = run();
      setKernels(null);
      console.log(`BENCH n=${n}: JS batch ${js.batch.toFixed(0)} ms, WASM batch ${wasm.batch.toFixed(0)} ms; per tick (10 studies) ${js.perTickUs.toFixed(1)} us`);
    }, 600_000);
  }
});
