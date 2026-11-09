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
  await page.getByTestId("custom-interval-unit").click();
  await page.getByTestId("custom-interval-unit-m").click();
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
    await page.getByTestId("custom-interval-unit").click();
    await page.getByTestId(`custom-interval-unit-${u!}`).click();
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
  await page.getByTestId("drawing-dash").click();
  await page.getByTestId("drawing-dash-dashed").click();
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
  await page.getByTestId("alert-op").click();
  await page.getByTestId("alert-op-crossingUp").click();
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
  await page.getByTestId("alert-kind").click();
  await page.getByTestId("alert-kind-drawing").click();
  await page.getByTestId("alert-op").click();
  await page.getByTestId("alert-op-crossing").click();
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

const pngSize = (b: Uint8Array) => ({ w: new DataView(b.buffer, b.byteOffset).getUint32(16), h: new DataView(b.buffer, b.byteOffset).getUint32(20) });

test("the snapshot carries a header with the symbol and the last bar, and the header can be turned off", async ({ page }) => {
  await open(page);
  const dl = page.waitForEvent("download");
  await page.getByTestId("snapshot-button").click();
  const withHead = readFileSync((await (await dl).path())!);
  const head = await page.evaluate(() => (window as unknown as { __app: { snapshotHeaderText(): { title: string; when: string; values: Array<{ text: string }> } } }).__app.snapshotHeaderText());
  expect(head.title).toBe("ALPHA · 5m");
  expect(head.values[0]!.text).toMatch(/^O [\d.]+ {2}H [\d.]+ {2}L [\d.]+ {2}C [\d.]+$/);
  expect(head.when).not.toBe("");
  await page.goto("/?ex=ui&noheader=1");
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  const dl2 = page.waitForEvent("download");
  await page.getByTestId("snapshot-button").click();
  const bare = readFileSync((await (await dl2).path())!);
  expect(pngSize(withHead).w).toBe(pngSize(bare).w);
  expect(pngSize(withHead).h).toBeGreaterThan(pngSize(bare).h);
});

test("copy image puts a PNG of the chart on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.getByTestId("snapshot-copy-button").click();
  await expect(page.getByTestId("toasts")).toContainText("Image copied");
  const got = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]!.getType("image/png");
    return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer()).subarray(0, 8)), size: blob.size };
  });
  expect(got.type).toBe("image/png");
  expect(got.bytes).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(got.size).toBeGreaterThan(5000);
});

test("copy image says so when the browser cannot, and a host's onSnapshot gets the PNG with the action", async ({ page }) => {
  const errors = await open(page);
  void errors;
  await page.evaluate(() => { Object.defineProperty(window, "ClipboardItem", { value: undefined, configurable: true }); });
  await page.getByTestId("snapshot-copy-button").click();
  await expect(page.getByTestId("toasts")).toContainText("cannot copy images to the clipboard");
  // a host that takes the image itself
  await page.goto("/?ex=ui&hostsnap=1");
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  await page.getByTestId("snapshot-copy-button").click();
  await page.getByTestId("snapshot-button").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __snaps: string[] }).__snaps)).toEqual(["copy:image/png", "download:image/png"]);
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
    // Dialogs and menus fade and zoom in over 100 ms; axe measures the resting UI, not a half-transparent frame of the entrance.
    await page.emulateMedia({ reducedMotion: "reduce" });
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

test("the describe-an-indicator box appears only with an assistant, shows the script for review, and adds it only on Add", async ({ page }) => {
  await open(page);
  await page.getByTestId("indicators-button").click();
  await expect(page.getByTestId("assistant")).toHaveCount(0);
  await page.goto("/?ex=ui&assistant=1");
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  type W = { __app: { instances: Array<{ chart: { series(): unknown[] } }> } };
  const count = () => page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length);
  const before = await count();
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("assistant-prompt").fill("broken ema 20");
  await page.getByTestId("assistant-ask").click();
  // The stand-in's first script does not compile; the repair round trip returns the second.
  await expect(page.getByTestId("assistant-review")).toContainText("ta.ema(close, 20)");
  await expect(page.getByTestId("assistant-review")).toContainText("20-bar EMA");
  expect(await count()).toBe(before); // nothing is on the chart until Add
  await page.getByTestId("assistant-add").click();
  await expect.poll(count, { timeout: 15_000 }).toBeGreaterThan(before);
  await expect(page.getByTestId("indicators-dialog")).toHaveCount(0);
});

test("a prompt the assistant cannot answer shows its message and changes nothing", async ({ page }) => {
  await open(page, "assistant=1");
  type W = { __app: { instances: Array<{ chart: { series(): unknown[] } }> } };
  const before = await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length);
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("assistant-prompt").fill("something unrelated");
  await page.getByTestId("assistant-ask").click();
  await expect(page.getByTestId("assistant-error")).toContainText("ema 20");
  expect(await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length)).toBe(before);
});

test("the icon and table drawings have a Content tab that edits their glyph and cells", async ({ page }) => {
  await open(page);
  type W = { __app: { openDialog(d: unknown): void; instances: Array<{ drawings: { add(s: unknown): { id: string }; get(id: string): { props: Record<string, unknown> } } }> } };
  const ids = await page.evaluate(() => {
    const w = window as unknown as W;
    const d = w.__app.instances[0]!.drawings;
    const raw = (w.__app.instances[0] as unknown as { raw: { at(i: number): { time: number; close: number } } }).raw;
    const b = raw.at(raw.length - 10);
    return { icon: d.add({ tool: "icon", anchors: [{ time: b.time, price: b.close }], props: { glyph: "★" } }).id, table: d.add({ tool: "table", anchors: [], props: { fx: 0.4, fy: 0.3, cells: [["a", "b"]] } }).id };
  });
  const read = (id: string) => page.evaluate((i) => (window as unknown as W).__app.instances[0]!.drawings.get(i).props, id);
  await page.evaluate((id) => (window as unknown as W).__app.openDialog({ kind: "drawing", id }), ids.icon);
  await page.getByRole("tab", { name: "Content" }).click();
  await page.getByTestId("drawing-glyph").fill("🚀");
  expect((await read(ids.icon)).glyph).toBe("🚀");
  await page.getByTestId("drawing-glyph").fill("");
  await expect(page.getByRole("alert")).toContainText("glyph");
  expect((await read(ids.icon)).glyph).toBe("🚀"); // a refused edit changes nothing
  await page.keyboard.press("Escape");
  await page.evaluate((id) => (window as unknown as W).__app.openDialog({ kind: "drawing", id }), ids.table);
  await page.getByRole("tab", { name: "Content" }).click();
  await page.getByTestId("drawing-cells").fill("x | y | z\nq | r | s");
  await page.getByTestId("cells-apply").click();
  expect((await read(ids.table)).cells).toEqual([["x", "y", "z"], ["q", "r", "s"]]);
});

test("an auto-drawing analysis adds its drawings as one undo step, and is only offered when the host gives analyses", async ({ page }) => {
  await open(page);
  await page.getByTestId("indicators-button").click();
  await expect(page.getByTestId("analyses")).toHaveCount(0);
  await page.goto("/?ex=ui&auto=1");
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  type W = { __app: { instances: Array<{ drawings: { list(): Array<{ tool: string }>; undo(): boolean; canUndo: boolean } }> } };
  const list = () => page.evaluate(() => (window as unknown as W).__app.instances[0]!.drawings.list().map((d) => d.tool));
  expect(await list()).toEqual([]);
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("analysis-auto.fib-retracement").click();
  await expect.poll(list).toEqual(["fibRetracement"]);
  await page.getByTestId("analysis-auto.trendlines").click();
  await expect.poll(async () => (await list()).filter((t) => t === "trendLine").length).toBe(2);
  // the trend lines were one step: one undo removes both, the fib stays
  await page.evaluate(() => (window as unknown as W).__app.instances[0]!.drawings.undo());
  expect(await list()).toEqual(["fibRetracement"]);
});

test("undo and redo cover indicators and drawings in the order they happened; hide indicators, cursor mode, objects and remove-by-type work", async ({ page }) => {
  await open(page);
  type W = { __app: { cursorMode: string; instances: Array<{ studies(): Array<{ study: { id: string }; userHidden: boolean }>; drawings: { list(): Array<{ tool: string }>; add(s: unknown): { id: string } }; chart: { options(): { crosshair: { visible: boolean } } }; raw: { at(i: number): { time: number; close: number }; length: number } }> } };
  const state = () => page.evaluate(() => { const i = (window as unknown as W).__app.instances[0]!; return { studies: i.studies().length, hidden: i.studies().map((s) => s.userHidden), drawings: i.drawings.list().map((d) => d.tool) }; });
  // add an indicator through the dialog, then a drawing in code: undo takes the drawing first, then the indicator
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-add-sma").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const i = (window as unknown as W).__app.instances[0]!; const b = i.raw.at(i.raw.length - 10); i.drawings.add({ tool: "horizontalLine", anchors: [{ time: b.time, price: b.close }] }); });
  expect(await state()).toMatchObject({ studies: 1, drawings: ["horizontalLine"] });
  await page.getByTestId("undo-button").click();
  expect(await state()).toMatchObject({ studies: 1, drawings: [] });
  await page.getByTestId("undo-button").click();
  expect(await state()).toMatchObject({ studies: 0, drawings: [] });
  await page.getByTestId("redo-button").click(); // the last undo was the indicator: it comes back first
  expect(await state()).toMatchObject({ studies: 1, drawings: [] });
  await page.getByTestId("redo-button").click();
  expect(await state()).toMatchObject({ studies: 1, drawings: ["horizontalLine"] });
  // hide and show all indicators
  await page.getByTestId("hideindicators-button").click();
  expect((await state()).hidden).toEqual([true]);
  await page.getByTestId("hideindicators-button").click();
  expect((await state()).hidden).toEqual([false]);
  // cursor mode: arrow hides the crosshair, cross brings it back
  await page.getByTestId("cursor-mode-button").click();
  expect(await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.options().crosshair.visible)).toBe(false);
  await page.getByTestId("cursor-mode-button").click();
  expect(await page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.options().crosshair.visible)).toBe(true);
  // objects dialog lists both and deletes a drawing
  await page.getByTestId("objects-button").click();
  await expect(page.getByTestId("objects-studies").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("objects-drawings").getByRole("listitem")).toHaveCount(1);
  await page.getByTestId("objects-drawings").getByRole("button", { name: "Delete" }).click();
  expect((await state()).drawings).toEqual([]);
  await page.keyboard.press("Escape");
  // remove-by-type: two lines and a ray; the menu offers "Remove all" only for the type that has more than one
  const ids = await page.evaluate(() => { const i = (window as unknown as W).__app.instances[0]!; const b = i.raw.at(i.raw.length - 10); const t = b.time; return [1, 2].map((k) => i.drawings.add({ tool: "horizontalLine", anchors: [{ time: t, price: b.close * (1 + k / 100) }] }).id).concat(i.drawings.add({ tool: "verticalLine", anchors: [{ time: t, price: b.close }] }).id); });
  expect(ids).toHaveLength(3);
  await page.evaluate(() => (window as unknown as { __app: { removeDrawingsOfTool(t: string): void } }).__app.removeDrawingsOfTool("horizontalLine"));
  expect((await state()).drawings).toEqual(["verticalLine"]);
});

test("the magnet snaps to an indicator's value only when snap to indicators is on", async ({ page }) => {
  await open(page);
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-add-sma").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("magnet-button").click(); // weak
  await page.getByTestId("magnet-button").click(); // strong
  type Snap = { time: number; price: number };
  type W = { __app: { instances: Array<{ studies(): Array<{ study: { times(): Float64Array; column(c: string): Float64Array; def: { columns: string[] } } }>; raw: { length: number }; drawings: { pixelOf(p: number, a: Snap): { x: number; y: number }; snap(e: unknown): Snap } }> } };
  const probe = () => page.evaluate(() => {
    const i = (window as unknown as W).__app.instances[0]!;
    const st = i.studies()[0]!.study;
    const times = st.times();
    let k = times.length - 20;
    const col = st.def.columns[0]!;
    while (Number.isNaN(st.column(col)[k]!)) k--;
    const target = { time: times[k]!, price: st.column(col)[k]! };
    const px = i.drawings.pixelOf(0, target);
    const got = i.drawings.snap({ pane: 0, x: px.x + 1, y: px.y + 1, time: target.time, price: target.price });
    return { target: target.price, snapped: got.price };
  });
  const off = await probe();
  expect(off.snapped).not.toBe(off.target); // bar values only
  await page.getByTestId("snap-indicators-button").click();
  const on = await probe();
  expect(on.snapped).toBe(on.target);
});

test("a script saved from the panel is listed under My scripts and runs from there", async ({ page }) => {
  await open(page, "script=1");
  type W = { __app: { instances: Array<{ chart: { series(): unknown[] } }> } };
  const count = () => page.evaluate(() => (window as unknown as W).__app.instances[0]!.chart.series().length);
  const before = await count();
  await page.getByTestId("script-button").click();
  await page.getByTestId("script-panel").locator(".cm-content").click();
  await page.keyboard.type('indicator("saved")\nplot(ta.sma(close, 10))');
  await page.getByTestId("script-save").click();
  await page.getByRole("dialog").getByRole("textbox").fill("sma ten");
  await page.keyboard.press("Enter");
  await page.getByTestId("indicators-button").click();
  await expect(page.getByTestId("my-scripts")).toContainText("sma ten");
  expect(await count()).toBe(before);
  await page.getByTestId("script-run-sma ten").click();
  await expect.poll(count, { timeout: 15_000 }).toBeGreaterThan(before);
});

test("undo and redo follow the order changes were made across indicators and drawings, however many", async ({ page }) => {
  await open(page);
  type W = { __app: { instances: Array<{ studies(): Array<{ study: { id: string } }>; drawings: { list(): Array<{ tool: string }>; add(s: unknown): unknown }; raw: { at(i: number): { time: number; close: number }; length: number } }> } };
  const state = () => page.evaluate(() => { const i = (window as unknown as W).__app.instances[0]!; return `${i.studies().length}|${i.drawings.list().map((d) => d.tool).join(",")}`; });
  const draw = (tool: string) => page.evaluate((t) => { const i = (window as unknown as W).__app.instances[0]!; const b = i.raw.at(i.raw.length - 10); i.drawings.add({ tool: t, anchors: [{ time: b.time, price: b.close }] }); }, tool);
  await draw("horizontalLine");                                 // D1
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-add-sma").click();          // S
  await page.keyboard.press("Escape");
  await draw("verticalLine");                                   // D2
  expect(await state()).toBe("1|horizontalLine,verticalLine");
  const undo = () => page.getByTestId("undo-button").click(), redo = () => page.getByTestId("redo-button").click();
  await undo(); expect(await state()).toBe("1|horizontalLine");  // D2
  await undo(); expect(await state()).toBe("0|horizontalLine");  // S, not D1
  await undo(); expect(await state()).toBe("0|");                // D1
  await redo(); expect(await state()).toBe("0|horizontalLine");  // D1 first (undone last)
  await redo(); expect(await state()).toBe("1|horizontalLine");  // then S
  await redo(); expect(await state()).toBe("1|horizontalLine,verticalLine");
  // Ctrl+Z inside the chart is the same undo: the indicator-aware one
  await undo(); await undo();
  expect(await state()).toBe("0|horizontalLine");
  await page.locator("#app").click({ position: { x: 600, y: 300 } });
  await page.keyboard.press("Control+z");
  expect(await state()).toBe("0|");
  // a new change ends the redo line
  await draw("crossLine");
  await redo();
  expect(await state()).toBe("0|crossLine");
});

test("every chart type survives live ticks, and the HLC area's edges follow the bar's high and low", async ({ page }) => {
  const errors = await open(page);
  type W = { __feed: { replay(s: string, p: number[]): void }; __app: { instances: Array<{ chart: { series(): Array<{ type: string; options(): { id: string }; data: { store: { end: number }; get(i: number, c: number): number } }> }; raw: { at(i: number): { high: number; low: number; close: number }; length: number } }>; setChartType(t: string): void } };
  for (const t of ["candles", "hollowCandles", "bars", "hiLo", "columns", "line", "lineMarkers", "area", "hlcArea", "baseline", "stepLine", "heikinAshi"]) {
    await page.evaluate((id) => (window as unknown as { __app: { current: { setChartType(t: string): void } } }).__app.current.setChartType(id), t);
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => {
      const w = window as unknown as W; const i = w.__app.instances[0]!;
      const last = i.raw.at(i.raw.length - 1).close;
      w.__feed.replay("ALPHA", [last + 1, last + 9, last - 7, last + 2]);
      const now = i.raw.at(i.raw.length - 1).close;
      // the value-style display series (a line, area, step line, baseline or line with markers) must hold the new close
      const vals = i.chart.series().filter((x) => ["line", "area", "step-line", "baseline", "line-markers"].includes(x.type) && !x.options().id.startsWith("study")).map((x) => x.data.get(x.data.store.end - 1, 0));
      return { now, vals };
    });
    if (["line", "lineMarkers", "area", "stepLine", "baseline"].includes(t)) {
      expect(seen.vals.length, t).toBeGreaterThan(0);
      for (const v of seen.vals) expect(v, t).toBeCloseTo(seen.now, 6);
    }
  }
  expect(errors).toEqual([]);
  // HLC area: the two edge lines carry the forming bar's high and low, not its close
  await page.evaluate(() => (window as unknown as { __app: { current: { setChartType(t: string): void } } }).__app.current.setChartType("hlcArea"));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const w = window as unknown as W;
    const i = w.__app.instances[0]!;
    const last = i.raw.at(i.raw.length - 1);
    w.__feed.replay("ALPHA", [last.close + 5, last.close - 5]);
    const now = i.raw.at(i.raw.length - 1);
    const lines = i.chart.series().filter((s) => s.type === "line" && !s.options().id.startsWith("study"));
    const at = lines.map((s) => s.data.get(s.data.store.end - 1, 0));
    return { high: now.high, low: now.low, at: at.sort((a, b) => b - a) };
  });
  expect(r.at[0]).toBeCloseTo(r.high, 6);
  expect(r.at[1]).toBeCloseTo(r.low, 6);
});

test("an analysis sees closed bars only, and its answer is dropped when the chart changed while it ran", async ({ page }) => {
  await open(page, "auto=1");
  type Entry = { run(r: { bars: unknown[] }): Promise<{ drawings: unknown[] }> };
  type W = { __app: { options: { analyses: Entry[] }; current: { setSymbol(s: string): void }; instances: Array<{ raw: { length: number }; drawings: { list(): unknown[] } }> }; __seen?: { n: number; raw: number } };
  await page.evaluate(() => {
    const w = window as unknown as W;
    const e = w.__app.options.analyses[0]!;
    const orig = e.run.bind(e);
    e.run = async (r) => { w.__seen = { n: r.bars.length, raw: w.__app.instances[0]!.raw.length }; return orig(r); };
  });
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("analysis-auto.fib-retracement").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__seen)).toBeTruthy();
  const seen = await page.evaluate(() => (window as unknown as W).__seen!);
  expect(seen.n).toBe(seen.raw - 1);
  // a run whose chart changes underneath it draws nothing
  await page.evaluate(() => {
    const w = window as unknown as W;
    const e = w.__app.options.analyses[1]!;
    e.run = async () => { w.__app.current.setSymbol("BETA"); await new Promise((r) => setTimeout(r, 200)); return { drawings: [{ tool: "horizontalLine", anchors: [{ time: 1, price: 1 }] }] }; };
  });
  await page.getByTestId("analysis-auto.fib-extension").click();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as W).__app.instances[0]!.drawings.list().filter((d) => (d as { tool: string }).tool === "horizontalLine").length)).toBe(0);
});

test("undoing a removed indicator in an event-based chart type keeps the entry, and works once back on time bars", async ({ page }) => {
  await open(page);
  type W = { __app: { current: { studies(): unknown[]; setChartType(t: string): void }; undo(): boolean } };
  const n = () => page.evaluate(() => (window as unknown as W).__app.current.studies().length);
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-add-sma").click();
  await page.getByTestId("active-studies").getByRole("button", { name: /Remove/ }).click();
  await page.keyboard.press("Escape");
  expect(await n()).toBe(0);
  await page.evaluate(() => (window as unknown as W).__app.current.setChartType("renko"));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as W).__app.undo())).toBe(false); // cannot put it back here: the entry stays
  await page.evaluate(() => (window as unknown as W).__app.current.setChartType("candles"));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as W).__app.undo())).toBe(true);
  expect(await n()).toBe(1);
});

test("opening a saved script asks before it replaces different text in the panel", async ({ page }) => {
  await open(page, "script=1");
  await page.getByTestId("script-button").click();
  const editor = page.getByTestId("script-panel").locator(".cm-content");
  await editor.click();
  await page.keyboard.type('indicator("one")\nplot(close)');
  await page.getByTestId("script-save").click();
  await page.getByRole("dialog").getByRole("textbox").fill("one");
  await page.keyboard.press("Enter");
  await editor.click();
  await page.keyboard.type("\n// my unsaved edit");
  await page.getByTestId("indicators-button").click();
  await page.getByRole("button", { name: "Open one in the script panel" }).click();
  await expect(page.getByRole("dialog")).toContainText("replaces the text in the script panel");
  await page.getByRole("button", { name: "Replace" }).click();
  await expect(editor).not.toContainText("my unsaved edit");
});

test("theme inherit: the chart and the shell take the page's shadcn tokens, follow a .dark switch, and differ between two scopes", async ({ page }) => {
  const errors = await open(page, "theme=inherit&scope=app");
  type W = { __app: { hostTheme(): Record<string, string>; instances: Array<{ chart: { options(): { theme: Record<string, string> } } }> } };
  const theme = () => page.evaluate(() => { const a = (window as unknown as W).__app; return { host: a.hostTheme(), chart: a.instances[0]!.chart.options().theme }; });
  const near = (hex: string, want: number, tol = 2) => { const v = parseInt(hex.slice(1, 3), 16); expect(Math.abs(v - want), `${hex} vs ${want}`).toBeLessThanOrEqual(tol); };
  // light app scope: #f7f7f7 on #0a0a0a, square (radius 0)
  let t = await theme();
  expect(t.host.background).toBe("#f7f7f7");
  near(t.host.text!, 10);
  expect(t.chart.background).toBe(t.host.background); // the chart got the same finished theme
  expect(t.host.up).toBe("#0e9f6e"); // --chart-up replaced the Luma default
  // the shell reads the same page variables, live, through its shadow root
  const shell = () => page.evaluate(() => {
    const app = document.querySelector("alpha-chart-app")!.shadowRoot!.querySelector(".app")!;
    const toggle = app.querySelector('[data-testid="tool-cursor"]')!;
    return { bg: getComputedStyle(app).backgroundColor, radius: getComputedStyle(toggle).borderTopLeftRadius };
  });
  expect(await shell()).toEqual({ bg: "rgb(247, 247, 247)", radius: "0px" });
  // the page switches to dark the shadcn way: a class on an ancestor
  await page.evaluate(() => document.querySelector("#app")!.classList.add("dark"));
  await expect.poll(async () => (await theme()).host.background).not.toBe("#f7f7f7");
  t = await theme();
  near(t.host.background, 11);
  near(t.host.text!, 242);
  expect(t.chart.background).toBe(t.host.background);
  expect((await shell()).bg).toBe("rgb(11, 11, 11)");
  // a translucent border (white at 10%) was flattened onto the background: opaque
  expect(t.host.border).toMatch(/^#[0-9a-f]{6}$/);
  await page.evaluate(() => document.querySelector("#app")!.classList.remove("dark"));
  await expect.poll(async () => (await theme()).host.background).toBe("#f7f7f7");
  // the research scope: a different palette and radius from the same chart code
  await page.goto("/?ex=ui&theme=inherit&scope=research");
  await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
  const r = await theme();
  expect(r.host.background).not.toBe("#f7f7f7");
  expect(r.host.accent).not.toBe(t.host.accent);
  expect((await shell()).radius).not.toBe("0px"); // Luma's radius, from the research scope's --radius
  expect(errors).toEqual([]);
});

test("theme inherit with no tokens on the page is the Luma palette: black when dark, and no TradingView colour is left", async ({ page }) => {
  await open(page, "theme=inherit");
  type W = { __app: { hostTheme(): Record<string, string>; setTheme(n: string): void } };
  const t = await page.evaluate(() => (window as unknown as W).__app.hostTheme());
  expect([t.up, t.down]).toEqual(["#10b981", "#ef4444"]);
  await page.evaluate(() => (window as unknown as W).__app.setTheme("dark"));
  const d = await page.evaluate(() => (window as unknown as W).__app.hostTheme());
  expect(d.background).toBe("#000000");
  // neutral greys only: every colour of the dark theme has equal red, green and blue (no tint)
  for (const k of ["background", "text", "textMuted", "grid", "border", "crosshair", "labelBackground", "labelText", "accent"]) {
    const h = d[k]!;
    expect(h, k).toMatch(/^#[0-9a-f]{6}$/);
    expect([h.slice(1, 3), h.slice(3, 5)], `${k} is a neutral grey`).toEqual([h.slice(3, 5), h.slice(5, 7)]);
  }
});

test("the shell's radius follows the host's --radius", async ({ page }) => {
  const radius = async (scope: string) => {
    await page.goto(`/?ex=ui&theme=inherit&scope=${scope}`);
    await page.waitForFunction(() => (window as unknown as { __uiReady?: boolean }).__uiReady === true);
    await page.getByTestId("indicators-button").click();
    return page.getByTestId("indicators-dialog").evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  };
  const app = await radius("app"), research = await radius("research");
  const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(app).toBe(0); // the app scope is square: --radius 0
  expect(research).toBeCloseTo(0.625 * rem * 2.6, 0); // Luma's dialog is rounded-4xl, 2.6 radii; a rem is the page's
});

test("a host's own drawing tool gets a Custom group in the drawing bar", async ({ page }) => {
  await open(page, "assistant=1");
  await page.getByTestId("flyout-custom").click();
  await expect(page.getByTestId("tool-demo.tools.level")).toContainText("Demo level");
});

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

// ---- shadcn theming of the shell -----------------------------------------------------------------------------------------

/** Computed style of the first element matching `sel` inside the shell's shadow root. */
const shellStyle = (page: Page, sel: string, prop: string) =>
  page.evaluate(([sel, prop]) => {
    // null until it renders, so expect.poll keeps polling
    const el = document.querySelector("alpha-chart-app")!.shadowRoot!.querySelector(sel!);
    return el ? getComputedStyle(el).getPropertyValue(prop!) : null;
  }, [sel, prop]);

test("the shell takes the host's shadcn tokens live; --ac-* beats them; a named theme ignores them", async ({ page }) => {
  const errors = await open(page, "theme=inherit");
  const host = (css: string) => page.evaluate((c) => document.querySelector("alpha-chart-app")!.setAttribute("style", c), css);
  await host("--popover: rgb(10, 20, 30); --muted: rgb(40, 50, 60);");
  await page.getByTestId("layout-button").click();
  await expect.poll(() => shellStyle(page, '[data-slot="dropdown-menu-content"]', "background-color")).toBe("rgb(10, 20, 30)");
  await page.getByTestId("layout-button").click(); // the trigger toggles its menu shut
  await expect.poll(() => shellStyle(page, '[data-testid="tool-cursor"]', "background-color")).toBe("rgb(40, 50, 60)"); // the pressed toggle is bg-muted (polled: it transitions)
  await host("--popover: rgb(10, 20, 30); --ac-popover: rgb(200, 0, 0);");
  await page.getByTestId("layout-button").click();
  await expect.poll(() => shellStyle(page, '[data-slot="dropdown-menu-content"]', "background-color")).toBe("rgb(200, 0, 0)");
  await page.getByTestId("layout-button").click(); // the trigger toggles its menu shut
  // a fixed theme keeps its own colours whatever the page defines (the override still applies)
  await host("--popover: rgb(10, 20, 30);");
  await page.evaluate(() => (window as unknown as { __app: { setTheme(n: string): void } }).__app.setTheme("dark"));
  await page.getByTestId("layout-button").click();
  await expect.poll(() => shellStyle(page, '[data-slot="dropdown-menu-content"]', "background-color")).toBe("rgb(10, 10, 10)"); // Luma dark popover
  expect(errors).toEqual([]);
});

test("every shell component carries its shadcn slot as data-slot and part", async ({ page }) => {
  await open(page);
  const slots = () => page.evaluate(() => [...document.querySelector("alpha-chart-app")!.shadowRoot!.querySelectorAll("[data-slot]")].map((e) => [e.getAttribute("data-slot"), e.getAttribute("part")]));
  await page.getByTestId("settings-button").click();
  await page.getByRole("tab", { name: "Scales and lines" }).click();
  const seen = new Map(await slots());
  for (const s of ["button", "toggle", "toggle-group", "toggle-group-item", "separator", "dialog-overlay", "dialog-content", "dialog-title", "tabs-list", "tabs-trigger", "field", "field-label", "select-trigger"]) {
    expect(seen.has(s), s).toBe(true);
    expect(seen.get(s), `part of ${s}`).toBe(s);
  }
});

test("styles adds CSS after the built-in sheet; stylesheet none drops it; wrong values throw at creation", async ({ page }) => {
  const errors = await open(page);
  const make = (extra: Record<string, unknown>) => page.evaluate(async (x) => {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;width:800px;height:500px";
    document.body.append(el);
    try {
      const app = (window as unknown as { __createApp(el: HTMLElement, x: Record<string, unknown>): { ready: Promise<void>; destroy(): void } }).__createApp(el, x);
      await app.ready;
      await new Promise((r) => requestAnimationFrame(r));
      const root = el.querySelector("alpha-chart-app")!.shadowRoot!;
      const btn = root.querySelector('[data-testid="settings-button"]')!;
      const out = { ok: true, sheets: root.querySelectorAll("style").length, radius: getComputedStyle(btn).borderTopLeftRadius, padding: getComputedStyle(btn).paddingTop };
      app.destroy();
      return out;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      el.remove();
    }
  }, extra);
  const added = await make({ styles: '[data-slot="button"] { border-radius: 3px; }' });
  expect(added).toMatchObject({ ok: true, sheets: 2, radius: "3px" });
  const none = await make({ stylesheet: "none", styles: ".app { display: block; }" });
  expect(none).toMatchObject({ ok: true, sheets: 1, padding: "1px" }); // a bare button: the built-in recipes are gone
  expect(await make({ stylesheet: "none" })).toMatchObject({ ok: false, error: expect.stringMatching(/stylesheet "none".*styles/) });
  expect(await make({ stylesheet: "shadcn" })).toMatchObject({ ok: false, error: expect.stringMatching(/stylesheet is "shadcn"/) });
  expect(await make({ styles: 42 })).toMatchObject({ ok: false, error: expect.stringMatching(/styles is a CSS string/) });
  expect(errors).toEqual([]);
});

test("an icon button's label shows as a tooltip on hover and on keyboard focus, not as a title", async ({ page }) => {
  await open(page);
  const btn = page.getByTestId("settings-button");
  expect(await btn.getAttribute("title")).toBeNull();
  await btn.hover();
  await expect(page.getByTestId("tooltip")).toHaveText(/Settings/);
  await page.mouse.move(2, 2);
  await expect(page.getByTestId("tooltip")).toHaveCount(0);
  await page.getByTestId("indicators-button").focus();
  await page.keyboard.press("Tab"); // keyboard focus: the next button, the alerts one
  await expect(page.getByTestId("tooltip")).toHaveText(/Alerts/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tooltip")).toHaveCount(0);
});

test("the interval palette: grouped by unit, the current one focused, arrow keys move, Enter picks", async ({ page }) => {
  await open(page);
  await page.getByTestId("interval-button").click();
  const dialog = page.getByTestId("interval-dialog");
  await expect(dialog.locator('[data-slot="command-group-heading"]', { hasText: /^Minutes$/ })).toBeVisible();
  await expect(page.getByTestId("interval-option-5m")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const next = await page.evaluate(() => document.querySelector("alpha-chart-app")!.shadowRoot!.activeElement!.getAttribute("data-testid"));
  expect(next).toMatch(/^interval-option-/);
  expect(next).not.toBe("interval-option-5m");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  const chosen = next!.replace("interval-option-", "");
  expect(await page.evaluate(() => (window as unknown as { __app: { current: { interval: string } } }).__app.current.interval)).toBe(chosen);
});

test("colour slots: a study's line takes the theme's palette colour, and the light theme's after a switch", async ({ page }) => {
  const errors = await open(page, "theme=dark");
  type Chart = { options(): { theme: { palette: string[] } }; series(): Array<{ options(): { id: string; color?: string } }> };
  type W = { __app: { setTheme(n: string): void; current: { chart: Chart } } };
  const probe = () => page.evaluate(() => {
    const chart = (window as unknown as W).__app.current.chart;
    const line = chart.series().find((s) => s.options().id.startsWith("study:"));
    return { color: line?.options().color, palette: chart.options().theme.palette };
  });
  await page.getByTestId("indicators-button").click();
  await page.getByTestId("indicator-add-sma").click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await probe()).color).toBeTruthy();
  const dark = await probe();
  const slot = dark.palette.indexOf(dark.color!);
  expect(slot, `${dark.color} is a colour of the dark palette`).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => (window as unknown as W).__app.setTheme("light"));
  await expect.poll(async () => { const l = await probe(); return l.color === l.palette[slot] && l.color !== dark.color; }).toBe(true);
  expect(errors).toEqual([]);
});

test("a Select in a dialog: its trigger toggles the list, and Tab closes it without leaving the dialog", async ({ page }) => {
  await open(page);
  await page.getByTestId("settings-button").click();
  await page.getByRole("tab", { name: "Scales and lines" }).click();
  const trigger = page.getByTestId("scale-mode-right");
  await trigger.click();
  await expect(page.getByTestId("scale-mode-right-list")).toBeVisible();
  await trigger.click(); // a second press on the trigger closes the list, it does not reopen it
  await expect(page.getByTestId("scale-mode-right-list")).toHaveCount(0);
  await trigger.click();
  await expect(page.getByTestId("scale-mode-right-linear")).toBeFocused(); // the chosen option takes focus once the list is placed
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("scale-mode-right-list")).toHaveCount(0);
  const inDialog = await page.evaluate(() => {
    const root = document.querySelector("alpha-chart-app")!.shadowRoot!;
    return !!root.activeElement && !!root.activeElement.closest('[role="dialog"]');
  });
  expect(inDialog).toBe(true);
});

test("a menu's trigger toggles it", async ({ page }) => {
  await open(page);
  await page.getByTestId("layout-button").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByTestId("layout-button").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});
