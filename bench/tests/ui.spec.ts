// The chart application (?ex=ui) in a real browser. Snapshots (zero tolerance): dark, light, high contrast,
// a phone, Hindi and right-to-left. Flows use the real mouse and keyboard. Axe scans each theme.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

type Win = {
  __app: {
    instances: Array<{
      symbol: string; interval: string; chartType: string; chart: { element: HTMLElement };
      raw: { length: number; at(i: number): { close: number; time: number } };
      drawings: { list(): Array<{ id: string; tool: string; style: { width: number; color: string }; anchors: Array<{ time: number; price: number }> }>; pixelOf(p: number, a: { time: number; price: number }): { x: number; y: number }; undo(): boolean; get(id: string): { style: { width: number } } };
      studies(): Array<{ study: { id: string; def: { id: string }; inputs(): Record<string, unknown> } }>;
      alertList(): Array<{ status: string }>;
    }>;
    gridId: string;
    alertLog: unknown[];
    setLayout(id: string): void;
    sync: Record<string, boolean>;
    themeName: string;
  };
  __feed: { replay(s: string, p: number[]): void };
};

async function open(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?ex=ui&${query}`);
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, 2);
  return errors;
}

const app = (page: Page) => page.locator("#app");
const legendSymbol = (page: Page) => page.getByTestId("legend-symbol").first();
const settle = (page: Page) => page.waitForTimeout(350);

// ---- pictures ------------------------------------------------------------------------------------------

for (const theme of ["dark", "light", "high-contrast"]) {
  test(`snapshot: ${theme}`, async ({ page }) => {
    const errors = await open(page, `theme=${theme}`);
    await settle(page);
    await expect(app(page)).toHaveScreenshot(`ui-${theme}.png`, { maxDiffPixels: 0 });
    expect(errors).toEqual([]);
  });
}

test("snapshot: the studies legend and an open menu (dark)", async ({ page }) => {
  await open(page);
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-search").fill("rsi");
  await page.getByTestId("indicator-add-rsi").click();
  await expect(page.getByTestId("indicator-results")).toBeVisible();
  await expect(app(page)).toHaveScreenshot("ui-indicators-dialog.png", { maxDiffPixels: 0 });
  await page.keyboard.press("Escape");
  await page.getByTestId("charttype-button").click();
  await settle(page);
  await expect(app(page)).toHaveScreenshot("ui-charttype-menu.png", { maxDiffPixels: 0 });
});

test("snapshot: four charts (light)", async ({ page }) => {
  await open(page, "theme=light&layout=4");
  // Every cell must have its bars before the picture is taken; a fixed pause alone is a race under load.
  await page.waitForFunction(() => { const a = (window as unknown as { __app: { instances: Array<{ status: string }> } }).__app; return a.instances.length === 4 && a.instances.every((i) => i.status === "ready"); });
  await settle(page);
  await expect(app(page)).toHaveScreenshot("ui-layout-4.png", { maxDiffPixels: 0 });
});

test("repainting one chart of a grid leaves the others drawn", async ({ page }) => {
  await open(page, "theme=light&layout=4");
  await page.waitForFunction(() => { const a = (window as unknown as Win).__app; return a.instances.length === 4 && a.instances.every((i) => (i as unknown as { status: string }).status === "ready"); });
  await settle(page);
  const before = await app(page).screenshot();
  // The dashboard's series layer is one WebGL canvas that is not preserved between frames.
  await page.evaluate(() => (window as unknown as { __app: { instances: Array<{ chart: { invalidate(l: number): void } }> } }).__app.instances[1]!.chart.invalidate(7));
  await settle(page);
  expect((await app(page).screenshot()).equals(before)).toBe(true);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("snapshot and bottom sheets", async ({ page }) => {
    await open(page);
    await settle(page);
    await expect(app(page)).toHaveScreenshot("ui-mobile.png", { maxDiffPixels: 0 });
    await expect(page.getByTestId("bottombar")).toBeVisible();
    // Touch targets are at least 44 px.
    const small = await page.evaluate(() => {
      const host = document.querySelector("alpha-chart-app")!.shadowRoot!;
      return [...host.querySelectorAll<HTMLElement>(".bottombar button, .toolbar button")].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 43.5 || b.getBoundingClientRect().width < 43.5)).map((b) => b.getAttribute("aria-label"));
    });
    expect(small).toEqual([]);
    await page.getByTestId("drawings-sheet-button").tap();
    const sheet = page.getByTestId("drawing-sheet");
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(800); // anchored to the bottom
    await settle(page);
    await expect(app(page)).toHaveScreenshot("ui-mobile-sheet.png", { maxDiffPixels: 0 });
  });
});

test("snapshot: Hindi", async ({ page }) => {
  await open(page, "locale=hi");
  await expect(page.locator("alpha-chart-app")).toHaveAttribute("lang", "hi");
  await settle(page);
  await expect(app(page)).toHaveScreenshot("ui-hi.png", { maxDiffPixels: 0 });
});

test("snapshot: right-to-left", async ({ page }) => {
  await open(page, "dir=rtl");
  await expect(page.locator("alpha-chart-app")).toHaveAttribute("dir", "rtl");
  await settle(page);
  await expect(app(page)).toHaveScreenshot("ui-rtl.png", { maxDiffPixels: 0 });
  // The chart itself stays left-to-right.
  expect(await page.evaluate(() => (document.querySelector("alpha-chart-app")!.shadowRoot!.querySelector(".cell") as HTMLElement).getAttribute("dir"))).toBe("ltr");
});

// ---- flows --------------------------------------------------------------------------------------------------

test("search and switch symbol with the keyboard", async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId("symbol-button").click();
  const input = page.getByTestId("symbol-input");
  await expect(input).toBeFocused();
  await input.fill("gam");
  await expect(page.getByTestId("symbol-option-GAMMA")).toBeVisible();
  await input.fill("a");
  await expect(page.getByTestId("symbol-option-BETA")).toBeVisible();
  await input.fill("");
  await input.fill("e");
  await page.getByTestId("symbol-option-BETA").waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("symbol-dialog")).toHaveCount(0);
  const chosen = await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.symbol);
  expect(["BETA", "DELTA", "EPSILON", "GAMMA", "ALPHA"]).toContain(chosen);
  expect(chosen).not.toBe("ALPHA");
  await expect(legendSymbol(page)).toContainText(chosen);
  // Recent symbols are offered next time, before any search.
  await page.getByTestId("symbol-button").click();
  await expect(page.getByTestId(`symbol-option-${chosen}`)).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("change interval, including a custom one", async ({ page }) => {
  await open(page);
  await page.getByTestId("interval-15m").click();
  await expect(legendSymbol(page)).toContainText("15m");
  await page.getByTestId("interval-button").click();
  await page.getByTestId("custom-interval-value").fill("75");
  await page.getByTestId("custom-interval-unit").selectOption("m");
  await page.getByTestId("custom-interval-add").click();
  await expect(legendSymbol(page)).toContainText("75m");
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.interval)).toBe("75m");
  // Invalid input is refused with a message and nothing changes.
  await page.getByTestId("interval-button").click();
  await page.getByTestId("custom-interval-value").fill("0");
  await page.getByTestId("custom-interval-add").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.interval)).toBe("75m");
  // 3h and 2D are accepted too.
  for (const [v, u, want] of [["3", "h", "3h"], ["2", "D", "2D"]]) {
    await page.getByTestId("interval-button").click();
    await page.getByTestId("custom-interval-value").fill(v!);
    await page.getByTestId("custom-interval-unit").selectOption(u!);
    await page.getByTestId("custom-interval-add").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances[0]!.interval)).toBe(want);
  }
});

test("add, edit and remove a study", async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-search").fill("moving average");
  await expect(page.getByTestId("indicator-results").locator("li").first()).toBeVisible();
  await page.getByTestId("indicator-search").fill("rsi");
  await page.getByTestId("indicator-add-rsi").click();
  await expect(page.getByTestId("active-studies").locator("li")).toHaveCount(1);
  await page.keyboard.press("Escape");
  const legend = page.locator("[data-testid^=legend-study-]");
  await expect(legend).toContainText("14");
  await legend.hover();
  await legend.getByRole("button", { name: /settings/i }).click();
  const len = page.getByLabel("Length");
  await len.fill("21");
  await page.getByTestId("study-apply").click();
  await expect(legend).toContainText("21");
  await page.keyboard.press("Escape");
  await legend.hover();
  await legend.getByRole("button", { name: /remove/i }).click();
  await expect(legend).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.studies().length)).toBe(0);
  expect(errors).toEqual([]);
});

test("a layout being restored still saves its studies and compares", async ({ page }) => {
  const errors = await open(page);
  const r = await page.evaluate(() => {
    type I = { toJSON(): { studies: unknown[]; compares: unknown[] }; fromJSON(s: unknown): void };
    const i = (window as unknown as { __app: { instances: I[] } }).__app.instances[0]!;
    const saved = i.toJSON();
    saved.studies = [{ id: "sma", inputs: { length: 20 } }];
    saved.compares = [{ symbol: "BETA", mode: "percent" }];
    i.fromJSON(saved);
    const during = i.toJSON(); // the restore is still waiting for bars
    return { studies: during.studies.length, compares: during.compares.length };
  });
  expect(r).toEqual({ studies: 1, compares: 1 });
  expect(errors).toEqual([]);
});

test("draw a trend line from the toolbar and edit it in its dialog", async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId("group-lines").click();
  const box = (await page.locator("alpha-chart-app .cell").first().boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 8 });
  await page.mouse.move(box.x + 600, box.y + 150, { steps: 8 });
  await page.mouse.up();
  const made = await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.drawings.list().map((d) => d.tool));
  expect(made).toEqual(["trendLine"]);
  // Right-click on the line: the drawing menu, then its settings dialog.
  const mid = await page.evaluate(() => {
    const i = (window as unknown as Win).__app.instances[0]!;
    const d = i.drawings.list()[0]!;
    const a = i.drawings.pixelOf(0, d.anchors[0]!), b = i.drawings.pixelOf(0, d.anchors[1]!);
    const r = i.chart.element.getBoundingClientRect();
    return { x: r.left + (a.x + b.x) / 2, y: r.top + (a.y + b.y) / 2 };
  });
  await page.mouse.click(mid.x, mid.y, { button: "right" });
  await page.getByTestId("menu-settings").click();
  await expect(page.getByTestId("drawing-dialog")).toBeVisible();
  await page.getByTestId("drawing-width").fill("4");
  await page.getByTestId("drawing-dash").selectOption("dashed");
  await page.getByTestId("drawing-color").fill("#ff8800");
  const st = await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.drawings.list()[0]!.style);
  expect(st.width).toBe(4);
  expect(st.color.toLowerCase()).toBe("#ff8800");
  await page.keyboard.press("Escape");
  // Undo from the toolbar removes the last style edit, not the line.
  await page.getByTestId("undo-button").click();
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.drawings.list().length)).toBe(1);
  // Delete through the menu.
  await page.mouse.click(mid.x, mid.y, { button: "right" });
  await page.getByTestId("menu-delete").click();
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.drawings.list().length)).toBe(0);
  expect(errors).toEqual([]);
});

test("remove all drawings asks first", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const i = (window as unknown as Win).__app.instances[0] as unknown as { drawings: { add(d: unknown): void }; raw: { at(i: number): { time: number; close: number }; length: number } };
    const b = i.raw.at(i.raw.length - 5);
    i.drawings.add({ tool: "horizontalLine", anchors: [{ time: b.time, price: b.close }] });
  });
  await page.getByTestId("removeall-button").click();
  await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("confirm-dialog")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.drawings.list().length)).toBe(1);
  await page.getByTestId("removeall-button").click();
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances[0]!.drawings.list().length)).toBe(0);
});

test("create an alert from the context menu and see it fire on replayed ticks", async ({ page }) => {
  const errors = await open(page);
  const last = await page.evaluate(() => { const i = (window as unknown as Win).__app.instances[0]!; return i.raw.at(i.raw.length - 1).close; });
  const box = (await page.locator("alpha-chart-app .cell").first().boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 250, { button: "right" });
  await page.getByTestId("menu-alert").click();
  await expect(page.getByTestId("alert-dialog")).toBeVisible();
  const level = Math.round((last + 3) * 100) / 100;
  await page.getByTestId("alert-value").fill(String(level));
  await page.getByTestId("alert-op").selectOption("crossingUp");
  await page.getByTestId("alert-label").fill("breakout");
  await page.getByTestId("alert-create").click();
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.alertList().map((a) => a.status))).toEqual(["active"]);
  await page.evaluate(([a, b, c]) => (window as unknown as Win).__feed.replay("ALPHA", [a!, b!, c!]), [last + 1, last + 2, level + 1]);
  await expect(page.getByTestId("toasts")).toContainText("breakout");
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.alertList().map((a) => a.status))).toEqual(["triggered"]);
  await page.getByTestId("alerts-button").click();
  await expect(page.getByTestId("alert-log").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("alert-status")).toHaveText("Triggered");
  expect(errors).toEqual([]);
});

test("alerts on a symbol that is not shown are reported as not watched", async ({ page }) => {
  const errors = await open(page);
  const last = await page.evaluate(() => { const i = (window as unknown as Win).__app.instances[0]!; return i.raw.at(i.raw.length - 1).close; });
  await page.evaluate((l) => (window as unknown as Win).__app.instances[0]!.addAlert({ type: "crossing", price: l + 50, direction: "any" }, { mode: "once" }), last);
  await page.getByTestId("alerts-button").click();
  await expect(page.getByTestId("alerts-paused")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("symbol-button").click();
  await page.getByTestId("symbol-input").fill("gam");
  await page.getByTestId("symbol-option-GAMMA").click();
  await page.getByTestId("alerts-button").click();
  await expect(page.getByTestId("alerts-paused")).toContainText("1 active alert");
  expect(errors).toEqual([]);
});

test("an alert on a drawn horizontal line fires when replayed ticks cross it", async ({ page }) => {
  const errors = await open(page);
  const level = await page.evaluate(() => {
    const i = (window as unknown as Win).__app.instances[0] as unknown as { drawings: { add(d: unknown): void }; raw: { at(i: number): { time: number; close: number }; length: number } };
    const b = i.raw.at(i.raw.length - 5);
    i.drawings.add({ tool: "horizontalLine", anchors: [{ time: b.time, price: b.close }] });
    return b.close;
  });
  await page.getByTestId("alerts-button").click();
  await page.getByTestId("alerts-new").click();
  await expect(page.getByTestId("alert-dialog")).toBeVisible();
  await page.getByTestId("alert-kind").selectOption("drawing");
  await page.getByTestId("alert-op").selectOption("crossing");
  await page.getByTestId("alert-label").fill("line touched");
  await page.getByTestId("alert-create").click();
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.alertList().map((a) => a.status))).toEqual(["active"]);
  await page.evaluate((p) => (window as unknown as Win).__feed.replay("ALPHA", [p - 1, p + 1]), level);
  await expect(page.getByTestId("toasts")).toContainText("line touched");
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.alertList().map((a) => a.status))).toEqual(["triggered"]);
  expect(errors).toEqual([]);
});

test("switch to four charts and sync the symbol", async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId("layout-button").click();
  await page.getByTestId("menu-grid-4").click();
  await expect(page.locator("alpha-chart-app .cell")).toHaveCount(4);
  await page.getByTestId("layout-button").click();
  await page.getByTestId("menu-sync-symbol").click();
  await page.waitForFunction(() => (window as unknown as Win).__app.sync.symbol === true);
  // Focus the third chart, then change its symbol: all four follow.
  await page.locator("alpha-chart-app .cell").nth(2).click({ position: { x: 100, y: 100 } });
  await page.getByTestId("symbol-button").click();
  await page.getByTestId("symbol-input").fill("gam");
  await page.getByTestId("symbol-option-GAMMA").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances.map((i) => i.symbol))).toEqual(["GAMMA", "GAMMA", "GAMMA", "GAMMA"]);
  // Without the sync, an interval change stays on its chart.
  await page.getByTestId("interval-1h").click();
  const iv = await page.evaluate(() => (window as unknown as Win).__app.instances.map((i) => i.interval));
  expect(iv.filter((x) => x === "1h")).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("drawings follow the other charts of the same symbol when drawing sync is on", async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId("layout-button").click();
  await page.getByTestId("menu-grid-4").click();
  await expect(page.locator("alpha-chart-app .cell")).toHaveCount(4);
  await page.waitForFunction(() => { const a = (window as unknown as Win).__app; return a.instances.length === 4 && a.instances.every((x) => x.raw.length > 0); });
  const counts = () => page.evaluate(() => (window as unknown as Win).__app.instances.map((i) => i.drawings.list().length));
  const draw = (n = 0) => page.evaluate((n) => {
    const i = (window as unknown as Win).__app.instances[n] as unknown as { drawings: { add(d: unknown): void }; raw: { at(i: number): { time: number; close: number }; length: number } };
    const b = i.raw.at(i.raw.length - 5);
    i.drawings.add({ tool: "horizontalLine", anchors: [{ time: b.time, price: b.close }] });
  }, n);
  // Off: the drawing stays on its own chart.
  await draw();
  expect(await counts()).toEqual([1, 0, 0, 0]);
  await draw(1); // chart 1's own drawing shares the id "d1" with chart 0's
  await page.getByTestId("layout-button").click();
  await page.getByTestId("menu-sync-drawings").click();
  await page.waitForFunction(() => (window as unknown as Win).__app.sync.drawings === true);
  await draw();
  await expect.poll(counts).toEqual([2, 2, 1, 1]);
  // Removing the synced one from the active chart removes it everywhere it was copied.
  await page.evaluate(() => {
    const d = (window as unknown as Win).__app.instances[0]!.drawings as unknown as { list(): Array<{ id: string }>; remove(ids: string[]): void };
    d.remove([d.list()[1]!.id]);
  });
  await expect.poll(counts).toEqual([1, 1, 0, 0]);
  // Removing a drawing the sync never copied must not touch the other chart's drawing with the same id.
  await page.evaluate(() => {
    const d = (window as unknown as Win).__app.instances[0]!.drawings as unknown as { list(): Array<{ id: string }>; remove(ids: string[]): void };
    d.remove([d.list()[0]!.id]);
  });
  await expect.poll(counts).toEqual([0, 1, 0, 0]);
  expect(errors).toEqual([]);
});

test("save a layout, reload, open it again", async ({ page }) => {
  const errors = await open(page, "storage=local");
  await page.getByTestId("symbol-button").click();
  await page.getByTestId("symbol-input").fill("gam");
  await page.getByTestId("symbol-option-GAMMA").click();
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-search").fill("rsi");
  await page.getByTestId("indicator-add-rsi").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("layout-button").click();
  await page.getByTestId("menu-saveas").click();
  await page.getByTestId("prompt-input").fill("my layout");
  await page.getByTestId("prompt-ok").click();
  await expect(page.getByTestId("toasts")).toContainText("my layout");
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  expect(await page.evaluate(() => (window as unknown as Win).__app.instances[0]!.symbol)).toBe("ALPHA");
  await page.getByTestId("layout-button").click();
  await page.getByTestId("menu-load").click();
  await page.getByTestId("layout-open-my layout").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances[0]!.symbol)).toBe("GAMMA");
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances[0]!.studies().map((s) => s.study.def.id))).toEqual(["rsi"]);
  expect(errors).toEqual([]);
});

test("snapshot downloads a PNG of the chart", async ({ page }) => {
  await open(page);
  const dl = page.waitForEvent("download");
  await page.getByTestId("snapshot-button").click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe("ALPHA-5m.png");
  const bytes = readFileSync((await d.path())!);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.length).toBeGreaterThan(5000);
});

test("chart types: time-based and event-based", async ({ page }) => {
  const errors = await open(page);
  for (const id of ["bars", "line", "area", "baseline", "hiLo", "columns", "stepLine", "heikinAshi", "renko", "kagi", "pointFigure", "rangeBars", "lineBreak", "candles"]) {
    await page.getByTestId("charttype-button").click();
    await page.getByTestId(`menu-type-${id}`).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances[0]!.chartType)).toBe(id);
  }
  // Event-based types switch the analysis off and back on without losing the study.
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-search").fill("rsi");
  await page.getByTestId("indicator-add-rsi").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("charttype-button").click();
  await page.getByTestId("menu-type-renko").click();
  await expect(page.getByTestId("indicators-button")).toBeDisabled();
  await page.getByTestId("charttype-button").click();
  await page.getByTestId("menu-type-candles").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__app.instances[0]!.studies().length)).toBe(1);
  expect(errors).toEqual([]);
});

test("the script panel appears only with an adapter", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("script-button")).toHaveCount(0);
  await page.goto("/?ex=ui&script=1");
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  await page.getByTestId("script-button").click();
  // The playground mounts the real editor and runner (@alphacharts/script).
  await expect(page.getByTestId("script-panel").locator(".cm-content")).toBeVisible();
  await expect(page.getByTestId("script-run")).toBeVisible();
});

// ---- keyboard and accessibility -----------------------------------------------------------------------------

const active = (page: Page) => page.evaluate(() => (document.querySelector("alpha-chart-app")!.shadowRoot!.activeElement as HTMLElement | null)?.getAttribute("data-testid") ?? null);

test("dialogs trap focus, close on Escape and give focus back; menus use arrow keys", async ({ page }) => {
  await open(page);
  await page.getByTestId("indicators-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("indicators-dialog")).toBeVisible();
  await expect.poll(() => active(page)).toBe("indicator-search");
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => { const r = document.querySelector("alpha-chart-app")!.shadowRoot!; return !!r.activeElement?.closest("[role=dialog]"); });
    expect(inside).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("indicators-dialog")).toHaveCount(0);
  await expect.poll(() => active(page)).toBe("indicators-button");
  // A menu: arrows move, Escape closes and returns focus.
  await page.getByTestId("charttype-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect.poll(() => active(page)).toMatch(/^menu-/);
  const first = await active(page);
  await page.keyboard.press("ArrowDown");
  expect(await active(page)).not.toBe(first);
  await page.keyboard.press("Escape");
  await expect.poll(() => active(page)).toBe("charttype-button");
  // Live region announces a change.
  await page.getByTestId("interval-1h").click();
  await expect(page.getByTestId("live")).toContainText("1h");
});

test("every toolbar control is a focusable button with a name and a visible focus ring", async ({ page, browserName }) => {
  await open(page);
  const bad = await page.evaluate(() => {
    const r = document.querySelector("alpha-chart-app")!.shadowRoot!;
    return [...r.querySelectorAll<HTMLElement>(".toolbar button, .drawingbar button")].filter((b) => !(b.getAttribute("aria-label") || b.textContent?.trim())).length;
  });
  expect(bad).toBe(0);
  await page.getByTestId("symbol-button").focus();
  // Safari skips buttons on plain Tab (system setting); Option+Tab is its keyboard path to them.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.querySelector("alpha-chart-app")!.shadowRoot!.activeElement!).outlineStyle);
  expect(outline).toBe("solid");
});

for (const theme of ["dark", "light", "high-contrast"]) {
  test(`axe: no violations (${theme})`, async ({ page }) => {
    await open(page, `theme=${theme}`);
    const scan = async (label: string) => {
      const r = await new AxeBuilder({ page }).include("alpha-chart-app").analyze();
      expect(r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
    };
    await scan("app");
    await page.getByTestId("settings-button").click();
    await scan("settings");
    await page.keyboard.press("Escape");
    await page.getByTestId("indicators-button").click();
    await page.getByTestId("indicator-search").fill("rsi");
    await scan("indicators");
    await page.keyboard.press("Escape");
    await page.getByTestId("symbol-button").click();
    await scan("symbol search");
    await page.keyboard.press("Escape");
    await page.getByTestId("layout-button").click();
    await scan("layout menu");
  });
}

test("the script panel's Run puts the script's plot on the active chart, and shows compile errors", async ({ page }) => {
  await open(page, "script=1");
  await page.getByTestId("script-button").click();
  const editor = page.getByTestId("script-panel").locator(".cm-content");
  await editor.click();
  await page.keyboard.type('indicator("probe")\nplot(ta.sma(close, 20))');
  type W = { __app: { instances: Array<{ chart: { series(): Array<{ type: string; options(): { id: string } }> } }> } };
  const before = await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length);
  await page.getByTestId("script-run").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length), { timeout: 15_000 }).toBeGreaterThan(before);
  // The plotted values are the built-in SMA's, bar for bar (the script runs on
  // the same engine). They arrive from the worker, so wait for them.
  const compare = () => page.evaluate(() => {
    const c = (window as unknown as W).__app.instances[0]!.chart as unknown as {
      series(): Array<{ type: string; options(): { id: string; title: string }; data: { store: { first: number; end: number }; get(i: number, col: number): number; has(i: number): boolean } }>;
    };
    const all = c.series();
    const main = all.find((s) => s.options().id === "main")!;
    const line = all[all.length - 1]!;
    let checked = 0, worst = 0;
    for (let i = main.data.store.first + 19; i < main.data.store.end; i++) {
      if (!line.data.has(i)) continue;
      let sum = 0;
      for (let k = 0; k < 20; k++) sum += main.data.get(i - k, 3);
      worst = Math.max(worst, Math.abs(line.data.get(i, 0) - sum / 20));
      checked++;
    }
    return { checked, worst };
  });
  await expect.poll(async () => (await compare()).checked, { timeout: 15_000 }).toBeGreaterThan(50);
  expect((await compare()).worst).toBeLessThan(1e-9);
  // A compile error: diagnostics in the editor, and the good plot stays.
  const count = await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("plot(ta.sma(close, ))");
  await page.getByTestId("script-run").click();
  await expect(page.getByTestId("script-panel").locator(".cm-lintRange-error").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length)).toBe(count);
});

// H8: destroying the app releases the script worker (the chart's own removal also uninstalls its plugins).
test("destroying the app terminates the script's worker", async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.Worker;
    const live = new Set<Worker>();
    (window as unknown as { __liveWorkers: () => number }).__liveWorkers = () => live.size;
    window.Worker = class extends Real {
      constructor(url: string | URL, o?: WorkerOptions) {
        super(url, o);
        live.add(this);
      }
      override terminate(): void {
        live.delete(this);
        super.terminate();
      }
    } as typeof Worker;
  });
  await open(page, "script=1");
  const live = () => page.evaluate(() => (window as unknown as { __liveWorkers: () => number }).__liveWorkers());
  await page.evaluate(() => (window as unknown as { __app: { runScript(c: string): void } }).__app.runScript('indicator("probe")\nplot(ta.sma(close, 20))'));
  await expect.poll(live).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { __app: { destroy(): void } }).__app.destroy());
  expect(await live()).toBe(0);
});
