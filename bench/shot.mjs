// Ad-hoc screenshot: node shot.mjs "<query>" out.png [w] [h] [dpr]
import { chromium } from "@playwright/test";

const [query = "ex=basic", out = "shot.png", w = "1280", h = "720", dpr = "2"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-position=-2400,0"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${process.env.AC_PORT ?? 5199}/?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 }).catch(() => errors.push("not ready"));
if (process.env.HOVER) {
  const [x, y] = process.env.HOVER.split(",").map(Number);
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
}
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors, stat: await page.locator(".stat").textContent() }));
await browser.close();
