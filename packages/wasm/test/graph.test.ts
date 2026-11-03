// Conformance with the study engine: the kernels must equal the graph nodes of
// packages/indicators bit for bit. Reads the sibling package's source only; if
// that file is absent or no longer exposes this API the suite is skipped and
// says so (the wasm == js suite still guards the kernels).
/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { emaAlpha, jsKernels, rmaAlpha } from "../src/index.js";
import { DATASETS, describeDiff } from "./helpers.js";

interface Col { v: Float64Array }
interface G {
  close: Col; n: number; run(a: number, b: number): void;
  sum(x: Col, p: number): Col; sma(x: Col, p: number): Col; variance(x: Col, p: number): Col; stdev(x: Col, p: number): Col;
  ema(x: Col, p: number): Col; rma(x: Col, p: number): Col; wma(x: Col, p: number): Col;
  highest(x: Col, p: number): Col; lowest(x: Col, p: number): Col; highestBars(x: Col, p: number): Col; lowestBars(x: Col, p: number): Col;
  linreg(x: Col, p: number): { value: Col; slope: Col; intercept: Col };
}

// import.meta.glob matches nothing (rather than failing) when the sibling file is absent.
const found = import.meta.glob<{ Graph: new (cap: number) => G }>("../../indicators/src/engine/graph.ts");
const loader = Object.values(found)[0];
let GraphCtor: (new (cap: number) => G) | undefined;
if (loader) {
  try {
    GraphCtor = (await loader()).Graph;
  } catch (e) {
    console.warn("graph conformance skipped:", e);
  }
} else console.warn("graph conformance skipped: packages/indicators/src/engine/graph.ts not found");

describe.skipIf(!GraphCtor)("kernels equal the engine's graph nodes", () => {
  for (const [dsName, gen] of DATASETS) {
    it(`on ${dsName}`, () => {
      for (const n of [1, 2, 9, 40, 1001]) {
        const x = gen(n, n);
        for (const p of [1, 2, 3, 5, 14, 39, 100]) {
          const g = new GraphCtor!(n);
          g.close.v.set(x);
          g.n = n;
          const nodes: Record<string, Col> = {
            sum: g.sum(g.close, p), mean: g.sma(g.close, p), variance: g.variance(g.close, p), stdev: g.stdev(g.close, p),
            ema: g.ema(g.close, p), rma: g.rma(g.close, p), wma: g.wma(g.close, p),
            highest: g.highest(g.close, p), lowest: g.lowest(g.close, p), highestBars: g.highestBars(g.close, p), lowestBars: g.lowestBars(g.close, p),
          };
          const lr = p >= 2 ? g.linreg(g.close, p) : undefined;
          g.run(0, n);
          const ours: Record<string, Float64Array> = {
            sum: jsKernels.sum(x, p), mean: jsKernels.mean(x, p), variance: jsKernels.variance(x, p), stdev: jsKernels.stdev(x, p),
            ema: jsKernels.smooth(x, p, emaAlpha(p)), rma: jsKernels.smooth(x, p, rmaAlpha(p)), wma: jsKernels.wma(x, p),
            highest: jsKernels.highest(x, p), lowest: jsKernels.lowest(x, p), highestBars: jsKernels.highestBars(x, p), lowestBars: jsKernels.lowestBars(x, p),
          };
          for (const key of Object.keys(nodes)) {
            // The graph's wma(p = 1) reads sv[-1] on the first bar and yields NaN there: a graph quirk the kernel does not copy.
            if (key === "wma" && p === 1) continue;
            const d = describeDiff(`${key} p=${p} n=${n}`, ours[key]!, nodes[key]!.v.subarray(0, n));
            if (d) throw new Error(d);
          }
          if (lr) {
            const k = jsKernels.linreg(x, p);
            for (const [key, col] of [["value", lr.value], ["slope", lr.slope], ["intercept", lr.intercept]] as const) {
              const d = describeDiff(`linreg.${key} p=${p} n=${n}`, k[key], col.v.subarray(0, n));
              if (d) throw new Error(d);
            }
          }
        }
      }
      expect(true).toBe(true);
    });
  }
});
