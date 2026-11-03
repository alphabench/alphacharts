// @alphacharts/plot at 10k points (?ex=plot&only=perf): first render, then a
// wheel-zoom sweep and a hover sweep. Records CPU ms per draw (ours) and the rAF
// interval, writes bench/results/plot-perf.json, and fails if a draw of 10k points
// plus 10k dots takes longer than a frame budget on this machine.

import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 2 });

const q = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

test("10k points: draw, zoom sweep and hover sweep", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?ex=plot&only=perf&n=10000");
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 60_000 });
  const r = await page.evaluate(async () => {
    type P = { flush(): void; setView(v: [number, number] | null): void; root: HTMLElement; cells: { panel: { area: { x: number; y: number; w: number; h: number } } }[] };
    const p = (window as unknown as { __plots: P[] }).__plots[0]!;
    const draw: number[] = [];
    const frames: number[] = [];
    const time = (fn: () => void) => {
      const t = performance.now();
      fn();
      return performance.now() - t;
    };
    // The display's refresh interval, from idle frames, to read the zoom sweep against.
    const idle: number[] = [];
    let prev = performance.now();
    for (let i = 0; i < 60; i++) {
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      const now = performance.now();
      idle.push(now - prev);
      prev = now;
    }
    const refresh = idle.slice().sort((a, b) => a - b)[30]!;
    for (let i = 0; i < 5; i++) p.flush(); // warm up
    for (let i = 0; i < 40; i++) draw.push(time(() => p.flush()));
    // Zoom sweep: a view that narrows and slides, one draw per frame.
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      const w = 10_000 * (1 - i / 140);
      const lo = (i / 120) * (10_000 - w);
      p.setView([lo, lo + w]);
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    // Hover sweep: pointer moves across the area, each a hit test and an overlay draw.
    const hover: number[] = [];
    p.setView(null);
    p.flush();
    const rect = p.root.getBoundingClientRect();
    const a = p.cells[0]!.panel.area;
    for (let i = 0; i < 200; i++) {
      const x = rect.left + a.x + (a.w * i) / 200, y = rect.top + a.y + a.h / 2;
      hover.push(time(() => p.root.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }))));
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
    }
    return { draw, frames, hover, refresh };
  });
  const out = {
    points: 10_000,
    refreshMs: r.refresh,
    drawMs: { p50: q(r.draw, 0.5), p95: q(r.draw, 0.95), max: Math.max(...r.draw) },
    zoomFrameMs: { p50: q(r.frames, 0.5), p95: q(r.frames, 0.95), max: Math.max(...r.frames) },
    hoverMs: { p50: q(r.hover, 0.5), p95: q(r.hover, 0.95), max: Math.max(...r.hover) },
  };
  mkdirSync("results", { recursive: true });
  writeFileSync("results/plot-perf.json", JSON.stringify(out, null, 2));
  console.table(Object.entries(out).filter(([k]) => typeof (out as Record<string, unknown>)[k] === "object").map(([k, v]) => ({ metric: k, ...(v as object) })));
  expect(errors).toEqual([]);
  // A full draw of a 10k-point line and a 10k-dot scatter at DPR 2 fits a 60 Hz frame; hover stays far under it.
  expect(out.drawMs.p95).toBeLessThan(16);
  expect(out.hoverMs.p95).toBeLessThan(8);
  // Zooming redraws once per display frame: no frame takes more than 1.5 refresh intervals beyond the display's own cadence.
  expect(out.zoomFrameMs.p95).toBeLessThan(out.refreshMs * 2.5);
});

// A replay at 10 Hz on two charts: each tick is update() on both plots with one more
// point, then the frame's draw. Records the CPU ms of update() (spec compile, table,
// layout state) and of the draw, per tick, writes bench/results/plot-update.json.
test("update at 10 Hz x 2 charts: update() and draw per tick", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?ex=plot&only=perf&n=100");
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 60_000 });
  const r = await page.evaluate(async () => {
    type P = { update(s: unknown): void; flush(): void; on(t: string, f: (e: unknown) => void): () => void; dispose(): void };
    type Demo = { api: { createPlot(el: HTMLElement, s: unknown): P; replaySpecs(n: number): unknown[] } };
    const demo = (window as unknown as { __plotDemo: Demo }).__plotDemo;
    const hosts = [0, 1].map(() => {
      const el = document.createElement("div");
      el.style.cssText = "width:640px;height:240px;";
      document.body.appendChild(el);
      return el;
    });
    const START = 2000, TICKS = 100;
    const first = demo.api.replaySpecs(START);
    const plots = hosts.map((el, i) => demo.api.createPlot(el, first[i]));
    let hovers = 0;
    plots[0]!.on("hover", () => hovers++);
    plots.forEach((p) => p.flush());
    const upd: number[] = [], draw: number[] = [];
    for (let k = 1; k <= TICKS; k++) {
      const next = demo.api.replaySpecs(START + k); // the host's own cost, outside the measurement
      const t0 = performance.now();
      plots.forEach((p, i) => p.update(next[i]));
      const t1 = performance.now();
      plots.forEach((p) => p.flush());
      const t2 = performance.now();
      upd.push(t1 - t0);
      draw.push(t2 - t1);
      await new Promise<void>((res) => setTimeout(res, 0));
    }
    plots.forEach((p) => p.dispose());
    hosts.forEach((el) => el.remove());
    return { upd, draw, hovers };
  });
  const out = {
    points: 2000,
    charts: 2,
    // Both charts per tick.
    updateMs: { p50: q(r.upd, 0.5), p95: q(r.upd, 0.95), max: Math.max(...r.upd) },
    drawMs: { p50: q(r.draw, 0.5), p95: q(r.draw, 0.95), max: Math.max(...r.draw) },
  };
  mkdirSync("results", { recursive: true });
  writeFileSync("results/plot-update.json", JSON.stringify(out, null, 2));
  console.table(Object.entries(out).filter(([, v]) => typeof v === "object").map(([k, v]) => ({ metric: k, ...(v as object) })));
  expect(errors).toEqual([]);
  // 10 Hz on two charts leaves 100 ms a tick; update() plus its draw must fit one 60 Hz frame with room for the page's own work.
  expect(out.updateMs.p95 + out.drawMs.p95).toBeLessThan(16);
  expect(out.updateMs.p95).toBeLessThan(6);
});
