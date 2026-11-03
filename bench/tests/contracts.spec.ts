// Core contracts the packages build on: plugins and layout persistence.
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });

const ready = async (page: import("@playwright/test").Page, q: string) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/?${q}`);
  await page.waitForFunction(() => window.__ready === true);
  return errors;
};

test("a plugin that consumes the pointer-down gets the drag and the chart does not pan", async ({ page }) => {
  const errors = await ready(page, "ex=basic&n=3000");
  await page.evaluate(() => {
    const c = window.__charts[0]!;
    const log: string[] = [];
    (window as unknown as { __log: string[] }).__log = log;
    c.addPlugin({
      id: "probe",
      install: () => {},
      pointer: (e) => {
        log.push(`${e.type}:${e.pane}`);
        return e.shiftKey && (e.type === "down" || e.type === "move" || e.type === "up");
      },
    });
  });
  const right0 = await page.evaluate(() => window.__charts[0]!.timeScale.getVisibleLogicalRange().to);
  await page.keyboard.down("Shift");
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(250, 300, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const right1 = await page.evaluate(() => window.__charts[0]!.timeScale.getVisibleLogicalRange().to);
  expect(right1).toBe(right0);
  const log = await page.evaluate(() => (window as unknown as { __log: string[] }).__log);
  expect(log).toContain("down:0");
  expect(log.filter((x) => x === "move:0").length).toBeGreaterThanOrEqual(5);
  expect(log).toContain("up:0");
  // Without Shift the plugin passes and the chart pans.
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(250, 300, { steps: 5 });
  await page.mouse.up();
  const right2 = await page.evaluate(() => window.__charts[0]!.timeScale.getVisibleLogicalRange().to);
  expect(right2).toBeGreaterThan(right1); // content follows the pointer left: later bars come into view
  expect(errors).toEqual([]);
});

test("time ↔ x round-trips inside the data and extrapolates past the last bar", async ({ page }) => {
  await ready(page, "ex=basic&n=3000");
  const r = await page.evaluate(() => {
    const c = window.__charts[0]!;
    let v: import("@alphacharts/core").PluginPaneView | undefined;
    c.addPlugin({ id: "v", install: (api) => (v = api.paneView(0)) });
    const d = window.__data;
    const last = d.time[d.time.length - 1]!;
    const mid = d.time[2000]! + 30_000; // between two bars
    return [last - 600_000, mid, last + 5 * 60_000].map((t) => [t, v!.xToTime(v!.timeToX(t))]);
  });
  for (const [t, back] of r) expect(back!).toBeCloseTo(t!, 3);
});

test("a layout survives save → restore into a fresh chart", async ({ page }) => {
  await ready(page, "ex=panes&n=3000");
  // The source of this checkout (the dev server serves it under /@fs), not a fixed path.
  const coreSrc = new URL("../../packages/core/src/index.ts", import.meta.url).pathname;
  const r = await page.evaluate(async (coreSrc) => {
    const core = await import(/* @vite-ignore */ "/@fs" + coreSrc);
    const a = window.__charts[0]!;
    a.priceScale("right").applyOptions({ mode: "log" });
    a.timeScale.setVisibleLogicalRange({ from: 1000, to: 1500 });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const saved = JSON.parse(JSON.stringify(a.saveState()));
    const store = new core.MemoryStore();
    await store.save("k", saved);
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;opacity:0";
    document.body.appendChild(el);
    const b = core.createChart(el);
    const d = window.__data;
    b.restoreState(await store.load("k"), { data: (ss: { type: string }) => (ss.type === "candles" ? d : undefined) });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const out = {
      types: b.series().map((s: { type: string }) => s.type),
      ids: b.series().map((s: { options(): { id: string } }) => s.options().id),
      saved: saved.series.map((s: { id: string }) => s.id),
      mode: b.priceScale("right").options().mode,
      range: b.timeScale.getVisibleLogicalRange(),
      futureRefused: (() => { try { b.restoreState({ ...saved, version: 99 }); return false; } catch (e) { return /newer/.test(String(e)); } })(),
      pluginRefused: (() => { try { b.restoreState({ ...saved, plugins: { drawings: [] } }); return false; } catch (e) { return /not installed/.test(String(e)); } })(),
    };
    return out;
  }, coreSrc);
  expect(r.types).toEqual(["candles", "line", "line", "histogram"]);
  expect(r.ids).toEqual(r.saved);
  expect(r.mode).toBe("log");
  expect(r.range.from).toBeCloseTo(1000, 6);
  expect(r.range.to).toBeCloseTo(1500, 6);
  expect(r.futureRefused).toBe(true);
  expect(r.pluginRefused).toBe(true);
});

test("a custom timeLabel is marked in the layout and must be re-supplied on restore", async ({ page }) => {
  await ready(page, "ex=blank");
  const r = await page.evaluate(async () => {
    const { createChart, ohlc } = window.__ac!;
    const mk = (opts: object = {}) => {
      const el = document.createElement("div");
      el.style.cssText = "width:600px;height:300px";
      document.getElementById("app")!.appendChild(el);
      const c = createChart(el, opts);
      c.addSeries("candles").setData(ohlc(300, 3));
      return c;
    };
    const label = (_t: number, kind: string) => `L-${kind}`;
    const a = mk({ timeLabel: label });
    const saved = JSON.parse(JSON.stringify(a.saveState()));
    const plain = JSON.parse(JSON.stringify(mk().saveState()));
    const b = mk();
    const seen: string[] = [];
    const real = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, t: string, ...rest: [number, number]) {
      seen.push(t);
      return real.call(this, t, ...rest);
    };
    let refused = "";
    try { b.restoreState(saved, { data: () => ohlc(300, 3) }); } catch (e) { refused = String(e); }
    const seriesAfterRefusal = b.series().length;
    b.restoreState(saved, { data: () => ohlc(300, 3), timeLabel: label });
    (b as unknown as { render(l: number): void }).render(7);
    CanvasRenderingContext2D.prototype.fillText = real;
    // A layout saved without one restores without one.
    const c = mk();
    c.restoreState(plain, { data: () => ohlc(300, 3) });
    return { marked: saved.customOptions, plainMarked: plain.customOptions, refused, seriesAfterRefusal, drawn: seen.filter((t) => t.startsWith("L-")).length };
  });
  expect(r.marked).toEqual(["timeLabel"]);
  expect(r.plainMarked).toBeUndefined();
  expect(r.refused).toMatch(/custom timeLabel.*restoreState\(\{ timeLabel \}\)/);
  expect(r.seriesAfterRefusal).toBe(1); // refused before anything was replaced
  expect(r.drawn).toBeGreaterThan(3); // the axis ticks use the supplied function
});

test("sessions shade pre-open bars; the countdown counts to the 5-minute close", async ({ page }) => {
  await ready(page, "ex=sessions&n=20000");
  const r = await page.evaluate(() => {
    const c = window.__charts[0]! as unknown as { countdownText(): string | null; sessions: { state(t: number): string } };
    const d = window.__data;
    let pre = 0;
    for (let i = 0; i < d.time.length; i++) if (c.sessions.state(d.time[i]!) === "extended") pre++;
    return { countdown: c.countdownText(), pre, total: d.time.length };
  });
  // The data ended in the past, so the last bar's close has passed: 00:00.
  expect(r.countdown).toBe("00:00");
  expect(r.pre).toBeGreaterThan(0);
  expect(r.pre).toBeLessThan(r.total);
});

test("screen-reader table lists the visible bars with exact formatted prices", async ({ page }) => {
  await ready(page, "ex=basic&n=3000");
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const t = document.querySelector("table")!;
    const first = t.querySelector("tbody tr")!;
    const d = window.__data;
    const i = d.time.length - 1;
    return { caption: t.querySelector("caption")!.textContent, cells: [...first.querySelectorAll("td")].map((x) => x.textContent), close: d.close[i]!, rows: t.querySelectorAll("tbody tr").length };
  });
  expect(r.caption).toContain("newest first");
  expect(r.rows).toBeGreaterThan(10);
  expect(r.rows).toBeLessThanOrEqual(200);
  expect(r.cells[3]).toBe(r.close.toFixed(2));
});

test("key map: defaults work and a rebinding takes effect", async ({ page }) => {
  await ready(page, "ex=basic&n=3000");
  const root = page.locator("[aria-roledescription=chart]");
  await root.focus();
  const spacing = () => page.evaluate(() => window.__charts[0]!.timeScale.barSpacing());
  const s0 = await spacing();
  await page.keyboard.press("ArrowUp");
  expect(await spacing()).toBeGreaterThan(s0);
  await page.evaluate(() => window.__charts[0]!.applyOptions({ keymap: { zoomIn: ["z"], zoomOut: ["x"] } }));
  const s1 = await spacing();
  await page.keyboard.press("ArrowUp");
  expect(await spacing()).toBe(s1);
  await page.keyboard.press("z");
  expect(await spacing()).toBeGreaterThan(s1);
  await page.keyboard.press("Alt+r");
  expect(await spacing()).toBe(8);
});

test("high-contrast theme applies and every theme colour is validated", async ({ page }) => {
  await ready(page, "ex=basic&n=3000");
  const r = await page.evaluate(() => {
    const c = window.__charts[0]!;
    c.applyOptions({ theme: "high-contrast" });
    const ok = c.options().theme.background === "#000000";
    let threw = false;
    try { c.applyOptions({ theme: { grid: "grey" } }); } catch { threw = true; }
    return { ok, threw, still: c.options().theme.background };
  });
  expect(r).toEqual({ ok: true, threw: true, still: "#000000" });
});

test("a Dashboard keeps every cell painted when only one chart redraws", async ({ page }) => {
  // The charts share one WebGL canvas that is not preserved between frames, so
  // a frame in which one cell draws must redraw the others. Checked on screen:
  // chart B's cell must be pixel-identical before and after frames in which
  // only chart A redrew (a blank or stale cell differs).
  await ready(page, "ex=synced&n=3000&k=2&dash=1");
  const cell = await page.evaluate(() => {
    const b = (window.__charts as unknown as Array<{ element: HTMLElement }>)[1]!;
    const r = b.element.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  await page.mouse.move(1, 1);
  const before = await page.screenshot({ clip: cell });
  await page.evaluate(async () => {
    const a = (window.__charts as unknown as Array<{ invalidate(l: number): void }>)[0]!;
    for (let i = 0; i < 6; i++) {
      a.invalidate(2);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  const after = await page.screenshot({ clip: cell });
  expect(after.equals(before)).toBe(true);
});

test("a plugin may install before the chart has any series", async ({ page }) => {
  // The UI installs analysis plugins before data arrives: a pane view must
  // exist (height 0, scale calls refused clearly) and come alive with the pane.
  await ready(page, "ex=basic&n=300");
  const r = await page.evaluate(async () => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;opacity:0";
    document.body.appendChild(el);
    const Chart = window.__charts[0]!.constructor as new (el: HTMLElement) => import("@alphacharts/core").Chart;
    const c = new Chart(el);
    let view: import("@alphacharts/core").PluginPaneView | undefined;
    c.addPlugin({ id: "early", install: (api) => (view = api.paneView(0)) });
    const before = { height: view!.height, mode: typeof view!.priceScaleMode };
    let threw = "";
    try { view!.priceToY(100); } catch (e) { threw = String(e); }
    c.addSeries("line").setData([{ time: 0, value: 100 }, { time: 60_000, value: 101 }]);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const after = { height: view!.height, y: Number.isFinite(view!.priceToY(100.5)), mode: view!.priceScaleMode!() };
    c.remove();
    return { before, threw, after };
  });
  expect(r.before).toEqual({ height: 0, mode: "function" });
  expect(r.threw).toContain("no pane 0");
  expect(r.after.height).toBeGreaterThan(0);
  expect(r.after.y).toBe(true);
  expect(r.after.mode).toBe("linear");
});

// H8: removing a chart uninstalls its plugins, last installed first, so a plugin can release what it holds (workers, timers).
test("Chart.remove() uninstalls the plugins in reverse install order", async ({ page }) => {
  await ready(page, "ex=basic&n=300");
  const log = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;opacity:0";
    document.body.appendChild(el);
    const Chart = window.__charts[0]!.constructor as new (el: HTMLElement) => import("@alphacharts/core").Chart;
    const c = new Chart(el);
    const log: string[] = [];
    for (const id of ["first", "second", "third"]) c.addPlugin({ id, install: () => {}, uninstall: () => void log.push(id) });
    c.remove();
    c.remove(); // idempotent: no second uninstall
    return log;
  });
  expect(log).toEqual(["third", "second", "first"]);
});

// H9: a layout is applied whole or not at all, and plugins it does not mention go back to their fresh state.
test("restoreState refuses a plugin state the plugin rejects before changing anything", async ({ page }) => {
  await ready(page, "ex=basic&n=300");
  const r = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;opacity:0";
    document.body.appendChild(el);
    const Chart = window.__charts[0]!.constructor as new (el: HTMLElement) => import("@alphacharts/core").Chart;
    const c = new Chart(el);
    c.addSeries("candles", { id: "main" });
    const applied: unknown[] = [];
    c.addPlugin({
      id: "probe", install: () => {}, toJSON: () => ({ n: 1 }), fromJSON: (s) => void applied.push(s),
      validateState: (s: unknown) => { if ((s as { bad?: boolean }).bad) throw new Error("probe: bad state"); },
    } as never);
    const saved = JSON.parse(JSON.stringify(c.saveState()));
    c.addSeries("line", { id: "extra" });
    saved.plugins.probe = { bad: true };
    let err = "";
    try { c.restoreState(saved); } catch (e) { err = String(e); }
    const out = { err, ids: c.series().map((s) => s.options().id), applied: applied.length };
    c.remove();
    return out;
  });
  expect(r.err).toContain("probe: bad state");
  expect(r.ids).toEqual(["main", "extra"]); // the series were not replaced
  expect(r.applied).toBe(0);
});

test("restoreState resets an installed plugin the layout does not mention", async ({ page }) => {
  await ready(page, "ex=basic&n=300");
  const r = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;opacity:0";
    document.body.appendChild(el);
    const Chart = window.__charts[0]!.constructor as new (el: HTMLElement) => import("@alphacharts/core").Chart;
    const c = new Chart(el);
    c.addSeries("candles", { id: "main" });
    const saved = JSON.parse(JSON.stringify(c.saveState())); // before the plugin existed
    let content = 0;
    c.addPlugin({ id: "late", install: () => {}, toJSON: () => ({ content }), fromJSON: (s: unknown) => { content = (s as { content: number }).content; } });
    content = 7;
    c.restoreState(saved);
    const out = { content };
    c.remove();
    return out;
  });
  expect(r.content).toBe(0); // the fresh state, not the 7 the old layout left
});

test("a pointer leave after the pane it started in was removed is ignored, not thrown", async ({ page }) => {
  // A dashboard regrid can remove a pane while the pointer is over it; the
  // trailing leave/up must not ask the removed pane for a price.
  const errors = await ready(page, "ex=basic&n=300");
  const r = await page.evaluate(() => {
    const c = window.__charts[0]! as unknown as {
      addPlugin(p: { id: string; install(): void; pointer(e: { type: string }): boolean }): void;
      pluginPointer(type: string, x: number, y: number, e: null): boolean;
      series(): Array<unknown>;
      removeSeries(s: unknown): void;
    };
    const seen: string[] = [];
    c.addPlugin({ id: "leave-probe", install: () => {}, pointer: (e) => (seen.push(e.type), false) });
    c.pluginPointer("move", 200, 150, null);
    for (const s of [...c.series()]) c.removeSeries(s);
    let threw = "";
    try { c.pluginPointer("leave", 200, 150, null); } catch (e) { threw = String(e); }
    return { threw, seen };
  });
  expect(r.threw).toBe("");
  expect(r.seen).toEqual(["move"]);
  expect(errors).toEqual([]);
});
