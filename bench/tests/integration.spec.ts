// What a host application needs of the core (?ex=integration): series
// markers, hovered objects, background primitives, pane view time/spacing,
// coordinate helpers, autoscale override, price line styles, title tag, grid /
// crosshair label / minWidth options and the crosshair time format.

import { expect, test, type Page } from "@playwright/test";
import type { IntegrationDemo } from "../../apps/playground/src/integration-demo.js";

type Pt = { x: number; y: number };
type Win = { __fe: IntegrationDemo };
// Internals the geometry checks read (the chart does not expose placed markers).
type Internals = {
  panes: { top: number; scales: Map<string, unknown> }[];
  paneArea: { x: number; width: number };
  markerLayout(p: unknown, s: unknown, sc: unknown): { marker: { id?: string }; cx: number; cy: number; size: number; box: { x: number; y: number; w: number; h: number } }[];
  crosshairIndex(): number | undefined;
  timeline: { timeAt(i: number): number };
};

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto("/?ex=integration");
  await page.waitForFunction(() => window.__ready === true);
  return errors;
}

/** Page coordinates of a pane point of pane 0. */
const pagePoint = (page: Page, px: number, py: number): Promise<Pt> =>
  page.evaluate(([x, y]) => {
    const fe = (window as unknown as Win).__fe;
    const c = fe.chart as unknown as Internals & { element: HTMLElement };
    const r = c.element.getBoundingClientRect();
    return { x: r.left + c.paneArea.x + x!, y: r.top + c.panes[0]!.top + y! };
  }, [px, py]);

/** Pane point of a marker's shape centre. */
const markerPoint = (page: Page, id: string): Promise<Pt> =>
  page.evaluate((mid) => {
    const fe = (window as unknown as Win).__fe;
    const c = fe.chart as unknown as Internals;
    const p = c.panes[0]!;
    const placed = c.markerLayout(p, fe.candles, p.scales.get("right")).find((m) => m.marker.id === mid);
    if (!placed) throw new Error(`marker ${mid} not placed`);
    return { x: placed.cx, y: placed.cy };
  }, id);

const lastEvent = (page: Page, type: string) =>
  page.evaluate((t) => {
    const ev = (window as unknown as Win).__fe.events.filter((e) => e.type === t);
    return ev[ev.length - 1];
  }, type);

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: dpr });

    test("snapshots: idle, and hovering the background band", async ({ page }) => {
      const errors = await open(page);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(60);
      await expect(page.locator("#app")).toHaveScreenshot(`integration-dpr${dpr}.png`, { maxDiffPixels: 0 });
      const band = await page.evaluate(() => {
        const fe = (window as unknown as Win).__fe;
        const v = fe.band.view!;
        return { x: v.timeToX(fe.band.t0) + 20, y: (v.y(fe.band.low) + v.y(fe.band.high)) / 2 };
      });
      const pt = await pagePoint(page, band.x, band.y);
      await page.mouse.move(pt.x, pt.y);
      await page.waitForTimeout(60);
      await expect(page.locator("#app")).toHaveScreenshot(`integration-hover-dpr${dpr}.png`, { maxDiffPixels: 0 });
      expect(errors).toEqual([]);
    });
  });
}

test.describe("behaviour", () => {
  test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });

  test("markers: placed above/below with stacking, reported as hovered, click and dblclick", async ({ page }) => {
    const errors = await open(page);
    const geo = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const c = fe.chart as unknown as Internals;
      const p = c.panes[0]!;
      const placed = c.markerLayout(p, fe.candles, p.scales.get("right"));
      const bar = (id: string) => {
        const m = fe.candles.markers().find((x) => x.id === id)!;
        return fe.candles.barAt(m.time)!;
      };
      const by = (id: string) => placed.find((m) => m.marker.id === id)!;
      return {
        n: placed.length,
        sell: { cy: by("m-sell").cy, size: by("m-sell").size, high: fe.candles.priceToCoordinate(bar("m-sell").high) },
        buy: { cy: by("m-buy").cy, size: by("m-buy").size, low: fe.candles.priceToCoordinate(bar("m-buy").low) },
        s1: by("m-stack-1").cy, s2: by("m-stack-2").cy, s2size: by("m-stack-2").size, s1size: by("m-stack-1").size,
        high12: fe.candles.priceToCoordinate(bar("m-stack-1").high),
      };
    });
    expect(geo.n).toBe(5);
    expect(geo.sell.cy + geo.sell.size / 2).toBeLessThan(geo.sell.high); // above the high, with a gap
    expect(geo.buy.cy - geo.buy.size / 2).toBeGreaterThan(geo.buy.low); // below the low
    expect(geo.s1 + geo.s1size / 2).toBeLessThan(geo.high12);
    expect(geo.s2 + geo.s2size / 2).toBeLessThan(geo.s1 - geo.s1size / 2); // second stacked outward, no overlap
    expect(geo.s2size).toBeGreaterThan(geo.s1size); // size multiplier

    // Hover each id'd marker: crosshairMove carries it, the cursor is a pointer.
    for (const id of ["m-buy", "m-sell", "m-stack-1", "m-stack-2"]) {
      const m = await markerPoint(page, id);
      const pt = await pagePoint(page, m.x, m.y);
      await page.mouse.move(pt.x, pt.y);
      expect((await lastEvent(page, "crosshairMove"))?.hovered).toEqual({ kind: "marker", id });
      expect(await page.evaluate(() => (window as unknown as Win).__fe.chart.element.style.cursor)).toBe("pointer");
    }
    // Click and double-click on a marker.
    const sell = await markerPoint(page, "m-sell");
    const sp = await pagePoint(page, sell.x, sell.y);
    await page.mouse.click(sp.x, sp.y);
    expect((await lastEvent(page, "click"))?.hovered).toEqual({ kind: "marker", id: "m-sell" });
    await page.mouse.dblclick(sp.x, sp.y);
    expect((await lastEvent(page, "dblclick"))?.hovered).toEqual({ kind: "marker", id: "m-sell" });
    // Empty space: no hovered.
    const empty = await pagePoint(page, 40, 40);
    await page.mouse.move(empty.x, empty.y);
    expect((await lastEvent(page, "crosshairMove"))?.hovered).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("markers: a time that is not a bar throws naming the marker and changes nothing", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const before = fe.candles.markers().length;
      const t = fe.bars.time[10]! + 1;
      let msg = "";
      try {
        fe.candles.setMarkers([{ time: fe.bars.time[10]!, position: "aboveBar", shape: "circle", color: "#fff" }, { time: t, position: "aboveBar", shape: "circle", color: "#fff", id: "stray" }]);
      } catch (e) {
        msg = String(e);
      }
      let dup = "";
      try {
        fe.candles.setMarkers([{ time: fe.bars.time[10]!, position: "aboveBar", shape: "circle", color: "#fff", id: "x" }, { time: fe.bars.time[11]!, position: "aboveBar", shape: "circle", color: "#fff", id: "x" }]);
      } catch (e) {
        dup = String(e);
      }
      const kept = fe.candles.markers().length;
      fe.candles.setMarkers([]);
      const cleared = fe.candles.markers().length;
      return { before, msg, dup, kept, cleared };
    });
    expect(r.before).toBe(5);
    expect(r.msg).toContain('marker "stray"');
    expect(r.dup).toContain("id is used by another marker");
    expect(r.kept).toBe(5);
    expect(r.cleared).toBe(0);
  });

  test("primitives: hit ids surface as hovered with their cursor; background draws only when asked", async ({ page }) => {
    await open(page);
    const pts = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const v = fe.band.view!;
      const x0 = v.timeToX(fe.band.t0), y1 = v.y(fe.band.high), y2 = v.y(fe.band.low);
      return { inBand: { x: x0 - 40, y: (y1 + y2) / 2 }, inSpan: { x: x0 + 20, y: 12 }, y1, y2 };
    });
    let p = await pagePoint(page, pts.inBand.x, pts.inBand.y);
    await page.mouse.move(p.x, p.y);
    expect((await lastEvent(page, "crosshairMove"))?.hovered).toEqual({ kind: "primitive", id: "band" });
    expect(await page.evaluate(() => (window as unknown as Win).__fe.chart.element.style.cursor)).toBe("ns-resize");
    p = await pagePoint(page, pts.inSpan.x, pts.inSpan.y);
    await page.mouse.move(p.x, p.y);
    expect((await lastEvent(page, "crosshairMove"))?.hovered).toEqual({ kind: "primitive", id: "span" });
    await page.mouse.click(p.x, p.y);
    expect((await lastEvent(page, "click"))?.hovered).toEqual({ kind: "primitive", id: "span" });

    // The band is on the background layer, behind the candles: the bg canvas holds the fill, the series canvas does not.
    const draws = (): Promise<number> => page.evaluate(() => (window as unknown as Win).__fe.band.bgDraws);
    const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await settle();
    const base = await draws();
    await page.evaluate(() => (window as unknown as Win).__fe.band.host!.requestRender());
    await settle();
    expect(await draws()).toBe(base); // overlay (default) does not repaint the background
    await page.evaluate(() => (window as unknown as Win).__fe.band.host!.requestRender("background"));
    await settle();
    expect(await draws()).toBe(base + 1);
    await page.evaluate(() => (window as unknown as Win).__fe.band.host!.requestRender("all"));
    await settle();
    expect(await draws()).toBe(base + 2);
    expect(await page.evaluate(() => { try { (window as unknown as Win).__fe.band.host!.requestRender("gl" as never); return ""; } catch (e) { return String(e); } })).toContain("requestRender layer");
  });

  test("the band is painted behind the series: its pixels on the bg canvas, not on the overlay", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const v = fe.band.view!;
      // Just inside the band's lower edge, clear of the price lines.
      const x = Math.round(v.timeToX(fe.band.t0) - 30), y = Math.round(v.y(fe.band.low) - 3);
      const [bg, , overlay] = [...fe.chart.element.querySelectorAll("canvas")] as HTMLCanvasElement[];
      const px = (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(x, y, 1, 1).data;
      return { bg: [...px(bg!)], overlay: [...px(overlay!)] };
    });
    expect(r.bg[2]).toBeGreaterThan(r.bg[0]!); // the blue-ish band over the dark background
    expect(r.overlay[3]).toBe(0);
  });

  test("pane view: timeToX is fractional and extrapolated like the plugin API; barSpacing is the chart's", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const v = fe.band.view!;
      const t = fe.bars.time, n = t.length;
      const chart = fe.chart;
      const px = (time: number) => chart.timeToX(time)!;
      return {
        exact: [v.timeToX(t[n - 20]!), px(t[n - 20]!)],
        half: [v.timeToX((t[n - 20]! + t[n - 19]!) / 2), (px(t[n - 20]!) + px(t[n - 19]!)) / 2],
        beyond: [v.timeToX(t[n - 1]! + 5 * 60_000), px(t[n - 1]!) + chart.timeScale.barSpacing()],
        spacing: [v.barSpacing, chart.timeScale.barSpacing()],
      };
    });
    expect(r.exact[0]).toBeCloseTo(r.exact[1]!, 6);
    expect(r.half[0]).toBeCloseTo(r.half[1]!, 6);
    expect(r.beyond[0]).toBeCloseTo(r.beyond[1]!, 6);
    expect(r.spacing[0]).toBe(r.spacing[1]);
    expect(r.spacing[0]).toBeGreaterThan(0);
  });

  test("coordinates: price -> y -> price within half a tick; NaN with no range; pane and axis widths", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const s = fe.candles;
      let worst = 0;
      const lo = Math.min(...fe.bars.low), hi = Math.max(...fe.bars.high);
      for (let k = 0; k <= 20; k++) {
        const p = lo + ((hi - lo) * k) / 20 + 0.0137;
        worst = Math.max(worst, Math.abs(s.coordinateToPrice(s.priceToCoordinate(p)) - p));
      }
      const empty = fe.createChart(document.createElement("div"), {});
      const e = empty.addSeries("line");
      const nan = [e.priceToCoordinate(10), e.coordinateToPrice(10)];
      const chart = fe.chart;
      const el = chart.element;
      const out = {
        worst, tick: 0.05, nan,
        paneWidth: chart.paneWidth(), right: chart.priceAxisWidth("right"), left: chart.priceAxisWidth("left"), width: el.clientWidth,
      };
      empty.remove();
      return out;
    });
    expect(r.worst).toBeLessThanOrEqual(r.tick / 2);
    expect(r.nan.every(Number.isNaN)).toBe(true);
    expect(r.left).toBe(0);
    expect(r.right).toBeGreaterThanOrEqual(96); // rightPriceScale.minWidth
    expect(r.paneWidth).toBe(r.width - r.right - r.left);
    expect(await page.evaluate(() => { try { (window as unknown as Win).__fe.chart.priceAxisWidth("top" as never); return ""; } catch (e) { return String(e); } })).toContain("priceAxisWidth");
  });

  test("minWidth: applies to the axis and a lower value gives the width back", async ({ page }) => {
    await open(page);
    const w = async (min: number) => {
      await page.evaluate((m) => { (window as unknown as Win).__fe.chart.priceScale("right").applyOptions({ minWidth: m }); }, min);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return page.evaluate(() => (window as unknown as Win).__fe.chart.priceAxisWidth("right"));
    };
    expect(await w(150)).toBeGreaterThanOrEqual(150);
    expect(await w(0)).toBeLessThan(150);
    expect(await page.evaluate(() => { try { (window as unknown as Win).__fe.chart.priceScale("right").applyOptions({ minWidth: -1 }); return ""; } catch (e) { return String(e); } })).toContain("minWidth");
  });

  test("autoscale override keeps the far price line on screen; without it the line leaves the pane", async ({ page }) => {
    await open(page);
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const y = () => page.evaluate(() => { const fe = (window as unknown as Win).__fe; return [fe.candles.priceToCoordinate(fe.farPrice), fe.chart.element.clientHeight]; });
    const [y1, h] = (await y()) as [number, number];
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(h);
    await page.evaluate(() => (window as unknown as Win).__fe.candles.applyOptions({ autoscale: undefined as never }));
    await frame();
    const [y2] = (await y()) as [number, number];
    expect(y2).toBeLessThan(0);
    // A null return contributes nothing; a bad return throws.
    const bad = await page.evaluate(async () => {
      const fe = (window as unknown as Win).__fe;
      fe.candles.applyOptions({ autoscale: () => ({ low: 5, high: 1 }) });
      const errs: string[] = [];
      window.addEventListener("error", (e) => errs.push(e.message));
      await new Promise((r) => setTimeout(r, 100));
      return errs.join(" ");
    });
    expect(bad).toContain("autoscale must return");
  });

  test("price lines: width 1 or 2 only; every style is accepted; axisLabelColor and styles are kept", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const bad = (o: object) => { try { fe.chart.createPriceLine(fe.candles, { price: 1, ...o }); return ""; } catch (e) { return String(e); } };
      return {
        styles: fe.lines.map((l) => l.options().lineStyle),
        label: fe.lines[1]!.options().axisLabelColor,
        w3: bad({ lineWidth: 3 }), w15: bad({ lineWidth: 1.5 }), style: bad({ lineStyle: "wavy" }),
        count: fe.chart.series().length,
      };
    });
    expect(r.styles.slice(0, 5)).toEqual(["solid", "dashed", "dotted", "large-dashed", "sparse-dotted"]);
    expect(r.label).toBe("#1b5e20");
    expect(r.w3).toContain("lineWidth must be 1 or 2");
    expect(r.w15).toContain("lineWidth");
    expect(r.style).toContain("lineStyle");
  });

  test("timeFormat: the keyboard readout of the crosshair time uses the given Intl options", async ({ page }) => {
    await open(page);
    await page.locator("[aria-roledescription=chart]").focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(300); // the readout is throttled to one per 250 ms
    await page.keyboard.press("Shift+ArrowLeft");
    const r = await page.evaluate(() => {
      const c = (window as unknown as Win).__fe.chart as unknown as Internals & { element: HTMLElement };
      const i = c.crosshairIndex()!;
      const t = c.timeline.timeAt(i);
      const expected = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
      return { expected, live: c.element.querySelector("[aria-live]")!.textContent };
    });
    expect(r.live).toContain(r.expected);
    // A timeZone inside timeFormat is refused, and a refused change changes nothing.
    const err = await page.evaluate(() => {
      const chart = (window as unknown as Win).__fe.chart;
      try { chart.applyOptions({ timeFormat: { timeZone: "UTC" } }); return ""; } catch (e) { return String(e); }
    });
    expect(err).toContain("timeZone");
    expect(await page.evaluate(() => (window as unknown as Win).__fe.chart.options().timeFormat?.month)).toBe("short");
  });

  test("options: grid and crosshair.priceLabel round-trip through applyOptions and saveState", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const chart = (window as unknown as Win).__fe.chart;
      const a = chart.options();
      const before = { grid: { ...a.grid }, priceLabel: a.crosshair.priceLabel };
      chart.applyOptions({ grid: { vertLines: true }, crosshair: { priceLabel: true } });
      const b = chart.options();
      const saved = chart.saveState().options as { grid: object; crosshair: { priceLabel: boolean }; timeFormat: { month: string } };
      return { before, after: { grid: { ...b.grid }, priceLabel: b.crosshair.priceLabel }, saved: { grid: saved.grid, timeFormat: saved.timeFormat.month } };
    });
    expect(r.before).toEqual({ grid: { vertLines: false, horzLines: true }, priceLabel: false });
    expect(r.after).toEqual({ grid: { vertLines: true, horzLines: true }, priceLabel: true });
    expect(r.saved).toEqual({ grid: { vertLines: true, horzLines: true }, timeFormat: "short" });
  });

  test("a shorter setData before the next frame does not break pointer handling; a non-function autoscale is refused", async ({ page }) => {
    const errors = await open(page);
    const pt = await pagePoint(page, 300, 200);
    await page.evaluate(() => {
      const fe = (window as unknown as Win).__fe;
      const d = fe.bars, n = 20;
      // Replace the 240 bars by 20 and probe the chart before any frame runs.
      fe.candles.setData({ time: d.time.slice(0, n), open: d.open.slice(0, n), high: d.high.slice(0, n), low: d.low.slice(0, n), close: d.close.slice(0, n) });
      (fe.chart as unknown as Internals & { primitiveCursor(p: number, x: number, y: number): string | null }).primitiveCursor(0, 300, 200);
    });
    await page.mouse.move(pt.x, pt.y);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => { try { (window as unknown as Win).__fe.candles.applyOptions({ autoscale: true as never }); return ""; } catch (e) { return String(e); } })).toContain("autoscale must be a function");
  });
});
