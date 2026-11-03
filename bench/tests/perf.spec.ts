// Frame-time benchmarks. Each scenario drives the view from requestAnimationFrame
// for a fixed number of frames and records:
//   - rAF interval per frame (what the user sees; includes GPU back-pressure),
//   - CPU ms inside alphacharts' render (ours only),
//   - JS heap growth across the steady-state frames (after a forced GC).
// The same pan/zoom sweep runs on lightweight-charts as the baseline.
// Results: bench/results/perf.json and a table on stdout.

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

interface Result {
  scenario: string;
  bars: number;
  frames: number;
  refreshMs: number;
  interval: { p50: number; p95: number; p99: number; max: number };
  over16: number;
  /** Frames longer than 1.5 × the display refresh: a missed vsync. */
  missed: number;
  cpu?: { p50: number; p95: number; p99: number; max: number };
  heapGrowthKB?: number;
  setDataMs?: number;
  note?: string;
}

const results: Result[] = [];

test.afterAll(() => {
  mkdirSync("results", { recursive: true });
  writeFileSync("results/perf.json", JSON.stringify(results, null, 2));
  console.table(
    results.map((r) => ({
      scenario: r.scenario,
      bars: r.bars.toLocaleString(),
      "p50 ms": r.interval.p50,
      "p95 ms": r.interval.p95,
      "p99 ms": r.interval.p99,
      ">16.7ms": r.over16,
      missed: r.missed,
      "cpu p95": r.cpu?.p95 ?? "",
      "heap +KB": r.heapGrowthKB ?? "",
      "setData ms": r.setDataMs ?? "",
      note: r.note ?? "",
    })),
  );
});

async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300_000 });
  expect(errors).toEqual([]);
}

/** Display refresh interval, measured over 120 idle frames. */
async function refresh(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const ts: number[] = [];
        const f = (t: number) => {
          ts.push(t);
          if (ts.length < 121) requestAnimationFrame(f);
          else {
            const d = ts.slice(1).map((t, i) => t - ts[i]!).sort((a, b) => a - b);
            resolve(d[d.length >> 1]!);
          }
        };
        requestAnimationFrame(f);
      }),
  );
}

// The sweep, as code evaluated in the page. `apply(k, frames)` sets the view
// for frame k: zoom out to the whole history, pan across it, zoom back in.
const SWEEP = (lib: "ours" | "lwc", frames: number) => `
(async () => {
  const frames = ${frames};
  const lib = "${lib}";
  let first, last, setRange; var cpu = [];
  if (lib === "ours") {
    const c = window.__charts[0];
    const orig = c.render.bind(c);
    c.render = (l, n) => { const t0 = performance.now(); orig(l, n); cpu.push(performance.now() - t0); };
    window.__cpu = () => cpu;
    first = c.time.first; last = c.time.last;
    setRange = (a, b) => c.timeScale.setVisibleLogicalRange({ from: a, to: b });
  } else {
    const ts = window.__lwc.timeScale();
    first = 0; last = window.__data.time.length - 1;
    setRange = (a, b) => ts.setVisibleLogicalRange({ from: a, to: b });
  }
  const span0 = 200, total = last - first + 1;
  const third = Math.floor(frames / 3);
  const apply = (k) => {
    let a, b;
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
    setRange(a, b);
  };
  const run = (ts) => new Promise((resolve) => {
    let k = 0;
    const f = (t) => {
      ts.push(t);
      if (k < frames) { apply(k++); requestAnimationFrame(f); } else resolve();
    };
    requestAnimationFrame(f);
  });
  // A warm-up pass first: buffers reach their working size and caches fill,
  // so heap growth over the measured pass is what a long session would leak.
  await run([]);
  cpu = [];
  window.gc?.();
  const heap0 = performance.memory?.usedJSHeapSize ?? 0;
  const ts = [];
  await run(ts);
  window.gc?.();
  const heap1 = performance.memory?.usedJSHeapSize ?? 0;
  const iv = ts.slice(2).map((t, i) => t - ts[i + 1]);
  return { iv, cpu: cpu.slice(2), heapGrowthKB: Math.round((heap1 - heap0) / 1024) };
})()`;

const pct = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN).toFixed(2);
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +(s[s.length - 1] ?? NaN).toFixed(2) };
};

/**
 * The gate for alphacharts scenarios: at most 1% of frames miss a vsync at the
 * display's own refresh (120 Hz here, so this is stricter than "under 16.7 ms").
 */
function gate(r: Result): void {
  expect(r.refreshMs).toBeGreaterThan(0);
  expect(r.missed, `${r.scenario}: ${r.missed}/${r.frames} frames over 1.5 × ${r.refreshMs} ms`).toBeLessThanOrEqual(Math.floor(r.frames * 0.01));
}

async function sweep(page: Page, scenario: string, lib: "ours" | "lwc", bars: number, note?: string): Promise<Result> {
  const refreshMs = await refresh(page);
  const stat = (await page.locator(".stat").textContent()) ?? "";
  const m = /setData (\d+) ms/.exec(stat);
  const r = (await page.evaluate(SWEEP(lib, 600))) as { iv: number[]; cpu: number[]; heapGrowthKB: number };
  const res: Result = {
    scenario,
    bars,
    frames: r.iv.length,
    refreshMs: +refreshMs.toFixed(2),
    interval: pct(r.iv),
    over16: r.iv.filter((x) => x > 16.7).length,
    missed: r.iv.filter((x) => x > refreshMs * 1.5).length,
    ...(r.cpu.length ? { cpu: pct(r.cpu) } : {}),
    heapGrowthKB: r.heapGrowthKB,
    ...(m ? { setDataMs: +m[1]! } : {}),
    ...(note ? { note } : {}),
  };
  results.push(res);
  return res;
}

test("pan/zoom sweep, 1M bars — alphacharts", async ({ page }) => {
  await open(page, "ex=big&n=1000000");
  gate(await sweep(page, "sweep", "ours", 1_000_000));
});

test("pan/zoom sweep, 10M bars — alphacharts", async ({ page }) => {
  await open(page, "ex=big&n=10000000");
  gate(await sweep(page, "sweep", "ours", 10_000_000));
});

test("pan/zoom sweep, 1M bars — lightweight-charts 5.2.1", async ({ page }) => {
  await open(page, "ex=lwc&n=1000000");
  await sweep(page, "sweep (lwc)", "lwc", 1_000_000);
});

test("pan/zoom sweep, 10M bars — lightweight-charts 5.2.1", async ({ page }) => {
  try {
    await open(page, "ex=lwc&n=10000000");
    await sweep(page, "sweep (lwc)", "lwc", 10_000_000);
  } catch (e) {
    results.push({ scenario: "sweep (lwc)", bars: 10_000_000, frames: 0, refreshMs: NaN, interval: { p50: NaN, p95: NaN, p99: NaN, max: NaN }, over16: NaN, missed: NaN, note: `did not complete: ${String(e).split("\n")[0]}` });
  }
});

test("100 Hz ticks while panning, 1M bars — alphacharts", async ({ page }) => {
  await open(page, "ex=live&n=1000000&auto=0");
  // Ticks from a 10 ms timer run alongside the rAF sweep.
  await page.evaluate(() => {
    (window as unknown as { __tickTimer: number }).__tickTimer = window.setInterval(() => window.__tick!(1), 10);
  });
  gate(await sweep(page, "sweep + 100 Hz ticks", "ours", 1_000_000));
});

async function synced(page: Page, renderer: string, k = 16, dash = false): Promise<void> {
  await open(page, `ex=synced&n=100000&k=${k}&renderer=${renderer}${dash ? "&dash=1" : ""}`);
  // Drive the first chart through the public API; the SyncGroup moves the
  // other 15 every frame. CPU is summed over the other 15 per frame.
  await page.evaluate(() => {
    const w = window as unknown as { __frameCpu: number[] };
    w.__frameCpu = [];
    let acc = 0;
    for (const c of window.__charts.slice(1)) {
      const orig = c.render.bind(c);
      c.render = (l: number, n: number) => {
        const t0 = performance.now();
        orig(l, n);
        acc += performance.now() - t0;
      };
    }
    const tick = () => {
      w.__frameCpu.push(acc);
      acc = 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const res = await sweep(page, `${k} synced, ${dash ? "dashboard" : "standalone"}, ${renderer}`, "ours", k * 100_000);
  const others = (await page.evaluate(() => (window as unknown as { __frameCpu: number[] }).__frameCpu)).slice(-600);
  res.note = `other ${k - 1} charts' cpu per frame p95 ${pct(others).p95} ms`;
  gate(res);
}

test("16 synced charts × 100k bars, standalone (16 contexts) — reported", async ({ page }) => {
  // Standalone charts each own a context and three canvases: the measured
  // reason Dashboard exists. Reported, not gated.
  try {
    await synced(page, "webgl");
  } catch (e) {
    results[results.length - 1]!.note += ` (not gated: ${String(e).split("\n")[0]})`;
  }
});

test("16 synced charts × 100k bars, Dashboard — alphacharts", async ({ page }) => {
  await synced(page, "webgl", 16, true);
});

test("48 synced charts × 100k bars, Dashboard — alphacharts", async ({ page }) => {
  await synced(page, "webgl", 48, true);
});

test("16 synced charts × 100k bars, Dashboard on Canvas2D — reported", async ({ page }) => {
  try {
    await synced(page, "canvas2d", 16, true);
  } catch (e) {
    // Canvas2D is the no-WebGL fallback: reported, not gated.
    results[results.length - 1]!.note += ` (not gated: ${String(e).split("\n")[0]})`;
  }
});
