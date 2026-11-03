// Locales in a real browser. Snapshots (zero tolerance): the i18n example in
// English, Hindi and Arabic (right-to-left shell, left-to-right chart).
// Behaviour: switching locale updates the chart's aria label, the
// screen-reader table and readout, and the document language and direction.

import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });

type W = { __setLocale(l: string): Promise<void>; __i18nFallbacks: string[] };

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  return errors;
}

for (const [name, locale, dir] of [["en", "en", "ltr"], ["hi-IN", "hi-IN", "ltr"], ["ar", "ar", "rtl"]] as const) {
  test(`i18n snapshot: ${name} (${dir})`, async ({ page }) => {
    const errors = await open(page, `ex=i18n&locale=${locale}&n=3000`);
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    // Nothing on screen came from the English fallback (Arabic is a sample).
    expect(await page.evaluate(() => (window as unknown as W).__i18nFallbacks)).toEqual([]);
    // A cold browser can still be laying out (fonts, first resize) when the page reports ready.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.mouse.move(500, 400);
    await page.waitForTimeout(100);
    await expect(page.locator("#app")).toHaveScreenshot(`i18n-${name}.png`, { maxDiffPixels: 0 });
    expect(errors).toEqual([]);
  });
}

test("switching locale updates aria labels, the screen-reader table and readout, lang and dir", async ({ page }) => {
  const errors = await open(page, "ex=i18n&locale=en&n=3000");
  const root = page.locator("[aria-roledescription=chart]");
  const table = page.locator("[aria-roledescription=chart] table");
  const live = page.locator("[aria-live=polite]");

  await expect(root).toHaveAttribute("aria-label", "Price chart");
  await expect(table.locator("caption")).toHaveText("Price chart: NIFTY, visible bars, newest first");
  await expect(table.locator("thead th")).toHaveText(["Time", "Open", "High", "Low", "Close"]);

  await root.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(live).toContainText(/NIFTY open \d+\.\d\d high \d+\.\d\d low \d+\.\d\d close \d+\.\d\d/);

  await page.evaluate(() => (window as unknown as W).__setLocale("hi-IN"));
  await expect(root).toHaveAttribute("aria-label", "मूल्य चार्ट");
  await expect(table.locator("caption")).toHaveText("मूल्य चार्ट: NIFTY, दिखाई दे रहे बार, नवीनतम पहले");
  await expect(table.locator("thead th")).toHaveText(["समय", "ओपन", "हाई", "लो", "क्लोज़"]);
  await expect(page.locator("html")).toHaveAttribute("lang", "hi-IN");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(300);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(live).toContainText(/NIFTY ओपन \d+\.\d\d हाई \d+\.\d\d लो \d+\.\d\d क्लोज़ \d+\.\d\d/);

  // Numbers are the same figures in every locale (Latin digits, same decimals).
  const row = await table.locator("tbody tr").first().locator("td").allTextContents();
  expect(row).toHaveLength(4);
  for (const c of row) expect(c).toMatch(/^\d+\.\d\d$/);

  await page.evaluate(() => (window as unknown as W).__setLocale("ar"));
  await expect(root).toHaveAttribute("aria-label", "مخطط الأسعار");
  await expect(table.locator("thead th")).toHaveText(["الوقت", "الافتتاح", "الأعلى", "الأدنى", "الإغلاق"]);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.evaluate(() => (window as unknown as W).__setLocale("en"));
  await expect(root).toHaveAttribute("aria-label", "Price chart");
  await expect(table.locator("thead th")).toHaveText(["Time", "Open", "High", "Low", "Close"]);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  expect(await page.evaluate(() => (window as unknown as W).__i18nFallbacks)).toEqual([]);
  expect(errors).toEqual([]);
});
