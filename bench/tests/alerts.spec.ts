// Alerts in a real browser: a replayed tick stream through the chart plugin
// fires exactly what the pure evaluator fires on the same definitions and
// ticks, and the log on screen shows each trigger.

import { expect, test, type Page } from "@playwright/test";
import { evaluate } from "../../packages/alerts/src/index.js";
import type { AlertDefinition, AlertTrigger, Tick } from "../../packages/alerts/src/index.js";

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  return errors;
}

/** Triggers as JSON would carry them (no undefined members). */
const plain = (ts: AlertTrigger[]) => JSON.parse(JSON.stringify(ts)) as unknown[];

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: dpr });

    test("replayed ticks fire the same triggers as the evaluator; snapshot after 700 ticks", async ({ page }) => {
      const errors = await open(page, "ex=alerts&auto=0");
      const data = await page.evaluate(() => {
        const w = window as unknown as { __ticks: Tick[]; __defs: AlertDefinition[] };
        return { ticks: w.__ticks, defs: w.__defs };
      });
      expect(data.ticks).toHaveLength(2000);

      await page.evaluate(() => (window as unknown as { __feed(k: number): number }).__feed(700));
      await page.mouse.move(0, 0);
      await page.waitForTimeout(60);
      const mid = await page.evaluate(() => (window as unknown as { __triggers: AlertTrigger[] }).__triggers);
      expect(plain(mid)).toEqual(plain(evaluate(data.defs, data.ticks.slice(0, 700))));
      expect(mid.length).toBeGreaterThan(0);
      const lines = (await page.locator("#alert-log").textContent())!.trim().split("\n");
      expect(lines).toHaveLength(mid.length);
      await expect(page.locator("#app")).toHaveScreenshot(`alerts-dpr${dpr}.png`, { maxDiffPixels: 0 });

      await page.evaluate(() => (window as unknown as { __feed(k: number): number }).__feed(5000));
      const all = await page.evaluate(() => (window as unknown as { __triggers: AlertTrigger[] }).__triggers);
      const expected = evaluate(data.defs, data.ticks);
      expect(plain(all)).toEqual(plain(expected));
      // every defined condition fired at least once (the sequence exercises them), and the once-alert only once
      const ids = new Set(all.map((t) => t.alertId));
      expect([...ids].sort()).toEqual(["close", "cross", "enter", "first", "move"].filter((i) => expected.some((t) => t.alertId === i)).sort());
      expect(all.filter((t) => t.alertId === "first").length).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  });
}

// A drawing is straight in pixels. The alert must watch the price at that pixel, on
// every price scale (on a log scale a line straight in price would be a different line).
test.describe("drawing alerts follow the line as drawn on every scale", () => {
  test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  const modes = [
    { name: "linear", options: {} },
    { name: "log", options: { mode: "log" } },
    { name: "percent", options: { mode: "percent" } },
    { name: "indexed", options: { mode: "indexed" } },
    { name: "log inverted", options: { mode: "log", invert: true } },
  ];
  for (const m of modes) {
    test(`${m.name}`, async ({ page }) => {
      const errors = await open(page, "ex=blank");
      const r = await page.evaluate(async (scale) => {
        const { createChart, ohlc, DrawingsPlugin, allTools, AlertsPlugin, linePrice } = window.__ac!;
        const el = document.createElement("div");
        el.style.cssText = "width:900px;height:500px";
        document.getElementById("app")!.appendChild(el);
        const chart = createChart(el, { rightPriceScale: scale as never });
        const d = ohlc(400, 3);
        chart.addSeries("candles").setData(d);
        chart.timeScale.setVisibleLogicalRange({ from: 100, to: 300 });
        const drawings = new DrawingsPlugin({ tools: allTools, interval: 60_000 });
        const alerts = new AlertsPlugin({ drawings });
        chart.addPlugin(drawings);
        chart.addPlugin(alerts);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        // From the left quarter, high on screen, to the right quarter, low: a steep line.
        const a = drawings.anchorAt(0, 200, 60), b = drawings.anchorAt(0, 700, 340);
        const line = drawings.add({ tool: "trendLine", anchors: [a, b] });
        const def = alerts.addDrawingAlert({ id: "l", drawingId: line.id, line: "main", op: "crossing", trigger: { mode: "everyTime" } });
        const g = (def.condition as { drawing: Parameters<typeof linePrice>[0] }).drawing;
        // The pixel midpoint of the drawn line, converted back to time and price.
        const pa = drawings.pixelOf(0, a), pb = drawings.pixelOf(0, b);
        const mid = drawings.anchorAt(0, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
        const watched = linePrice(g, "main", mid.time, (t) => chart.timeToLogical(t))!;
        return { scale: (g as { scale?: string }).scale ?? "none", drawn: mid.price, watched };
      }, m.options);
      expect(Math.abs(r.watched - r.drawn) / r.drawn).toBeLessThan(1e-9);
      expect(r.scale).toBe(m.name.startsWith("log") ? "log" : "none");
      expect(errors).toEqual([]);
    });
  }
});
