// Order flow: footprint, session volume profile, TPO and CVD on the synthetic
// tape of the `orderflow` playground example.
//
// Snapshots: fixed-seed tape, DPR 1 and 2, compared with zero tolerance. The
// fixed tape is the same on every browser, so any difference is the renderer's.
// Behaviour: live trades change the newest bar's cells and the CVD exactly
// (the numbers are read back from the flow and from what the overlay prints).

import { expect, test, type Page } from "@playwright/test";

type Flow = {
  approximate: boolean;
  bars: {
    length: number; lastTradeTime: number; tickSize: number;
    start: Float64Array; close: Float64Array; buy: Float64Array; sell: Float64Array; unknown: Float64Array; trades: Float64Array;
    grids: { get(k: number, col: number): number }[];
    delta(i: number): number; cvdClose(i: number): number; volume(i: number): number;
  };
  add(t: { time: number; price: number; size: number; side: string }): void;
};
type Of = {
  flow: Flow;
  push(n: number): void;
  footprint: { series: { barAt(t: number): { close: number } | undefined }; overlay: { last: { lod: string; texts: number } } };
};
declare global {
  interface Window {
    __of?: Of;
    __texts?: string[];
  }
}

const errors = new WeakMap<Page, string[]>();

async function open(page: Page, query: string): Promise<void> {
  const errs: string[] = [];
  errors.set(page, errs);
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  expect(errs).toEqual([]);
}

/** Record every string the overlay prints during one forced render of chart 0. */
async function printed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const real = proto.fillText;
    const seen: string[] = [];
    proto.fillText = function (this: CanvasRenderingContext2D, text: string, ...rest: [number, number]) {
      seen.push(text);
      return real.call(this, text, ...rest);
    };
    try {
      (window.__charts[0] as unknown as { render(l: number): void }).render(7);
    } finally {
      proto.fillText = real;
    }
    return seen;
  });
}

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: dpr });

    test("footprint, session profile, CVD, delta and TPO", async ({ page }) => {
      await open(page, "ex=orderflow");
      // These pictures are about the cells and profiles: no crosshair. (Element
      // screenshots scroll content and the browser then fires pointer events at
      // wherever the content moved, which put one in at random.)
      await page.evaluate(() => window.__charts.forEach((c) => c.applyOptions({ crosshair: { visible: false } })));
      await page.waitForTimeout(50);
      await expect(page.locator("#app")).toHaveScreenshot(`orderflow-dpr${dpr}.png`, { maxDiffPixels: 0 });
    });

    test("zoomed out: shaded candles, labelled", async ({ page }) => {
      await open(page, "ex=orderflow");
      await page.evaluate(() => {
        const c = window.__charts[0] as unknown as { timeScale: { setVisibleLogicalRange(r: { from: number; to: number }): void }; timeToLogical(t: number): number };
        const of = window.__of!;
        const last = of.flow.bars.length - 1;
        const L = c.timeToLogical(of.flow.bars.start[last]!);
        c.timeScale.setVisibleLogicalRange({ from: L - 150, to: L + 2 });
      });
      // These pictures are about the cells and profiles: no crosshair. (Element
      // screenshots scroll content and the browser then fires pointer events at
      // wherever the content moved, which put one in at random.)
      await page.evaluate(() => window.__charts.forEach((c) => c.applyOptions({ crosshair: { visible: false } })));
      await page.waitForTimeout(50);
      await expect(page.locator("#app")).toHaveScreenshot(`orderflow-zoomed-dpr${dpr}.png`, { maxDiffPixels: 0 });
    });

    test("from bars only: approximation is drawn and labelled", async ({ page }) => {
      await open(page, "ex=orderflow&approx=1");
      // These pictures are about the cells and profiles: no crosshair. (Element
      // screenshots scroll content and the browser then fires pointer events at
      // wherever the content moved, which put one in at random.)
      await page.evaluate(() => window.__charts.forEach((c) => c.applyOptions({ crosshair: { visible: false } })));
      await page.waitForTimeout(50);
      await expect(page.locator("#app")).toHaveScreenshot(`orderflow-approx-dpr${dpr}.png`, { maxDiffPixels: 0 });
    });
  });
}

// Cell edges and profile rows come from the price scale's y(), so the footprint, the
// session profile and the TPO draw on every scale mode (the pictures are the proof).
test.describe("price scale modes", () => {
  test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  const modes: { name: string; options: Record<string, unknown> }[] = [
    { name: "log", options: { mode: "log" } },
    { name: "percent", options: { mode: "percent" } },
    { name: "indexed", options: { mode: "indexed" } },
    { name: "inverted", options: { invert: true } },
    { name: "log-inverted", options: { mode: "log", invert: true } },
  ];
  for (const m of modes) {
    test(`footprint, profile and TPO on a ${m.name} scale`, async ({ page }) => {
      await open(page, "ex=orderflow");
      await page.evaluate((o) => {
        for (const c of window.__charts) {
          c.applyOptions({ crosshair: { visible: false } });
          (c as unknown as { priceScale(id: string): { applyOptions(o: object): void } }).priceScale("right").applyOptions(o);
        }
      }, m.options);
      await page.waitForTimeout(50);
      expect(await page.evaluate(() => window.__of!.footprint.overlay.last.lod)).toBe("cells");
      expect((await printed(page)).length).toBeGreaterThan(20); // the cells print their numbers
      await expect(page.locator("#app")).toHaveScreenshot(`orderflow-scale-${m.name}.png`, { maxDiffPixels: 0 });
      expect(errors.get(page)).toEqual([]);
    });
  }
});

test.describe("behaviour", () => {
  test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });

  test("live trades update the newest bar's cells and the CVD exactly", async ({ page }) => {
    await open(page, "ex=orderflow");
    const r = await page.evaluate(() => {
      const of = window.__of!, b = of.flow.bars;
      const i = b.length - 1;
      const price = b.close[i]!, tick = b.tickSize;
      const t = Math.max(b.lastTradeTime, b.start[i]!) + 1;
      const lvl = price / tick;
      const before = { buy: b.grids[i]!.get(lvl, 0), sell: b.grids[i]!.get(lvl, 1), delta: b.delta(i), cvd: b.cvdClose(i), unk: b.unknown[i]!, trades: b.trades[i]!, level: lvl };
      // 7 bought, 3 sold at the close price, 11 of unknown side one tick higher.
      of.flow.add({ time: t, price, size: 7, side: "buy" });
      of.flow.add({ time: t + 1, price, size: 3, side: "sell" });
      of.flow.add({ time: t + 2, price: price + tick, size: 11, side: "unknown" });
      return { i, price, lvl, tick, before, after: { buy: b.grids[i]!.get(lvl, 0), sell: b.grids[i]!.get(lvl, 1), unkLevel: b.grids[i]!.get(lvl + 1, 2), delta: b.delta(i), cvd: b.cvdClose(i), unk: b.unknown[i]!, trades: b.trades[i]!, close: b.close[i]!, start: b.start[i]! } };
    });
    expect(r.after.buy).toBe(r.before.buy + 7);
    expect(r.after.sell).toBe(r.before.sell + 3);
    expect(r.after.delta).toBe(r.before.delta + 4);
    expect(r.after.cvd).toBe(r.before.cvd + 4);
    expect(r.after.unk).toBe(r.before.unk + 11); // unknown side: counted, never added to a side or to delta
    expect(r.after.trades).toBe(r.before.trades + 3);
    expect(r.after.close).toBe(r.price + r.tick); // the last trade (unknown side) was one tick up
    // The chart series follow: footprint close is the last trade's price, CVD candle close is the flow's.
    const seen = await page.evaluate((start) => {
      const of = window.__of!, b = of.flow.bars;
      const cvd = (window.__charts[0] as unknown as { series(): { options(): { title: string }; barAt(t: number): { close: number } | undefined }[] }).series().find((s) => s.options().title === "CVD")!;
      return { fpClose: of.footprint.series.barAt(start)!.close, lastClose: b.close[b.length - 1]!, cvdClose: cvd.barAt(start)!.close, cvdFlow: b.cvdClose(b.length - 1) };
    }, r.after.start);
    expect(seen.fpClose).toBe(seen.lastClose);
    expect(seen.cvdClose).toBe(seen.cvdFlow);
    expect(seen.cvdClose).toBe(r.before.cvd + 4);
    // What the overlay prints on that level is the new sum.
    await page.waitForTimeout(50);
    const texts = await printed(page);
    expect(texts).toContain(String(r.after.sell));
    expect(texts).toContain(String(r.after.buy));
    expect(texts.some((s) => s.startsWith("Δ"))).toBe(true);
    expect(errors.get(page)).toEqual([]);
  });

  test("a trade older than the last is rejected and changes nothing", async ({ page }) => {
    await open(page, "ex=orderflow");
    const r = await page.evaluate(() => {
      const of = window.__of!, b = of.flow.bars;
      const snapshot = () => [b.length, b.volume(b.length - 1), b.cvdClose(b.length - 1)];
      const before = snapshot();
      let msg = "";
      try {
        of.flow.add({ time: b.lastTradeTime - 1, price: b.close[b.length - 1]!, size: 1, side: "buy" });
      } catch (e) {
        msg = String(e);
      }
      return { before, after: snapshot(), msg };
    });
    expect(r.msg).toMatch(/older than the previous trade/);
    expect(r.after).toEqual(r.before);
  });

  test("zoomed out it falls back to shaded candles and says so", async ({ page }) => {
    await open(page, "ex=orderflow");
    expect(await page.evaluate(() => window.__of!.footprint.overlay.last.lod)).toBe("cells");
    const texts0 = await printed(page);
    expect(texts0.some((s) => s.includes("Zoom in for footprint cells"))).toBe(false);
    await page.evaluate(() => {
      const c = window.__charts[0] as unknown as { timeScale: { setVisibleLogicalRange(r: { from: number; to: number }): void } };
      c.timeScale.setVisibleLogicalRange({ from: 0, to: 80 });
    });
    const texts = await printed(page);
    expect(await page.evaluate(() => window.__of!.footprint.overlay.last.lod)).toBe("shaded");
    expect(texts.some((s) => s.includes("Zoom in for footprint cells"))).toBe(true);
  });

  test("from bars only, every footprint draws the APPROXIMATE label", async ({ page }) => {
    await open(page, "ex=orderflow&approx=1");
    expect(await page.evaluate(() => window.__of!.flow.approximate)).toBe(true);
    const texts = await printed(page);
    expect(texts.some((s) => s.startsWith("APPROXIMATE"))).toBe(true);
    expect(texts.some((s) => s.startsWith("Δ"))).toBe(false); // no delta without sides
  });

  test("the Canvas2D fallback draws the same footprint", async ({ page }) => {
    await open(page, "ex=orderflow&renderer=canvas2d");
    expect(await page.evaluate(() => (window.__charts[0] as unknown as { renderer: string }).renderer)).toBe("canvas2d");
    expect(await page.evaluate(() => window.__of!.footprint.overlay.last.lod)).toBe("cells");
    const texts = await printed(page);
    expect(texts.length).toBeGreaterThan(20);
    expect(errors.get(page)).toEqual([]);
  });
});
