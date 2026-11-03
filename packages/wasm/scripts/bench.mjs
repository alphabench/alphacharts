// Benchmark: JS vs WASM(SIMD) per kernel on 1M and 10M bars.
//
//   pnpm -C packages/wasm bench                 # full table, writes bench-results.json
//   BENCH_SIZES=1000000 BENCH_RUNS=5 pnpm ...   # smaller run (does not write the json)
//   BENCH_ONLY=highest pnpm ...                 # kernels whose label contains the text
//
// Method: the TypeScript sources are compiled once with tsc into .bench-dist
// (gitignored) so plain node runs them. For each kernel and size: 2 warm-up
// runs per side, then RUNS timed runs per side (interleaved), median reported.
// Each run allocates fresh outputs. The wasm time includes everything a caller
// pays: copy-in of every input column, the kernel, and copy-out into fresh
// typed arrays. Inputs are generated once per size and reused.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
execFileSync(`${root}node_modules/.bin/tsc`, ["-p", "tsconfig.bench.json"], { cwd: root, stdio: "inherit" });
const { jsKernels, loadKernels, emaAlpha, rmaAlpha } = await import(pathToFileURL(`${root}.bench-dist/index.js`).href);

const SIZES = (process.env.BENCH_SIZES ?? "1000000,10000000").split(",").map(Number);
const RUNS = Number(process.env.BENCH_RUNS ?? 7);
const ONLY = process.env.BENCH_ONLY;
const WIN = 1.05; // a "win" must beat js by 5% to count as more than noise

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inputs(n) {
  const r = rng(n);
  const close = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n);
  const volume = new Float64Array(n), side = new Uint8Array(n);
  let v = 1000;
  for (let i = 0; i < n; i++) {
    open[i] = v;
    v += (r() - 0.5) * 2;
    close[i] = v;
    high[i] = Math.max(open[i], v) + r();
    low[i] = Math.min(open[i], v) - r();
    volume[i] = Math.floor(r() * 5000);
    side[i] = v >= open[i] ? 1 : 0;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (low[i] < lo) lo = low[i]; if (high[i] > hi) hi = high[i]; }
  return { close, open, high, low, volume, side, lo, hi };
}

const CASES = [
  ["sum p=20", (k, d) => k.sum(d.close, 20)],
  ["sumState p=20", (k, d) => k.sumState(d.close, 20)],
  ["mean p=20", (k, d) => k.mean(d.close, 20)],
  ["variance p=20", (k, d) => k.variance(d.close, 20)],
  ["stdev p=20", (k, d) => k.stdev(d.close, 20)],
  ["variance p=100", (k, d) => k.variance(d.close, 100)],
  ["ema p=20", (k, d) => k.smooth(d.close, 20, emaAlpha(20))],
  ["rma p=14", (k, d) => k.smooth(d.close, 14, rmaAlpha(14))],
  ["wma p=20", (k, d) => k.wma(d.close, 20)],
  ["highest p=3", (k, d) => k.highest(d.high, 3)],
  ["highest p=8", (k, d) => k.highest(d.high, 8)],
  ["highest p=14", (k, d) => k.highest(d.high, 14)],
  ["highest p=200", (k, d) => k.highest(d.high, 200)],
  ["lowest p=14", (k, d) => k.lowest(d.low, 14)],
  ["highestBars p=14", (k, d) => k.highestBars(d.high, 14)],
  ["lowestBars p=200", (k, d) => k.lowestBars(d.low, 200)],
  ["linreg p=20", (k, d) => k.linreg(d.close, 20)],
  ["linreg p=100", (k, d) => k.linreg(d.close, 100)],
  ["lodRows k=3", (k, d) => k.lodRows(d.open, d.high, d.low, d.close, 3)],
  ["lodRows k=6", (k, d) => k.lodRows(d.open, d.high, d.low, d.close, 6)],
  ["volumeProfile bins=100", (k, d) => k.volumeProfile(d.close, d.volume, d.lo, d.hi, 100)],
  ["volumeProfileSplit bins=100", (k, d) => k.volumeProfileSplit(d.close, d.volume, d.side, d.lo, d.hi, 100)],
].filter(([label]) => !ONLY || label.includes(ONLY));

const wasm = await loadKernels();
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const time = (f) => {
  globalThis.gc?.();
  const t = performance.now();
  f();
  return performance.now() - t;
};

const rows = [];
for (const n of SIZES) {
  const d = inputs(n);
  for (const [label, run] of CASES) {
    for (let i = 0; i < 2; i++) { run(jsKernels, d); run(wasm, d); }
    const js = [], wa = [];
    for (let i = 0; i < RUNS; i++) {
      js.push(time(() => run(jsKernels, d)));
      wa.push(time(() => run(wasm, d)));
    }
    const row = { kernel: label, n, jsMs: +median(js).toFixed(2), wasmMs: +median(wa).toFixed(2) };
    row.speedup = +(row.jsMs / row.wasmMs).toFixed(2);
    rows.push(row);
    console.log(`${label.padEnd(30)} n=${String(n).padStart(8)}  js ${row.jsMs.toFixed(2).padStart(9)} ms  wasm ${row.wasmMs.toFixed(2).padStart(9)} ms  x${row.speedup.toFixed(2)}`);
  }
}

const labels = [...new Set(rows.map((r) => r.kernel))];
const wins = labels.filter((l) => SIZES.every((n) => (rows.find((r) => r.kernel === l && r.n === n)?.speedup ?? 0) >= WIN));
console.log(`\nwins (>= ${WIN}x at every size: ${SIZES.join(", ")}):\n  ${wins.join("\n  ") || "none"}`);
console.log(`\nno win:\n  ${labels.filter((l) => !wins.includes(l)).join("\n  ") || "none"}`);

if (!process.env.BENCH_SIZES && !process.env.BENCH_ONLY && !process.env.BENCH_RUNS) {
  writeFileSync(
    new URL("../bench-results.json", import.meta.url),
    JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        machine: { cpu: os.cpus()[0]?.model, arch: os.arch(), platform: os.platform(), release: os.release(), memoryGiB: Math.round(os.totalmem() / 2 ** 30) },
        loadAvgAtEnd: os.loadavg().map((v) => +v.toFixed(1)),
        node: process.version,
        v8: process.versions.v8,
        runs: RUNS,
        method: "median of runs after 2 warm-ups; fresh outputs each run; wasm time includes copy-in and copy-out",
        winThreshold: WIN,
        wins,
        results: rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("\nwrote bench-results.json");
}
