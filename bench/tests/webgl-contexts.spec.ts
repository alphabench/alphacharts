// Creating and removing charts must not leak WebGL contexts: browsers warn
// ("too many active WebGL contexts") and evict the oldest past a limit, and
// WebKit keeps a removed canvas's context until GC unless it is released.
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });

test("30 create/remove cycles never warn about WebGL contexts and chart 31 renders", async ({ page }) => {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on("console", (m) => {
    if (/webgl|context/i.test(m.text())) warnings.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?ex=blank");
  await page.waitForFunction(() => window.__ready === true);

  const kinds = await page.evaluate(async () => {
    const { createChart, ohlc } = window.__ac!;
    const d = ohlc(2000, 3);
    const kinds: string[] = [];
    const app = document.getElementById("app")!;
    for (let i = 0; i < 30; i++) {
      const el = document.createElement("div");
      el.style.cssText = "width:600px;height:300px";
      app.appendChild(el);
      const chart = createChart(el, { renderer: "auto" });
      chart.addSeries("candles").setData(d);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      kinds.push(chart.renderer);
      chart.remove();
      el.remove();
    }
    return kinds;
  });
  expect(kinds.every((k) => k === "webgl")).toBe(true);

  const el = page.locator("#app");
  await page.evaluate(async () => {
    const { createChart, ohlc } = window.__ac!;
    const host = document.createElement("div");
    host.id = "last";
    host.style.cssText = "width:600px;height:300px";
    document.getElementById("app")!.appendChild(host);
    const chart = createChart(host, { renderer: "auto" });
    const s = chart.addSeries("candles");
    s.setData(ohlc(2000, 3));
    (window as unknown as { __last: unknown }).__last = { chart, s };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const kind = await page.evaluate(() => (window as unknown as { __last: { chart: { renderer: string } } }).__last.chart.renderer);
  expect(kind).toBe("webgl");
  const withData = await el.locator("#last").screenshot();
  await page.evaluate(async () => {
    (window as unknown as { __last: { s: { applyOptions(o: object): void } } }).__last.s.applyOptions({ visible: false });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const without = await el.locator("#last").screenshot();
  expect(withData.equals(without)).toBe(false);
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});

test("rounds of several simultaneous charts, all removed between rounds, never warn", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (/webgl|context/i.test(m.text())) warnings.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto("/?ex=blank");
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(async () => {
    const { createChart, ohlc } = window.__ac!;
    const d = ohlc(500, 3);
    const app = document.getElementById("app")!;
    for (let round = 0; round < 6; round++) {
      const live = [];
      for (let i = 0; i < 8; i++) {
        const el = document.createElement("div");
        el.style.cssText = "width:300px;height:150px";
        app.appendChild(el);
        const chart = createChart(el);
        chart.addSeries("candles").setData(d);
        live.push({ el, chart });
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (const { el, chart } of live) {
        chart.remove();
        el.remove();
      }
    }
  });
  expect(warnings).toEqual([]);
});
