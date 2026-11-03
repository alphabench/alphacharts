// The indicators package in a real browser: pixel snapshots of the study
// example, live ticks against a batch recompute, and layout save/restore.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  return errors;
}

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: dpr });

    test("indicators snapshot", async ({ page }) => {
      const errors = await open(page, "ex=indicators&n=3000");
      await page.mouse.move(450, 260);
      await page.waitForTimeout(50);
      await expect(page.locator("#app")).toHaveScreenshot(`indicators-dpr${dpr}.png`, { maxDiffPixels: 0 });
      expect(errors).toEqual([]);
    });
  });
}

test.describe("behaviour", () => {
  test.use({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });

  test("live ticks leave every study equal to a batch recompute", async ({ page }) => {
    const errors = await open(page, "ex=indicators&n=5000");
    expect(await page.evaluate(() => window.__studies!.length)).toBe(10);
    expect(await page.evaluate(() => window.__verify!())).toBe(0);
    // 400 ticks = 8 new bars plus many revisions of each
    await page.evaluate(() => window.__tick!(400));
    expect(await page.evaluate(() => window.__verify!())).toBe(0);
    const lengths = await page.evaluate(() => window.__studies!.map((s) => s.times().length));
    expect(new Set(lengths).size).toBe(1);
    expect(lengths[0]).toBe(5008);
    expect(errors).toEqual([]);
  });

  test("batch in a Web Worker equals the inline batch, ticks continue after", async ({ page }) => {
    const errors = await open(page, "ex=indicators&n=5000&worker=1");
    expect(await page.evaluate(() => window.__verify!())).toBe(0);
    await page.evaluate(() => window.__tick!(120));
    expect(await page.evaluate(() => window.__verify!())).toBe(0);
    expect(errors).toEqual([]);
  });

  test("a layout one study cannot be rebuilt from is refused before anything is replaced", async ({ page }) => {
    const errors = await open(page, "ex=indicators&n=3000");
    const r = await page.evaluate(() => {
      const bad = JSON.parse(JSON.stringify(window.__save!())) as { series: { id: string }[]; plugins: Record<string, { studies: { source: string }[] }> };
      bad.plugins["alphacharts.studies"]!.studies[3]!.source = "no-such-series";
      const before = window.__charts[0]!.series().map((x) => x.options().id);
      let err = "";
      try { window.__restore!(bad); } catch (e) { err = String(e); }
      return { err, same: JSON.stringify(window.__charts[0]!.series().map((x) => x.options().id)) === JSON.stringify(before), studies: window.__studies!.length, verify: window.__verify!() };
    });
    expect(r.err).toMatch(/needs series "no-such-series"/);
    expect(r.same).toBe(true); // the chart still holds the series it had
    expect(r.studies).toBe(10);
    expect(r.verify).toBe(0);
    expect(errors).toEqual([]);
  });

  test("layout save and restore keeps the studies", async ({ page }) => {
    const errors = await open(page, "ex=indicators&n=3000");
    const before = await page.evaluate(() => {
      const state = JSON.parse(JSON.stringify(window.__save!())) as { series: { id: string }[]; plugins: Record<string, { studies: { id: string; study: string }[] }> };
      return { ids: state.series.map((s) => s.id), studies: state.plugins["alphacharts.studies"]!.studies.map((s) => `${s.id}:${s.study}`) };
    });
    expect(before.studies).toHaveLength(10);
    const after = await page.evaluate(() => {
      const state = JSON.parse(JSON.stringify(window.__save!()));
      window.__restore!(state);
      const again = JSON.parse(JSON.stringify(window.__save!())) as { series: { id: string }[]; plugins: Record<string, { studies: { id: string; study: string }[] }> };
      return { ids: again.series.map((s) => s.id), studies: again.plugins["alphacharts.studies"]!.studies.map((s) => `${s.id}:${s.study}`), verify: window.__verify!() };
    });
    expect(after.studies).toEqual(before.studies);
    expect(after.ids.sort()).toEqual(before.ids.sort());
    expect(after.verify).toBe(0);
    // and the restored studies still follow ticks
    await page.evaluate(() => window.__tick!(60));
    expect(await page.evaluate(() => window.__verify!())).toBe(0);
    expect(errors).toEqual([]);
  });
});
