// alphacharts vs lightweight-charts vs Apache ECharts on one seeded OHLC dataset.
// Run with `pnpm bench:compare` (see bench/compare/README.md): the page under
// bench/compare is built and served by playwright.config.ts, headed Chrome, project
// `compare`. Per library and size, RUNS fresh page loads each measure first paint,
// load time, a pan/zoom sweep (the one in perf.spec.ts), heap growth and the bundle.
// Failures (cannot load, tab crash, timeout) are results, never skipped.
// Writes bench/results/compare.json (compare.partial.json when a subset is selected)
// and, per library and size, a screenshot of the first run to results/compare-shots/.

import { test, type Browser } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const LIBS = ["alphacharts", "lightweight-charts", "echarts", "echarts-sync"] as const;
type Lib = (typeof LIBS)[number];
const ALL_SIZES = [10_000, 100_000, 1_000_000, 4_800_000];

const pick = <T>(env: string | undefined, all: readonly T[], parse: (s: string) => T): T[] => (env ? env.split(",").map((s) => parse(s.trim())) : [...all]);
const SELECTED_LIBS = pick(process.env.AC_COMPARE_LIBS, LIBS, (s) => s as Lib);
const SIZES = pick(process.env.AC_COMPARE_SIZES, ALL_SIZES, Number);
const RUNS = Number(process.env.AC_COMPARE_RUNS ?? 5);
const PARTIAL = SELECTED_LIBS.length !== LIBS.length || SIZES.length !== ALL_SIZES.length || RUNS < 5;

const SEED = 20261103;
const INITIAL_BARS = 500;
const SWEEP_FRAMES = 600;
const PORT = Number(process.env.AC_PORT_COMPARE ?? 5210);
const LOAD_TIMEOUT_MS = 180_000; // generate + hand over + first paint + settle
const SWEEP_PASS_BUDGET_MS = 90_000; // wall clock for each of the two sweep passes
const SWEEP_TIMEOUT_MS = 330_000; // page.evaluate guard around both passes and memory reads
const VIEWPORT = { width: 1600, height: 900 };
const DPR = 2;
const MAX_CONSECUTIVE_FAILURES = 2;

interface Interval { p50: number; p95: number; p99: number; max: number }
interface Run {
  run: number;
  outcome: "ok" | "partial" | "failed" | "not attempted";
  /** Why a run is not "ok": the failure class and message, or what was cut short. */
  detail?: string;
  genMs?: number;
  checksum?: { sumClose: number; firstTime: number; lastTime: number };
  prepareMs?: number;
  setDataMs?: number;
  firstPaintMs?: number;
  settledMs?: number | null;
  refreshMs?: number;
  frames?: number;
  interval?: Interval;
  over16?: number;
  /** Frames longer than 1.5 x the display refresh: a missed vsync (the same rule as perf.spec.ts). */
  missed?: number;
  fullZoomOutVisibleBars?: number | null;
  heapBeforeLoadMB?: number | null;
  heapAfterLoadMB?: number | null;
  pageBeforeLoadMB?: number | null;
  pageAfterLoadMB?: number | null;
  heapGrowthKB?: number | null;
  pageGrowthKB?: number | null;
  pageErrors?: string[];
}
interface Cell { lib: Lib; bars: number; path?: string; runs: Run[]; summary?: Record<string, { median: number; min: number; max: number; n: number }>; outcomes?: Record<string, number> }

const cells: Cell[] = [];
let bundles: Record<string, unknown> = {};
let meta: Record<string, unknown> = {};
let refreshSamples: number[] = [];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
// The percentile rule of perf.spec.ts (pct).
const q = (s: number[], p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN).toFixed(2);
const pct = (a: number[]): Interval => {
  const s = [...a].sort((x, y) => x - y);
  return { p50: q(s, 0.5), p95: q(s, 0.95), p99: q(s, 0.99), max: +(s[s.length - 1] ?? NaN).toFixed(2) };
};
const round = (x: number | null | undefined, d = 2) => (x == null ? x : +x.toFixed(d));

const METRICS: Record<string, (r: Run) => number | null | undefined> = {
  prepareMs: (r) => r.prepareMs,
  setDataMs: (r) => r.setDataMs,
  loadMs: (r) => (r.prepareMs ?? NaN) + (r.setDataMs ?? NaN),
  firstPaintMs: (r) => r.firstPaintMs,
  settledMs: (r) => r.settledMs,
  p50: (r) => r.interval?.p50,
  p95: (r) => r.interval?.p95,
  p99: (r) => r.interval?.p99,
  maxFrameMs: (r) => r.interval?.max,
  over16: (r) => r.over16,
  missed: (r) => r.missed,
  heapGrowthKB: (r) => r.heapGrowthKB,
  pageGrowthKB: (r) => r.pageGrowthKB,
  heapLoadDeltaMB: (r) => (r.heapAfterLoadMB != null && r.heapBeforeLoadMB != null ? r.heapAfterLoadMB - r.heapBeforeLoadMB : null),
  pageLoadDeltaMB: (r) => (r.pageAfterLoadMB != null && r.pageBeforeLoadMB != null ? r.pageAfterLoadMB - r.pageBeforeLoadMB : null),
  fullZoomOutVisibleBars: (r) => r.fullZoomOutVisibleBars,
};

function summarise(c: Cell): void {
  const usable = c.runs.filter((r) => r.outcome === "ok" || r.outcome === "partial");
  c.outcomes = {};
  for (const r of c.runs) c.outcomes[r.outcome] = (c.outcomes[r.outcome] ?? 0) + 1;
  c.summary = {};
  for (const [name, get] of Object.entries(METRICS)) {
    const xs = usable.map(get).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (xs.length) c.summary[name] = { median: round(median(xs))!, min: round(Math.min(...xs))!, max: round(Math.max(...xs))!, n: xs.length };
  }
}

function flush(): void {
  for (const c of cells) summarise(c);
  mkdirSync("results", { recursive: true });
  const file = PARTIAL ? "results/compare.partial.json" : "results/compare.json";
  writeFileSync(file, JSON.stringify({ meta: { ...meta, display: displayInfo(), partial: PARTIAL }, bundles, results: cells }, null, 2));
}

function displayInfo() {
  const ms = refreshSamples.length ? median(refreshSamples) : NaN;
  return { refreshMs: round(ms, 3), refreshHz: round(1000 / ms, 1), measured: "median of the idle rAF interval over 121 frames, once per run", samples: refreshSamples.length, resolution: (meta["machine"] as { display?: string } | undefined)?.display };
}

function sh(cmd: string): string | undefined {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function readJson(path: string): { version?: string } | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { version?: string };
  } catch {
    return undefined;
  }
}

/** The files of one adapter chunk and what it imports, from vite's manifest, and their gzip size. */
function bundleOf(dist: string, key: string): { files: string[]; rawBytes: number; gzipBytes: number } {
  const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8")) as Record<string, { file: string; imports?: string[]; isEntry?: boolean }>;
  const root = manifest[key];
  if (!root) throw new Error(`no ${key} in the build manifest (keys: ${Object.keys(manifest).join(", ")})`);
  const files = new Set<string>();
  const walk = (k: string) => {
    const e = manifest[k]!;
    if (e.isEntry) return; // the harness chunk is not the library
    if (files.has(e.file)) return;
    files.add(e.file);
    (e.imports ?? []).forEach(walk);
  };
  walk(key);
  const buf = Buffer.concat([...files].sort().map((f) => readFileSync(join(dist, f))));
  return { files: [...files].sort(), rawBytes: buf.length, gzipBytes: gzipSync(buf, { level: 9 }).length };
}

function measureBundles(): Record<string, unknown> {
  const dist = resolve("compare/dist");
  const entry = (Object.values(JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"))) as { file: string; isEntry?: boolean }[]).find((e) => e.isEntry);
  const harness = entry ? readFileSync(join(dist, entry.file)) : Buffer.alloc(0);
  return {
    note: "minified production build of bench/compare (vite build), gzip level 9 of the library's chunk(s) concatenated, including the ~1 kB adapter that loads it. alphacharts is core only (every built-in series, no plugins); ECharts is the tree-shaken core + CandlestickChart + GridComponent + DataZoomInsideComponent + CanvasRenderer.",
    "alphacharts": bundleOf(dist, "src/adapters/ac.ts"),
    "lightweight-charts": bundleOf(dist, "src/adapters/lwc.ts"),
    echarts: bundleOf(dist, "src/adapters/echarts.ts"),
    harness: { rawBytes: harness.length, gzipBytes: gzipSync(harness, { level: 9 }).length, note: "shared by every library: dataset generator and measurement code, not counted in a library's size" },
  };
}

function machine() {
  const c = cpus();
  const sp = platform() === "darwin" ? sh("system_profiler SPDisplaysDataType SPHardwareDataType") : undefined;
  const grab = (re: RegExp) => sp?.match(re)?.[1]?.trim();
  return {
    cpu: c[0]?.model,
    logicalCores: c.length,
    memoryGB: round(totalmem() / 2 ** 30, 1),
    os: `${platform()} ${release()}`,
    ...(platform() === "darwin" ? { osVersion: sh("sw_vers -productVersion"), model: grab(/Model Name:\s*(.+)/), gpu: grab(/Chipset Model:\s*(.+)/), gpuCores: grab(/Total Number of Cores:\s*(.+)/), display: grab(/Resolution:\s*(.+)/) } : {}),
    power: platform() === "darwin" ? sh("pmset -g batt | head -1") : undefined,
  };
}

function libraries() {
  const git = (a: string) => sh(`git -C .. ${a}`);
  return {
    alphacharts: { version: readJson("../packages/core/package.json")?.version, package: "@alphacharts/core", from: "source (bench/compare resolves it to packages/core/src)", commit: git("rev-parse HEAD"), dirty: (git("status --porcelain -- packages/core bench/compare") ?? "").length > 0 },
    "lightweight-charts": { version: readJson("node_modules/lightweight-charts/package.json")?.version },
    echarts: { version: readJson("node_modules/echarts/package.json")?.version },
  };
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out: ${what} did not finish in ${ms / 1000} s`)), ms))]);

const firstLine = (e: unknown) => String(e instanceof Error ? e.message : e).split("\n")[0]!.slice(0, 300);

async function once(browser: Browser, lib: Lib, bars: number, run: number): Promise<{ r: Run; path?: string }> {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const errors: string[] = [];
  let crashed = false;
  page.on("pageerror", (e) => errors.push(firstLine(e)));
  page.on("crash", () => { crashed = true; });
  const r: Run = { run, outcome: "ok" };
  let path: string | undefined;
  const classify = (e: unknown, stage: string): void => {
    const m = firstLine(e);
    r.outcome = "failed";
    r.detail = crashed || /crash/i.test(m) ? `tab crashed (${stage})` : /timed out/i.test(m) ? `${m} (${stage})` : `failed to load (${stage}): ${m}`;
  };
  try {
    await page.goto(`/?lib=${lib}`, { timeout: 60_000 });
    await page.waitForFunction(() => window.__cmp !== undefined, null, { timeout: 60_000 });
    path = await page.evaluate(() => window.__cmp!.path);
    const load = await withTimeout(
      (async () => {
        const g = await page.evaluate(([n, seed]) => window.__cmp!.generate(n!, seed!), [bars, SEED] as const);
        const before = await page.evaluate(() => window.__cmp!.memory());
        const h = await page.evaluate((i) => window.__cmp!.handOver(i), INITIAL_BARS);
        const after = await page.evaluate(() => window.__cmp!.memory());
        return { g, before, h, after };
      })(),
      LOAD_TIMEOUT_MS,
      "generate + hand over + first paint",
    );
    r.genMs = round(load.g.genMs, 1)!;
    r.checksum = load.g.checksum;
    r.prepareMs = round(load.h.prepareMs, 1)!;
    r.setDataMs = round(load.h.setDataMs, 1)!;
    r.firstPaintMs = round(load.h.firstPaintMs, 1)!;
    r.settledMs = round(load.h.settledMs, 1) ?? null;
    if (load.h.settledNote) { r.outcome = "partial"; r.detail = load.h.settledNote; }
    r.heapBeforeLoadMB = round(load.before.heapMB);
    r.pageBeforeLoadMB = round(load.before.pageMB);
    r.heapAfterLoadMB = round(load.after.heapMB);
    r.pageAfterLoadMB = round(load.after.pageMB);
    if (run === 1) {
      mkdirSync("results/compare-shots", { recursive: true });
      await page.screenshot({ path: `results/compare-shots/${lib}-${bars}.png` });
    }
    const refreshMs = await page.evaluate(() => window.__cmp!.refresh());
    r.refreshMs = round(refreshMs, 2)!;
    refreshSamples.push(refreshMs);
    const s = await withTimeout(page.evaluate(([f, b]) => window.__cmp!.sweep(f!, b!), [SWEEP_FRAMES, SWEEP_PASS_BUDGET_MS] as const), SWEEP_TIMEOUT_MS, "pan/zoom sweep");
    r.frames = s.iv.length;
    r.interval = pct(s.iv);
    r.over16 = s.iv.filter((x) => x > 16.7).length;
    r.missed = s.iv.filter((x) => x > refreshMs * 1.5).length;
    r.fullZoomOutVisibleBars = s.fullZoomOutVisibleBars;
    r.heapGrowthKB = s.heapGrowthKB;
    r.pageGrowthKB = s.pageGrowthKB;
    if (s.aborted || s.warmupAborted) {
      r.outcome = "partial";
      r.detail = `${r.detail ? r.detail + "; " : ""}sweep cut after ${SWEEP_PASS_BUDGET_MS / 1000} s: ${s.warmupAborted ? "warm-up pass" : ""}${s.warmupAborted && s.aborted ? " and " : ""}${s.aborted ? `measured pass kept ${s.iv.length} of ${SWEEP_FRAMES} frames` : ""}`;
    }
  } catch (e) {
    classify(e, r.firstPaintMs === undefined ? "load" : "sweep");
  }
  if (errors.length) r.pageErrors = errors.slice(0, 5);
  // A hung renderer can make close() wait: give it a bounded time, then move on.
  await Promise.race([ctx.close(), new Promise((res) => setTimeout(res, 20_000))]).catch(() => undefined);
  return { r, path };
}

test.beforeAll(async ({ browser }) => {
  if (process.env.AC_COMPARE !== "1") throw new Error("run this through `pnpm bench:compare`: it builds and serves bench/compare, which this spec needs");
  if (!existsSync("compare/dist/.vite/manifest.json")) throw new Error("bench/compare is not built (the webServer should have built it)");
  bundles = measureBundles();
  meta = {
    date: new Date().toISOString(),
    machine: machine(),
    chrome: browser.version(),
    libraries: libraries(),
    dataset: { generator: "apps/playground/src/synthetic.ts ohlc()", seed: SEED, stepMs: 60_000, end: "2026-10-20T00:00:00Z (the generator default)", sizes: SIZES, columns: "time, open, high, low, close (volume generated, not drawn)" },
    harness: { runsPerCell: RUNS, libs: SELECTED_LIBS, runOrder: "run-major, library order rotated each run", initialVisibleBars: INITIAL_BARS, sweepFrames: SWEEP_FRAMES, sweepPassBudgetMs: SWEEP_PASS_BUDGET_MS, loadTimeoutMs: LOAD_TIMEOUT_MS, viewport: VIEWPORT, deviceScaleFactor: DPR, pageServedBy: "vite preview (production build), cross-origin isolated", chromeLaunch: "headed system Chrome, --enable-precise-memory-info --js-flags=--expose-gc, window parked off-screen (bench/playwright.config.ts)" },
  };
});

test.afterAll(() => {
  flush();
  console.log(`compare: wrote results/${PARTIAL ? "compare.partial.json" : "compare.json"}; next: node ../scripts/compare-report.mjs results/${PARTIAL ? "compare.partial.json" : "compare.json"}`);
});

for (const bars of SIZES) {
  test(`${bars.toLocaleString("en-US")} bars: ${SELECTED_LIBS.join(", ")}`, async ({ browser }) => {
    test.setTimeout(0); // bounded by the per-run timeouts above
    const byLib = new Map<Lib, Cell>(SELECTED_LIBS.map((lib) => [lib, { lib, bars, runs: [] }]));
    byLib.forEach((c) => cells.push(c));
    const consecutiveFailures = new Map<Lib, number>();
    for (let run = 1; run <= RUNS; run++) {
      // Rotate the order each run so no library always goes first or last (thermal drift, cache state).
      const order = SELECTED_LIBS.map((_, i) => SELECTED_LIBS[(i + run - 1) % SELECTED_LIBS.length]!);
      for (const lib of order) {
        const cell = byLib.get(lib)!;
        if ((consecutiveFailures.get(lib) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
          cell.runs.push({ run, outcome: "not attempted", detail: `the previous ${MAX_CONSECUTIVE_FAILURES} runs failed` });
          continue;
        }
        const { r, path } = await once(browser, lib, bars, run);
        if (path) cell.path = path;
        cell.runs.push(r);
        consecutiveFailures.set(lib, r.outcome === "failed" ? (consecutiveFailures.get(lib) ?? 0) + 1 : 0);
        console.log(`${lib} @ ${bars.toLocaleString("en-US")} run ${run}/${RUNS}: ${r.outcome}${r.detail ? ` (${r.detail})` : ""}${r.interval ? ` p95 ${r.interval.p95} ms, missed ${r.missed}/${r.frames}` : ""}${r.firstPaintMs !== undefined ? `, first paint ${r.firstPaintMs} ms` : ""}`);
      }
      flush();
    }
    // Every run must have generated the same dataset. This checks the generator's output, not what
    // each adapter converts it into.
    const sums = new Set([...byLib.values()].flatMap((c) => c.runs.map((r) => r.checksum && JSON.stringify(r.checksum)).filter(Boolean)));
    if (sums.size > 1) throw new Error(`${bars} bars: libraries did not get the same dataset (${sums.size} distinct checksums)`);
  });
}
