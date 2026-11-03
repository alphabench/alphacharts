// Visual regression and pixel fidelity.
//
// Snapshots: fixed-seed playground examples at DPR 1 and 2, compared with
// zero tolerance. Update deliberately with `pnpm visual --update-snapshots`.
//
// Alignment: reads the WebGL buffer straight after a synchronous render and
// checks, for every candle on screen, that the body and wick edges are hard
// (no partially covered pixel) and that the wick is centred on the body.

import { expect, test, type Page } from "@playwright/test";

const EXAMPLES = ["basic", "panes", "types", "scales"] as const;

async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  expect(errors).toEqual([]);
}

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 900, height: 520 }, deviceScaleFactor: dpr });

    for (const ex of EXAMPLES) {
      test(`${ex} snapshot`, async ({ page }) => {
        await open(page, `ex=${ex}&n=3000`);
        await page.mouse.move(450, 260);
        await page.waitForTimeout(50);
        await expect(page.locator("#app")).toHaveScreenshot(`${ex}-dpr${dpr}.png`, { maxDiffPixels: 0 });
      });
    }

    test("light theme snapshot", async ({ page }) => {
      await open(page, "ex=basic&n=3000&theme=light");
      await expect(page.locator("#app")).toHaveScreenshot(`basic-light-dpr${dpr}.png`, { maxDiffPixels: 0 });
    });

    for (const spacing of [3, 6, 7.5, 11, 24]) {
      test(`candle pixel alignment at ${spacing}px spacing`, async ({ page }) => {
        await open(page, "ex=big&n=5000");
        const r = await page.evaluate((spacing) => {
          const c = window.__charts[0] as unknown as {
            time: { spacing: number; x(i: number): number; first: number; last: number };
            layers: { surface: { gl: WebGL2RenderingContext } }; leftW: number; panes: { top: number; height: number }[];
            viewChanged(fn: () => void): void; render(l: number): void;
            panes0: unknown;
          };
          c.viewChanged(() => {
            c.time.spacing = spacing;
          });
          c.render(7);
          const gl = c.layers.surface.gl;
          const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
          const px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const alpha = (x: number, y: number) => px[((H - 1 - y) * W + x) * 4 + 3]!;
          const dpr = window.devicePixelRatio;
          const p = c.panes[0]!;
          const y0 = Math.ceil(p.top * dpr), y1 = Math.floor((p.top + p.height) * dpr);
          let soft = 0, checked = 0, offCentre = 0;
          const details: unknown[] = [];
          // Each column belongs to at most one candle at these spacings; walk
          // candles by index and inspect their device-pixel columns.
          for (let i = c.time.last - 2; i > c.time.last - 40; i--) {
            const cx = (c.leftW + c.time.x(i)) * dpr;
            const lo = Math.floor(cx - spacing * dpr / 2) + 1, hi = Math.ceil(cx + spacing * dpr / 2) - 1;
            // Candles cut by the pane edge cannot be judged for centring.
            if (lo <= Math.ceil(c.leftW * dpr) || hi >= W - 1) continue;
            // Per row: the span of fully covered columns. The widest span is
            // the body, the narrowest the wick.
            let body: [number, number] | null = null, wick: [number, number] | null = null;
            for (let y = y0; y < y1; y++) {
              let l = Infinity, r = -Infinity;
              for (let x = Math.max(0, lo); x <= Math.min(W - 1, hi); x++) {
                const a = alpha(x, y);
                if (a !== 0 && a !== 255) soft++;
                if (a === 255) { l = Math.min(l, x); r = Math.max(r, x); }
              }
              if (r < l) continue;
              if (!body || r - l > body[1] - body[0]) body = [l, r];
              if (!wick || r - l < wick[1] - wick[0]) wick = [l, r];
            }
            if (!body || !wick || wick[1] - wick[0] >= body[1] - body[0]) continue;
            checked++;
            if (body[0] + body[1] !== wick[0] + wick[1]) {
              offCentre++;
              details.push({ i, body, wick });
            }
          }
          return { soft, checked, offCentre, details: details.slice(0, 3) };
        }, spacing);
        expect(r.soft).toBe(0);
        expect(r.offCentre, JSON.stringify(r.details)).toBe(0);
        if (spacing >= 6) expect(r.checked).toBeGreaterThan(10);
      });
    }
  });
}
