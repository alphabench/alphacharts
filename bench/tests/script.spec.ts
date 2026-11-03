// The script language in a real browser: typing a script draws its plot, errors
// show inline, a hostile script is terminated without freezing the page, and
// live ticks reach the script's plot (computed in the sandbox worker).

import { expect, test, type Page } from "@playwright/test";

interface ScriptApi {
  setSource(t: string): void;
  source(): string;
  handle(): { study: { ready(): Promise<void>; times(): Float64Array }; compiled: { source: string }; toJSON(): { source: string } } | null;
  diagnostics(): { message: string }[];
  runtimeError(): { message: string } | null;
  tick(k: number): void;
  column(key: string): number[];
  closes(): number[];
  setBatchMs(ms: number): void;
  extraScripts(): Promise<number[]>;
}
declare global {
  interface Window {
    __script: ScriptApi;
    __maxGap: number;
  }
}

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?ex=script${query.includes("n=") ? "" : "&n=2000"}${query}`);
  await page.waitForFunction(() => window.__ready === true);
  await ready(page);
  return errors;
}

/** The running script is the one for the current source and its computation is on the chart. */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const h = window.__script.handle();
    return !!h && h.compiled.source === window.__script.source();
  });
  await page.evaluate(() => window.__script.handle()!.study.ready());
}

const chartPane = (page: Page) => page.locator("#app > div").nth(1);

const TYPED = `indicator("Typed", overlay=true)
len = input.int(10, "Length")
plot(ta.sma(close, len), "SMA", color.orange, 2)
`;

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: dpr });

    test("typing a script draws its plot", async ({ page }) => {
      const errors = await open(page, "&script=plot(close)");
      await page.locator("#script-editor .cm-content").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      // typed through the editor, one key at a time; the editor must not auto-indent or auto-close into something else
      await page.keyboard.insertText(TYPED);
      await page.waitForFunction((t) => window.__script.source() === t, TYPED);
      await ready(page);
      expect(await page.evaluate(() => window.__script.diagnostics())).toEqual([]);
      // the plot is the 10-bar mean of the closes the chart holds
      const { sma, closes } = await page.evaluate(() => ({ sma: window.__script.column("sma"), closes: window.__script.closes() }));
      const n = closes.length;
      expect(sma.length).toBe(n);
      expect(sma[8]).toBeNaN();
      const mean = closes.slice(n - 10).reduce((a, b) => a + b, 0) / 10;
      expect(Math.abs(sma[n - 1]! - mean)).toBeLessThan(1e-9);
      await page.mouse.move(5, 5);
      await expect(chartPane(page)).toHaveScreenshot(`script-typed-dpr${dpr}.png`, { maxDiffPixels: 0 });
      expect(await page.evaluate(() => window.__script.handle()!.toJSON().source)).toBe(TYPED);
      expect(errors).toEqual([]);
    });
  });
}

test.describe("behaviour", () => {
  test.use({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });

  test("an error shows inline with line and column, and the last good plot stays", async ({ page }) => {
    const errors = await open(page);
    const before = await page.evaluate(() => window.__script.column("slow").length);
    await page.locator("#script-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("x = 1\nplot(clos)\nplot(ta.sma(close, 0))\n");
    await expect(page.locator("#script-editor .cm-lintRange-error").first()).toBeVisible();
    const list = await page.locator("#script-diagnostics li").allTextContents();
    expect(list).toEqual(['2:6 unknown name "clos"', '3:20 argument "length" of ta.sma must be between 1 and 5000, got 0']);
    // the old script still runs
    expect(await page.evaluate(() => window.__script.column("slow").length)).toBe(before);
    // fixing it removes the markers
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("plot(close)\n");
    await page.waitForFunction(() => window.__script.source() === "plot(close)\n");
    await ready(page);
    await expect(page.locator("#script-editor .cm-lintRange-error")).toHaveCount(0);
    expect(await page.evaluate(() => window.__script.diagnostics())).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("autocomplete offers ta.* and the inputs of the script", async ({ page }) => {
    await open(page);
    await page.locator("#script-editor .cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("mylen = input.int(5)\nplot(ta.sm");
    await expect(page.locator(".cm-tooltip-autocomplete li", { hasText: "ta.sma" }).first()).toBeVisible();
  });

  const MONITOR = () => {
    window.__maxGap = 0;
    let last = performance.now();
    const loop = (t: number) => { window.__maxGap = Math.max(window.__maxGap, t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };

  test("a hostile script is stopped by the step budget, the page keeps painting, the next script runs", async ({ page }) => {
    const errors = await open(page);
    await page.evaluate(MONITOR);
    await page.evaluate(() => window.__script.setSource("float a = 0.0\nfor i = 1 to 9999\n    for j = 1 to 9999\n        a += 1\nplot(a)\n"));
    await page.waitForFunction(() => window.__script.runtimeError() !== null, null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.__script.runtimeError()))!.message).toMatch(/execution budget exceeded/);
    expect(await page.evaluate(() => window.__maxGap)).toBeLessThan(300);
    await page.evaluate(() => window.__script.setSource("plot(ta.sma(close, 5), \"ok\")"));
    await ready(page);
    expect(await page.evaluate(() => window.__script.runtimeError())).toBeNull();
    expect(await page.evaluate(() => window.__script.column("ok").length)).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });

  test("a worker that overruns its time budget is terminated and replaced", async ({ page }) => {
    // 300k bars and a 5000-bar window: about a second of kernel work, with a 300 ms budget
    const errors = await open(page, "&n=300000");
    await page.evaluate(() => window.__script.setBatchMs(300));
    await page.evaluate(MONITOR);
    await page.evaluate(() => window.__script.setSource("plot(ta.highest(close, 5000) - ta.lowest(close, 5000), \"range\")"));
    await page.waitForFunction(() => window.__script.runtimeError() !== null, null, { timeout: 30_000 });
    expect((await page.evaluate(() => window.__script.runtimeError()))!.message).toMatch(/did not finish within 300 ms and was terminated/);
    expect(await page.evaluate(() => window.__maxGap)).toBeLessThan(300);
    // a fresh worker serves the next script
    await page.evaluate(() => window.__script.setBatchMs(20_000));
    await page.evaluate(() => window.__script.setSource("plot(ta.sma(close, 3), \"ok\")"));
    await ready(page);
    expect(await page.evaluate(() => window.__script.runtimeError())).toBeNull();
    expect(await page.evaluate(() => window.__script.column("ok").length)).toBe(300_000);
    expect(errors).toEqual([]);
  });

  test("several scripts, each with its own runner, all compute", async ({ page }) => {
    const errors = await open(page);
    const [a, b] = await page.evaluate(() => window.__script.extraScripts());
    expect(a).toBeGreaterThan(1000);
    expect(b).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });

  test("live ticks update the script plot", async ({ page }) => {
    const errors = await open(page);
    const before = await page.evaluate(() => window.__script.handle()!.study.times().length);
    // 100 ticks = 2 new bars and many revisions of each
    await page.evaluate(() => window.__script.tick(100));
    await page.waitForFunction(([b]) => {
      const closes = window.__script.closes();
      const col = window.__script.column("slow");
      if (col.length !== closes.length || col.length !== b! + 2) return false;
      const mean = closes.slice(-20).reduce((a, x) => a + x, 0) / 20;
      return Math.abs(col[col.length - 1]! - mean) < 1e-9;
    }, [before]);
    // every bar equals a recomputation by the same script
    const worst = await page.evaluate(() => {
      const closes = window.__script.closes(), col = window.__script.column("slow");
      let w = 0;
      for (let i = 19; i < closes.length; i++) w = Math.max(w, Math.abs(col[i]! - closes.slice(i - 19, i + 1).reduce((a, x) => a + x, 0) / 20));
      return w;
    });
    expect(worst).toBeLessThan(1e-9);
    // the marker series (plotshape) follows too
    await page.evaluate(() => window.__script.tick(50));
    await page.waitForFunction(() => window.__script.column("up").length === window.__script.closes().length);
    expect(errors).toEqual([]);
  });
});

// H9: the studies plugin saves only studies it can rebuild; a script persists through restoreScript.
test("a layout saved with a script on the chart restores, and the script's study is not in the studies state", async ({ page }) => {
  const errors = await open(page, "&script=plot(close)");
  const r = await page.evaluate(() => {
    const c = window.__charts[0]!;
    const saved = JSON.parse(JSON.stringify(c.saveState())) as { plugins: Record<string, { studies: { id: string }[] }> };
    const inState = saved.plugins["alphacharts.studies"]!.studies.map((s) => s.id);
    let err = "";
    try { c.restoreState(saved); } catch (e) { err = String(e); }
    return { inState, err, bare: c.series().map((s) => s.options().id).filter((id) => id.startsWith("study:")) };
  });
  expect(r.inState).toEqual([]);
  expect(r.err).toBe("");
  expect(r.bare).toEqual([]); // no empty husk of the script's plot is left behind
  expect(errors).toEqual([]);
});
