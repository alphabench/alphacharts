// The comparison page: one library per load (?lib=alphacharts|lightweight-charts|echarts|echarts-sync).
// compare.spec.ts drives window.__cmp: generate the seeded dataset, hand it to the
// library, then sweep the view. The sweep is the one in bench/tests/perf.spec.ts
// (SWEEP): same phases, same arithmetic, so numbers read against perf.json.

import { ohlc } from "../../../apps/playground/src/synthetic.js";
import type { Adapter, Cmp, Dataset, HandOver, Memory, Sweep } from "./types.js";

const lib = new URLSearchParams(location.search).get("lib") ?? "";

async function pick(): Promise<Adapter> {
  switch (lib) {
    case "alphacharts": return (await import("./adapters/ac.js")).adapter;
    case "lightweight-charts": return (await import("./adapters/lwc.js")).adapter;
    case "echarts": return (await import("./adapters/echarts.js")).adapter;
    case "echarts-sync": return (await import("./adapters/echarts.js")).adapterSync;
    default: throw new Error(`unknown lib "${lib}"`);
  }
}

const raf = () => new Promise<number>((res) => requestAnimationFrame(res));
const delay = (ms: number) => new Promise<"timeout">((res) => setTimeout(() => res("timeout"), ms));

type PerfMemory = { usedJSHeapSize: number };
const heapMB = (): number | null => {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
};

// The page's whole memory, ArrayBuffers included (needs cross-origin isolation).
async function pageBytes(): Promise<number | null> {
  const p = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (!p.measureUserAgentSpecificMemory || !crossOriginIsolated) return null;
  try {
    const r = await Promise.race([p.measureUserAgentSpecificMemory(), delay(60_000)]);
    return r === "timeout" ? null : r.bytes;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const adapter = await pick();
  adapter.mount(document.getElementById("chart")!);
  let d: Dataset | undefined;
  const data = (): Dataset => d ?? (() => { throw new Error("no dataset: call generate first"); })();

  const cmp: Cmp = {
    lib: adapter.id,
    path: adapter.path,
    crossOriginIsolated,
    generate(n, seed) {
      const t = performance.now();
      const o = ohlc(n, seed);
      d = { n, stepMs: 60_000, time: o.time, open: o.open, high: o.high, low: o.low, close: o.close };
      let sumClose = 0;
      for (let i = 0; i < n; i++) sumClose += o.close[i]!;
      return { genMs: performance.now() - t, checksum: { sumClose, firstTime: o.time[0]!, lastTime: o.time[n - 1]! } };
    },
    async memory(): Promise<Memory> {
      window.gc?.();
      const heap = heapMB();
      const bytes = await pageBytes();
      return { heapMB: heap, pageMB: bytes === null ? null : bytes / 1048576 };
    },
    async handOver(initialBars): Promise<HandOver> {
      const ds = data();
      const t0 = performance.now();
      let prepared: unknown = adapter.prepare(ds);
      const t1 = performance.now();
      const settled = adapter.settled?.();
      adapter.load(prepared, ds, Math.min(initialBars, ds.n));
      // Drop the harness's reference: what a library keeps of its input is its own memory
      // cost, but a copy only the harness holds must not be counted against it.
      prepared = undefined;
      const t2 = performance.now();
      await raf();
      await raf();
      const t3 = performance.now();
      const out: HandOver = { prepareMs: t1 - t0, setDataMs: t2 - t1, firstPaintMs: t3 - t0, settledMs: null };
      if (settled) {
        const r = await Promise.race([settled.then(() => "done" as const), delay(120_000)]);
        if (r === "done") out.settledMs = performance.now() - t0;
        else out.settledNote = "render-complete event not seen within 120 s";
      }
      return out;
    },
    async refresh() {
      const ts: number[] = [];
      for (let i = 0; i < 121; i++) ts.push(await raf());
      const dd = ts.slice(1).map((t, i) => t - ts[i]!).sort((a, b) => a - b);
      return dd[dd.length >> 1]!;
    },
    async sweep(frames, budgetMs): Promise<Sweep> {
      const ds = data();
      const first = 0, last = ds.n - 1;
      const span0 = 200, total = last - first + 1;
      const third = Math.floor(frames / 3);
      const apply = (k: number) => {
        let a: number, b: number;
        if (k < third) {            // zoom out: 200 bars -> everything, anchored right
          const s = span0 * Math.pow(total / span0, k / (third - 1));
          b = last; a = last - s;
        } else if (k < 2 * third) { // pan across at a 2%-of-history window
          const s = Math.max(span0, total * 0.02);
          const p = (k - third) / (third - 1);
          b = last - p * (total - s); a = b - s;
        } else {                    // zoom back in, anchored left
          const p = (k - 2 * third) / (frames - 2 * third - 1);
          const s = total * Math.pow(span0 / total, p);
          a = first; b = first + s;
        }
        adapter.setRange(a, b);
      };
      // Resolves true when the wall-clock budget ran out before all frames were shown.
      const run = (ts: number[]) => new Promise<boolean>((resolve) => {
        let k = 0;
        const t0 = performance.now();
        const f = (t: number) => {
          ts.push(t);
          if (k < frames) {
            if (performance.now() - t0 > budgetMs) return resolve(true);
            apply(k++);
            requestAnimationFrame(f);
          } else resolve(false);
        };
        requestAnimationFrame(f);
      });
      // A warm-up pass first, as in perf.spec.ts: buffers reach their working size,
      // so heap growth over the measured pass is what a long session would leak.
      const warmupAborted = await run([]);
      window.gc?.();
      const heap0 = heapMB();
      const page0 = await pageBytes();
      const ts: number[] = [];
      const aborted = await run(ts);
      window.gc?.();
      const heap1 = heapMB();
      const page1 = await pageBytes();
      // Read how many bars each library shows when asked for all of them AFTER the
      // timed passes: ECharts' getOption() clones its whole option, data included,
      // and must not be charged to a frame.
      adapter.setRange(first, last);
      await raf();
      await raf();
      const zoomOut = adapter.visibleBars();
      return {
        iv: ts.slice(2).map((t, i) => t - ts[i + 1]!),
        aborted,
        warmupAborted,
        heapGrowthKB: heap0 === null || heap1 === null ? null : Math.round((heap1 - heap0) * 1024),
        pageGrowthKB: page0 === null || page1 === null ? null : Math.round((page1 - page0) / 1024),
        fullZoomOutVisibleBars: zoomOut,
      };
    },
  };
  window.__cmp = cmp;
}

void main();
