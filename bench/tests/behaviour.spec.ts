// Behaviour in a real browser: datafeed paging, sync, keyboard + screen
// reader readout, live updates and WebGL context loss.

import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });

type C = {
  time: { left: number; right: number; first: number; last: number; spacing: number };
  timeline: { timeAt(i: number): number; lowerBound(t: number): number; indexAtOrBefore(t: number): number | undefined };
  timeScale: { setVisibleLogicalRange(r: { from: number; to: number }): void; scrollToStart(): void };
  element: HTMLElement;
  layers: { surface: { gl: WebGL2RenderingContext } };
    render(l: number): void;
};

async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  (page as unknown as { errors: string[] }).errors = errors;
}
const errorsOf = (page: Page) => (page as unknown as { errors: string[] }).errors;

test("datafeed pages older history as the view reaches the left edge, then stops", async ({ page }) => {
  await open(page, "ex=feed&n=9000");
  const count = () => page.evaluate(() => { const c = window.__charts[0] as unknown as C; return c.time.last - c.time.first + 1; });
  await expect.poll(count).toBe(2000);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => (window.__charts[0] as unknown as C).timeScale.scrollToStart());
    await page.waitForTimeout(250);
  }
  await expect.poll(count, { timeout: 5000 }).toBe(9000);
  // Every bar is in order and none is duplicated.
  const ok = await page.evaluate(() => {
    const c = window.__charts[0] as unknown as C;
    for (let i = c.time.first + 1; i <= c.time.last; i++) if (!(c.timeline.timeAt(i) > c.timeline.timeAt(i - 1))) return false;
    return true;
  });
  expect(ok).toBe(true);
  await expect(page.locator(".stat")).toContainText("all history");
  expect(errorsOf(page)).toEqual([]);
});

test("a SyncGroup puts each follower on its bar containing the leader's time", async ({ page }) => {
  // 1-minute and 5-minute charts side by side: indices differ, times must not.
  await open(page, "ex=synced&n=20000&k=4&mixed=1");
  const r = await page.evaluate(async () => {
    const cs = window.__charts as unknown as C[];
    cs[0]!.timeScale.setVisibleLogicalRange({ from: 15_000, to: 15_607.3 });
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const lead = cs[0]!;
    const t = lead.timeline.timeAt(Math.floor(lead.time.right));
    return {
      t,
      followers: cs.slice(1).map((c) => {
        const i = Math.floor(c.time.right);
        return { start: c.timeline.timeAt(i), next: c.timeline.timeAt(i + 1), spacing: c.time.spacing };
      }),
      spacing: lead.time.spacing,
    };
  });
  for (const f of r.followers) {
    expect(f.start).toBeLessThanOrEqual(r.t);
    expect(f.next).toBeGreaterThan(r.t);
    expect(f.spacing).toBeCloseTo(r.spacing, 9);
  }
});

test("keyboard: arrows pan, Shift+arrow steps the crosshair and announces the bar", async ({ page }) => {
  await open(page, "ex=basic&n=5000");
  const root = page.locator("[aria-roledescription=chart]");
  await expect(root).toHaveAttribute("aria-label", "Price chart");
  await root.focus();
  const right0 = await page.evaluate(() => (window.__charts[0] as unknown as C).time.right);
  await page.keyboard.press("ArrowLeft");
  const right1 = await page.evaluate(() => (window.__charts[0] as unknown as C).time.right);
  expect(right1).toBeLessThan(right0);
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Shift+ArrowRight");
  const live = page.locator("[aria-live=polite]");
  await expect(live).toContainText(/SYNTH open \d+\.\d\d high \d+\.\d\d low \d+\.\d\d close \d+\.\d\d/);
});

test("live bars update in place, append, and keep the view on the newest bar", async ({ page }) => {
  await open(page, "ex=live&n=5000&auto=0");
  const before = await page.evaluate(() => { const c = window.__charts[0] as unknown as C; return { last: c.time.last, x: c.time.right - c.time.last }; });
  await page.evaluate(() => window.__tick!(599));
  const mid = await page.evaluate(() => (window.__charts[0] as unknown as C).time.last);
  expect(mid).toBe(before.last); // same minute: replaced, not appended
  await page.evaluate(() => window.__tick!(1200)); // 1,799 ticks: appends at 600 and 1,200
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => { const c = window.__charts[0] as unknown as C; return { last: c.time.last, x: c.time.right - c.time.last }; });
  expect(after.last).toBe(before.last + 2);
  expect(after.x).toBeCloseTo(before.x, 9); // still following
  expect(errorsOf(page)).toEqual([]);
});

test("a lost WebGL context is rebuilt from the CPU data", async ({ page }) => {
  await open(page, "ex=basic&n=3000");
  const painted = () =>
    page.evaluate(() => {
      const c = window.__charts[0] as unknown as C;
      c.render(7);
      const gl = c.layers.surface.gl;
      const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) n++;
      return n;
    });
  const n0 = await painted();
  expect(n0).toBeGreaterThan(1000);
  // A lost context returns null from getExtension: keep the handle.
  await page.evaluate(() => {
    const ext = (window.__charts[0] as unknown as C).layers.surface.gl.getExtension("WEBGL_lose_context")!;
    (window as unknown as { __ext: WEBGL_lose_context }).__ext = ext;
    ext.loseContext();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => (window as unknown as { __ext: WEBGL_lose_context }).__ext.restoreContext());
  await page.waitForTimeout(200);
  expect(await painted()).toBe(n0);
  expect(errorsOf(page)).toEqual([]);
});
