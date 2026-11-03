// Ad-hoc: pan/zoom frame times with N drawings on the chart (not an acceptance
// gate: the GPU is shared). node drawings-perf.mjs [N=500]
import { chromium } from "@playwright/test";

const N = Number(process.argv[2] ?? 500);
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--window-position=-2400,0", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });

async function run(stress) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${process.env.AC_PORT ?? 5199}/?ex=drawings&catalog=0&stress=${stress}&n=20000`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });
  const count = await page.evaluate(() => window.__drawings.list().length);
  const r = await page.evaluate(async () => {
    const c = window.__charts[0];
    const cpu = [];
    const orig = c.render.bind(c);
    c.render = (l, n) => { const t0 = performance.now(); orig(l, n); cpu.push(performance.now() - t0); };
    const last = c.time.last;
    const ts = [];
    const frames = 600;
    await new Promise((resolve) => {
      let k = 0;
      const f = (t) => {
        ts.push(t);
        // zoom between 150 and 900 visible bars while panning back and forth over 3000 bars
        const phase = k / frames;
        const width = 150 + 750 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 4));
        const centre = last - 1500 - 1400 * Math.sin(phase * Math.PI * 2);
        c.timeScale.setVisibleLogicalRange({ from: centre - width / 2, to: centre + width / 2 });
        if (++k < frames) requestAnimationFrame(f); else resolve();
      };
      requestAnimationFrame(f);
    });
    const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
    const s = [...cpu].sort((a, b) => a - b);
    return { frames: d.length, p50: q(d, 0.5), p95: q(d, 0.95), p99: q(d, 0.99), max: d[d.length - 1], over16: d.filter((x) => x > 16.7).length, missed: d.filter((x) => x > 1.5 * q(d, 0.5)).length, cpuP50: q(s, 0.5), cpuP95: q(s, 0.95), cpuMax: s[s.length - 1] };
  });
  await page.close();
  const f = (x) => Math.round(x * 10) / 10;
  return { drawings: count, errors, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? f(v) : v])) };
}

console.table([await run(0), await run(N)]);
await browser.close();
