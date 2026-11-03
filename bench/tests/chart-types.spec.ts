// @alphacharts/chart-types in the browser.
//
// Snapshots: each chart type on the fixed-seed synthetic market at DPR 1 and 2,
// zero tolerance, with the crosshair parked on a bar (so the readout label for
// the event-based types is part of the picture). Update deliberately with
// `pnpm visual --update-snapshots`.
//
// Renderer parity: the same type drawn by WebGL and by Canvas2D (&renderer=
// canvas2d) must put the same marks in the same places. The types built from
// integer-snapped rectangles must match exactly, where "exactly" forgives
// one device pixel (WebGL rounds a Float32 position, Canvas2D a Float64 one, so
// an edge on a half-pixel tie can land a row apart); the anti-aliased ones
// (lines, dots, glyphs, gradients) get a small budget of pixels without a
// counterpart within a pixel, per type below. A missing or misplaced mark fails
// either way.
//
// Readouts: a crosshair over an event-based chart resolves the bar's true source
// time range, and its time axis shows bar numbers, never a date.

import { expect, test, type Page } from "@playwright/test";

const TYPES = [
  "baseline", "step-line", "columns", "hi-lo", "ohlc-dots", "line-markers", "heikin-ashi",
  "renko", "renko-atr", "kagi", "point-figure", "range", "line-break", "tick", "volume", "dollar",
] as const;

/** Types on the ordinal axis (everything but the time-based ones and Heikin-Ashi). */
const EVENT = new Set(["renko", "renko-atr", "kagi", "point-figure", "range", "line-break", "tick", "volume", "dollar"]);

/**
 * Parity budget: the share of pixels (of the whole cell) with no match within a
 * pixel in the other renderer's image. 0 where both snap every edge to whole
 * device pixels, larger where anti-aliasing differs between the two paths.
 */
const PARITY: Record<string, number> = {
  "hi-lo": 0, columns: 0, renko: 0, "renko-atr": 0, "line-break": 0, kagi: 0,
  baseline: 0.0008, "step-line": 0.0006, "line-markers": 0.0016, "ohlc-dots": 0.0012, "point-figure": 0.002,
  "heikin-ashi": 0, range: 0, tick: 0, volume: 0, dollar: 0,
};

async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  expect(errors).toEqual([]);
}

for (const dpr of [1, 2]) {
  test.describe(`chart types, DPR ${dpr}`, () => {
    test.use({ viewport: { width: 900, height: 520 }, deviceScaleFactor: dpr });

    for (const id of TYPES) {
      test(`${id} snapshot`, async ({ page }) => {
        await open(page, `ex=chart-types&type=${id}`);
        await page.mouse.move(450, 260);
        await page.waitForTimeout(50);
        await expect(page.locator("#app")).toHaveScreenshot(`${id}-dpr${dpr}.png`, { maxDiffPixels: 0 });
      });
    }

    test("all types in one grid", async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      await open(page, "ex=chart-types");
      await expect(page.locator("#app")).toHaveScreenshot(`grid-dpr${dpr}.png`, { maxDiffPixels: 0 });
    });
  });
}

/**
 * Share of pixels with no counterpart within one pixel in the other image
 * (channels within 40), taking the worse direction. A mark that is missing or
 * more than a pixel off counts; a half-pixel tie that moves an edge by one
 * device pixel (Float32 vs Float64 rounding) does not. Computed in the page.
 */
async function diffShare(page: Page, a: Buffer, b: Buffer): Promise<{ share: number; bad: number; total: number }> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const [p, q] = [await load(x!), await load(y!)];
      if (p.width !== q.width || p.height !== q.height) throw new Error(`size ${p.width}x${p.height} vs ${q.width}x${q.height}`);
      const W = p.width, H = p.height;
      const near = (u: number, v: number, a: ImageData, b: ImageData) => {
        const i = (v * W + u) * 4;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const uu = u + dx, vv = v + dy;
            if (uu < 0 || vv < 0 || uu >= W || vv >= H) continue;
            const j = (vv * W + uu) * 4;
            if (Math.abs(a.data[i]! - b.data[j]!) <= 40 && Math.abs(a.data[i + 1]! - b.data[j + 1]!) <= 40 && Math.abs(a.data[i + 2]! - b.data[j + 2]!) <= 40) return true;
          }
        }
        return false;
      };
      let ab = 0, ba = 0;
      for (let v = 0; v < H; v++) {
        for (let u = 0; u < W; u++) {
          if (!near(u, v, p, q)) ab++;
          if (!near(u, v, q, p)) ba++;
        }
      }
      const bad = Math.max(ab, ba), total = W * H;
      return { share: bad / total, bad, total };
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

test.describe("WebGL vs Canvas2D", () => {
  for (const dpr of [1, 2]) {
    test.describe(`DPR ${dpr}`, () => {
      test.use({ viewport: { width: 900, height: 520 }, deviceScaleFactor: dpr });
      for (const id of TYPES) {
        test(`${id} draws the same marks`, async ({ page }) => {
          await open(page, `ex=chart-types&type=${id}&renderer=webgl`);
          const gl = await page.locator("#app").screenshot();
          await open(page, `ex=chart-types&type=${id}&renderer=canvas2d`);
          const c2d = await page.locator("#app").screenshot();
          const d = await diffShare(page, gl, c2d);
          expect(d.share, `${d.bad} of ${d.total} pixels differ`).toBeLessThanOrEqual(PARITY[id]!);
        });
      }
    });
  }
});

test.describe("event-based charts do not show a time that did not happen", () => {
  test.use({ viewport: { width: 900, height: 520 }, deviceScaleFactor: 1 });
  for (const id of TYPES.filter((t) => EVENT.has(t))) {
    test(`${id}: the crosshair resolves to a true source time range and the axis reads bar numbers`, async ({ page }) => {
      await open(page, `ex=chart-types&type=${id}`);
      // The keyboard puts the crosshair on a bar wherever the data ends, and announces it for screen readers.
      // The chart throttles announcements to one per 250 ms from page start; let that pass.
      await page.waitForTimeout(300);
      await page.locator("#app [role=application]").focus();
      await page.keyboard.press("Shift+ArrowLeft");
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const cell = window.__ct![0]!;
        const label = document.querySelector("[data-ct-label]")!.textContent ?? "";
        // The screen-reader line the chart announces under the crosshair.
        const live = cell.chart.element.querySelector("[aria-live]")?.textContent ?? "";
        const first = cell.store!.fromTime[0]!, last = cell.store!.toTime[cell.store!.length - 1]!;
        return { label, live, first, last };
      });
      const m = /source (\S+ \S+) → (\S+ \S+) UTC/.exec(r.label);
      expect(m, r.label).not.toBeNull();
      const from = Date.parse(m![1]!.replace(" ", "T") + "Z"), to = Date.parse(m![2]!.replace(" ", "T") + "Z");
      expect(from).toBeLessThanOrEqual(to);
      // Whole seconds: the label drops milliseconds.
      expect(from).toBeGreaterThanOrEqual(Math.floor(r.first / 1000) * 1000);
      expect(to).toBeLessThanOrEqual(r.last);
      expect(r.live).toMatch(/^bar \d+/);
      expect(r.live).not.toMatch(/19\d\d|1970/);
    });
  }
});
