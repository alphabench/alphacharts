// Regressions from the cross-package review of the chart application: restore
// of studies, compares and alerts, and the alert clock. Each test states what a
// user saw go wrong. The app is driven through window.__app on the synthetic feed (?ex=ui).

import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?ex=ui&${query}`);
  await page.waitForFunction(() => (window as Any).__uiReady === true);
  await page.evaluate(() => {
    // Everything the app reports to the user is recorded here.
    const w = window as Any;
    w.__reported = [];
    w.__app.events.on("error", (e: Error) => w.__reported.push(e.message));
  });
  return errors;
}

const reported = (page: Page): Promise<string[]> => page.evaluate(() => (window as Any).__reported);
const ready = (page: Page, i = 0) => page.waitForFunction((k) => (window as Any).__app.instances[k].status === "ready", i);

/** Add an RSI to chart 0 and return its id and first column. */
const addRsi = (page: Page) =>
  page.evaluate(async () => {
    const app = (window as Any).__app;
    await app.ensureStudies();
    const s = app.instances[0].addStudy(app.studyDef("rsi"));
    await s.ready();
    return { id: s.id as string, col: s.def.columns[0] as string };
  });

test("an alert on a study survives a layout round trip, bound to the same study", async ({ page }) => {
  const errors = await open(page);
  const { id, col } = await addRsi(page);
  const r = await page.evaluate(async ({ id, col }) => {
    const app = (window as Any).__app;
    const inst = app.instances[0];
    inst.addAlert({ type: "indicator", id: `${id}:${col}`, op: "greaterThan", value: -1 }, { mode: "once" });
    const state = JSON.parse(JSON.stringify(inst.toJSON()));
    let thrown = "";
    try { inst.fromJSON(state); } catch (e) { thrown = String(e); }
    return { thrown, saved: state.alerts };
  }, { id, col });
  expect(r.thrown).toBe("");
  await ready(page);
  await page.waitForFunction(() => (window as Any).__app.instances[0].studies().length === 1);
  const after = await page.evaluate(async () => {
    const inst = (window as Any).__app.instances[0];
    await inst.studies()[0].study.ready();
    const alerts = inst.alertList();
    (window as Any).__feed.replay("ALPHA", [2500.5]);
    return { studyId: inst.studies()[0].study.id, alerts: alerts.map((a: Any) => [a.status, a.definition.condition.id]), afterTick: inst.alertList().map((a: Any) => a.status) };
  });
  expect(after.studyId).toBe(id); // the study keeps its id, so the saved alert still points at it
  expect(after.alerts).toEqual([["active", `${id}:${col}`]]);
  expect(after.afterTick).toEqual(["triggered"]); // and evaluates against it
  expect(await reported(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("after a study that came first is removed, the saved alert still follows its own study", async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async () => {
    const app = (window as Any).__app;
    const inst = app.instances[0];
    await app.ensureStudies();
    const a = inst.addStudy(app.studyDef("sma"));
    const b = inst.addStudy(app.studyDef("rsi"));
    await Promise.all([a.ready(), b.ready()]);
    inst.removeStudy(a.id);
    const col = b.def.columns[0];
    inst.addAlert({ type: "indicator", id: `${b.id}:${col}`, op: "greaterThan", value: -1 }, { mode: "once" });
    const state = JSON.parse(JSON.stringify(inst.toJSON()));
    inst.fromJSON(state);
    return { bId: b.id, savedStudyIds: state.studies.map((s: Any) => s.id) };
  });
  await ready(page);
  await page.waitForFunction(() => (window as Any).__app.instances[0].studies().length === 1);
  const after = await page.evaluate(() => {
    const inst = (window as Any).__app.instances[0];
    return { ids: inst.studies().map((s: Any) => s.study.id), def: inst.studies()[0].study.def.id, alert: inst.alertList()[0].definition.condition.id as string };
  });
  expect(out.savedStudyIds).toEqual([out.bId]);
  expect(after.ids).toEqual([out.bId]);
  expect(after.def).toBe("rsi");
  expect(after.alert.startsWith(`${out.bId}:`)).toBe(true);
});

test("applying a chart template keeps the chart's alerts and reports nothing", async ({ page }) => {
  const errors = await open(page);
  const { id, col } = await addRsi(page);
  await page.evaluate(async ({ id, col }) => {
    const app = (window as Any).__app;
    app.instances[0].addAlert({ type: "indicator", id: `${id}:${col}`, op: "greaterThan", value: -1 }, { mode: "once" });
    await app.saveTemplate("t1");
    await app.applyTemplate("t1");
  }, { id, col });
  await ready(page);
  await page.waitForFunction(() => (window as Any).__app.instances[0].studies().length === 1);
  const r = await page.evaluate(() => (window as Any).__app.instances[0].alertList().length);
  expect(r).toBe(1);
  expect(await reported(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("switching interval and symbol does not break alert ticks; the alert log shows the tick's time", async ({ page }) => {
  const errors = await open(page);
  const t0 = Date.now();
  await page.evaluate(() => {
    const inst = (window as Any).__app.instances[0];
    inst.addAlert({ type: "greaterThan", price: 0 }, { mode: "everyTime" });
    (window as Any).__feed.replay("ALPHA", [2500.5, 2500.6]);
    inst.setInterval("1D");
  });
  await ready(page);
  await page.evaluate(() => { (window as Any).__feed.replay("ALPHA", [2501.5]); (window as Any).__app.instances[0].setInterval("5m"); });
  await ready(page);
  await page.evaluate(() => (window as Any).__feed.replay("ALPHA", [2502.5]));
  await page.evaluate(() => (window as Any).__app.instances[0].setSymbol("BETA"));
  await ready(page);
  await page.evaluate(() => {
    (window as Any).__app.instances[0].addAlert({ type: "greaterThan", price: 0 }, { mode: "everyTime" });
    (window as Any).__feed.replay("BETA", [1450.5]);
  });
  expect(await reported(page)).toEqual([]);
  const log = await page.evaluate(() => (window as Any).__app.alertLog as Array<{ time: number; symbol: string }>);
  expect(log.length).toBeGreaterThan(2);
  // The synthetic bars are a day old: a log time near now is the tick's, not the bar's.
  for (const l of log) expect(Math.abs(l.time - t0)).toBeLessThan(60_000);
  expect(errors).toEqual([]);
});

test("a restore that failed to load is applied by the next successful load", async ({ page }) => {
  const errors = await open(page);
  const { id } = await addRsi(page);
  await page.evaluate(async () => {
    const app = (window as Any).__app;
    const inst = app.instances[0];
    const state = JSON.parse(JSON.stringify(inst.toJSON()));
    const real = app.feed.getBars;
    app.feed.getBars = async () => { throw new Error("feed down"); };
    inst.fromJSON(state);
    (window as Any).__restoreFeed = () => { app.feed.getBars = real; };
  });
  await page.waitForFunction(() => (window as Any).__app.instances[0].status === "error");
  // The saved studies are still carried while the chart is in error.
  expect(await page.evaluate(() => (window as Any).__app.instances[0].toJSON().studies.length)).toBe(1);
  await page.evaluate(() => { (window as Any).__restoreFeed(); (window as Any).__app.instances[0].retry(); });
  await ready(page);
  await page.waitForFunction(() => (window as Any).__app.instances[0].studies().length === 1);
  const after = await page.evaluate(() => {
    const inst = (window as Any).__app.instances[0];
    return { ids: inst.studies().map((s: Any) => s.study.id), saved: inst.toJSON().studies.map((s: Any) => s.id) };
  });
  expect(after.ids).toEqual([id]);
  expect(after.saved).toEqual([id]); // no stale pending list beside the live studies
  expect(errors.filter((e) => !/feed down/.test(e))).toEqual([]);
});

test("compares come off an event-based chart type and return with the time-based one", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => (window as Any).__app.instances[0].addCompare("BETA", "scale"));
  await page.evaluate(() => (window as Any).__app.instances[0].setChartType("renko"));
  await page.waitForTimeout(400); // a frame or two: the scheduler must not meet a compare it cannot label
  const mid = await page.evaluate(() => {
    const inst = (window as Any).__app.instances[0];
    return { saved: inst.toJSON().compares, series: inst.chart.series().map((s: Any) => s.options().id) };
  });
  expect(mid.saved).toEqual([{ symbol: "BETA", mode: "scale" }]); // still part of the saved chart
  expect(mid.series.some((id: string) => id.startsWith("compare:"))).toBe(false); // but not drawn on a Renko chart
  await page.evaluate(() => (window as Any).__app.instances[0].setChartType("candles"));
  await page.waitForFunction(() => (window as Any).__app.instances[0].compareList().length === 1);
  await ready(page);
  expect(await page.evaluate(() => (window as Any).__app.instances[0].chart.series().some((s: Any) => s.options().id === "compare:BETA"))).toBe(true);
  expect(await reported(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a saved Renko chart with compares restores without losing them", async ({ page }) => {
  const errors = await open(page);
  const saved = await page.evaluate(async () => {
    const inst = (window as Any).__app.instances[0];
    await inst.addCompare("BETA", "same");
    const s = JSON.parse(JSON.stringify(inst.toJSON()));
    s.chartType = "renko";
    inst.fromJSON(s);
    return s;
  });
  await ready(page);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => (window as Any).__app.instances[0].toJSON().compares);
  expect(after).toEqual(saved.compares);
  expect(errors).toEqual([]);
});

test("the alert log writes its times in the zone the chart shows, and prices as the firing chart writes them", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const app = (window as Any).__app;
    app.setTimeZone("America/New_York"); // not the zone the app was started with
    app.instances[0].addAlert({ type: "greaterThan", price: 0 }, { mode: "once" });
    (window as Any).__feed.replay("ALPHA", [2500.5]);
  });
  await page.getByTestId("alerts-button").click();
  const shown = await page.getByTestId("alert-log").locator('[data-slot="item-description"]').first().textContent();
  const expected = await page.evaluate(() => {
    const app = (window as Any).__app;
    return app.i18n.dateTime(app.alertLog[0].time, { date: "medium", time: "seconds", timeZone: "America/New_York" });
  });
  expect(shown).toBe(expected);
  expect(await page.evaluate(() => (window as Any).__app.alertLog[0].priceText)).toBe("2500.50");
  expect(errors).toEqual([]);
});

const drawingCounts = (page: Page) => page.evaluate(() => (window as Any).__app.instances.map((i: Any) => i.drawingList().length));
const horizontal = { tool: "horizontalLine", anchors: [{ time: 0, price: 2500 }] };

test("restoring a layout does not copy drawings between synced charts", async ({ page }) => {
  const errors = await open(page, "layout=2h");
  await page.waitForFunction(() => (window as Any).__app.instances.length === 2 && (window as Any).__app.instances.every((i: Any) => i.status === "ready"));
  // Two drawings on chart 0, one on chart 1, saved while the charts are not synced.
  await page.evaluate((h) => {
    const app = (window as Any).__app;
    const at = (i: number, n: number) => ({ ...h, anchors: [{ time: app.instances[i].raw.at(n).time, price: 2500 + n }] });
    app.instances[0].drawings.add(at(0, 10));
    app.instances[0].drawings.add(at(0, 20));
    app.instances[1].drawings.add(at(1, 30));
  }, horizontal);
  expect(await drawingCounts(page)).toEqual([2, 1]);
  await page.evaluate(() => {
    const app = (window as Any).__app;
    const body = JSON.parse(JSON.stringify(app.layoutBody()));
    body.sync.drawings = true; // the layout is loaded with drawing sync on, and chart 1 active (as the saved layout says)
    body.active = 1;
    app.setActive(1);
    app.applyLayout(body);
  });
  await page.waitForFunction(() => (window as Any).__app.instances.every((i: Any) => i.status === "ready"));
  await page.waitForTimeout(200);
  expect(await drawingCounts(page)).toEqual([2, 1]); // a loaded layout is what was saved, not what the sync would have mirrored
  expect(await reported(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("drawing sync and keep-drawing still work after the chart has been through an event-based type", async ({ page }) => {
  const errors = await open(page, "layout=2h");
  await page.waitForFunction(() => (window as Any).__app.instances.length === 2 && (window as Any).__app.instances.every((i: Any) => i.status === "ready"));
  await page.evaluate(() => {
    const app = (window as Any).__app;
    app.setSync("drawings", true);
    app.setActive(1);
    app.instances[1].setChartType("renko");
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => (window as Any).__app.instances[1].setChartType("candles"));
  await page.waitForFunction(() => (window as Any).__app.instances[1].drawings !== null && (window as Any).__app.instances[1].status === "ready");
  await page.evaluate((h) => {
    const inst = (window as Any).__app.instances[1];
    inst.drawings.add({ ...h, anchors: [{ time: inst.raw.at(10).time, price: 2500 }] });
  }, horizontal);
  expect(await drawingCounts(page)).toEqual([1, 1]); // the app still hears the new plugin
  expect(await reported(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("footprint bars start where the feed's bars start, for an exchange whose bars are not on the UTC grid", async ({ page }) => {
  // ?anchor=15: every bar grid is shifted by 15 minutes, as NSE's 09:15 open shifts half-hour bars to :15 and :45.
  const errors = await open(page, "trades=1&anchor=15&interval=30m");
  await page.evaluate(() => (window as Any).__app.instances[0].setChartType("footprint"));
  await page.waitForFunction(() => {
    const f = (window as Any).__app.instances[0].flow;
    return f && f.bars.length > 2;
  }, undefined, { timeout: 15_000 });
  const r = await page.evaluate(() => {
    const inst = (window as Any).__app.instances[0];
    const times = new Set<number>();
    for (let i = 0; i < inst.raw.length; i++) times.add(inst.raw.at(i).time);
    const b = inst.flow.bars;
    const starts: number[] = [];
    for (let i = 0; i < b.length; i++) starts.push(b.start[i]);
    return { off: starts.filter((s) => !times.has(s)).length, total: starts.length };
  });
  expect(r.total).toBeGreaterThan(2);
  expect(r.off).toBe(0);
  expect(await reported(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a price the older bars carry with more decimals is not shown rounded, and the footprint is refused without a tick size", async ({ page }) => {
  const errors = await open(page, "trades=1&ticksize=none");
  const r = await page.evaluate(async () => {
    const app = (window as Any).__app;
    const real = app.feed.getBars.bind(app.feed);
    // The first (oldest) bar of the page has a four-decimal high; the recent bars have two.
    app.feed.getBars = async (req: Any, signal: AbortSignal) => {
      const r = await real(req, signal);
      r.bars.high[0] = Math.max(r.bars.high[0], r.bars.open[0], r.bars.close[0]) + 0.1234;
      (window as Any).__old = r.bars.high[0];
      return r;
    };
    app.instances[0].retry();
    await new Promise((res) => setTimeout(res, 600));
    const inst = app.instances[0];
    let footprint = "";
    try { inst.setChartType("footprint"); } catch (e) { footprint = String(e); }
    return { shown: inst.main.formatPrice((window as Any).__old), old: (window as Any).__old, footprint, type: inst.chartType };
  });
  expect(Number(r.shown.replace(/,/g, ""))).toBeCloseTo(r.old, 4); // not rounded to 2 decimals
  expect(r.footprint).toMatch(/tick size/);
  expect(r.type).toBe("candles");
  expect(errors).toEqual([]);
});

test("a separate-pane study with small values is not shown at two decimals", async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(async () => {
    const app = (window as Any).__app;
    await app.ensureStudies();
    const base = app.studyDef("rsi");
    const tiny = { ...base, id: "rsi-tiny", build: (g: Any, p: Any) => base.build(g, p).map((c: Any) => g.map(c, (v: number) => v * 1e-5)) };
    const s = app.instances[0].addStudy(tiny);
    await s.ready();
    return s.series()[0].formatPrice(0.0004567);
  });
  expect(r).toBe("0.000457"); // 3 significant digits of a value around 5e-4
  expect(errors).toEqual([]);
});

const AUTOSAVE = "ac-ui-dev:ui/autosave";
const seed = (page: Page, autosave: unknown) =>
  page.addInitScript(([k, v]) => {
    if (sessionStorage.getItem("seeded")) return; // only the first load of the test
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("ac-ui-dev:ui/autosave-on", "true");
    localStorage.setItem(k as string, v as string);
  }, [AUTOSAVE, JSON.stringify(autosave)]);
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), AUTOSAVE);

test("an autosave that cannot be restored is not overwritten until the user changes something", async ({ page }) => {
  const broken = { version: 1, savedAt: 1, body: { grid: "no-such-grid", active: 0, sync: {}, theme: "dark", customTheme: null, charts: [{ symbol: "ALPHA", interval: "5m" }] } };
  await seed(page, broken);
  const errors = await open(page, "storage=local");
  await page.waitForTimeout(1800); // longer than the autosave debounce
  expect(await stored(page)).toEqual(broken); // the saved workspace is still there to be fixed or recovered
  expect(await page.evaluate(() => (window as Any).__app.toasts.map((t: Any) => t.text).join("|"))).toMatch(/grid/i); // and the failure was reported
  void errors;
  await page.evaluate(() => (window as Any).__app.setTheme("light"));
  await expect.poll(() => stored(page).then((s: Any) => s.body?.theme)).toBe("light"); // the user's own change resumes saving
});

test("the autosave is a versioned envelope, like a named layout", async ({ page }) => {
  await open(page, "storage=local&autosave=1");
  await page.evaluate(() => (window as Any).__app.setAutosave(true));
  const s = await stored(page);
  expect(s.version).toBe(1);
  expect(typeof s.savedAt).toBe("number");
  expect(s.body.charts.length).toBe(1);
});

test("a script running on a chart that becomes event-based is reported in the script panel", async ({ page }) => {
  const errors = await open(page, "script=1");
  await page.evaluate(() => (window as Any).__app.runScript('indicator("probe")\nplot(ta.sma(close, 20))'));
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as Any).__app.instances[0].setChartType("renko"));
  await expect.poll(() => page.evaluate(() => (window as Any).__app.scriptDiagnostics.map((d: Any) => d.severity + ":" + d.message))).toEqual([expect.stringMatching(/^warning:.*event-based/)]);
  expect(errors).toEqual([]);
});

test("Retry does not fire a once-per-bar alert a second time on the bar it fired on", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    (window as Any).__app.instances[0].addAlert({ type: "greaterThan", price: 0 }, { mode: "oncePerBar" });
    (window as Any).__feed.replay("ALPHA", [2500.5]);
  });
  expect(await page.evaluate(() => (window as Any).__app.alertLog.length)).toBe(1);
  await page.evaluate(() => (window as Any).__app.instances[0].retry());
  await ready(page);
  await page.evaluate(() => (window as Any).__feed.replay("ALPHA", [2500.6]));
  expect(await page.evaluate(() => (window as Any).__app.alertLog.length)).toBe(1);
});

test("a removed study's id is not given to a new study after a reload, so its alert cannot land on another indicator", async ({ page }) => {
  await open(page, "storage=local");
  const removed = await page.evaluate(async () => {
    const app = (window as Any).__app;
    const inst = app.instances[0];
    await app.ensureStudies();
    inst.addStudy(app.studyDef("sma"));
    const b = inst.addStudy(app.studyDef("rsi"));
    inst.removeStudy(b.id);
    await app.setAutosave(true);
    return b.id as string;
  });
  await page.goto("/?ex=ui&storage=local");
  await page.waitForFunction(() => (window as Any).__uiReady === true);
  await page.waitForFunction(() => (window as Any).__app.instances[0].studies().length === 1);
  const next = await page.evaluate(async () => {
    const app = (window as Any).__app;
    await app.ensureStudies();
    return app.instances[0].addStudy(app.studyDef("rsi")).id as string;
  });
  expect(next).not.toBe(removed);
});

test("what is drawn after a failed restore is autosaved, and the unreadable save is kept aside", async ({ page }) => {
  const broken = { version: 1, savedAt: 1, body: { grid: "no-such-grid", active: 0, sync: {}, theme: "dark", customTheme: null, charts: [{ symbol: "ALPHA", interval: "5m" }] } };
  await seed(page, broken);
  await open(page, "storage=local");
  await page.evaluate(() => {
    const inst = (window as Any).__app.instances[0];
    inst.drawings.add({ tool: "horizontalLine", anchors: [{ time: inst.raw.at(10).time, price: 2500 }] });
  });
  await expect.poll(() => stored(page).then((s: Any) => s.body?.charts?.[0]?.drawings?.ALPHA?.drawings?.length)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ac-ui-dev:ui/autosave-rejected")!).payload)).toEqual(broken);
});
