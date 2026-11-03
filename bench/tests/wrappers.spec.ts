// The React, Vue and Svelte wrappers in real browsers, through their example
// apps (apps/example-*): each page has a candles + volume chart with a price
// line and a live stream, and a four-cell synced dashboard. The pages record
// every chart they make in window.__charts (apps/example-shared/track.ts).
//
//   renders       zero-tolerance screenshot of the stream held still (?auto=0)
//   live ticks    the stream reaches the last bar through series.update() only
//   remount x20   unmount -> mount twenty times: no canvas, chart, global
//                 listener or ResizeObserver target is left behind

import { expect, test, type Page } from "@playwright/test";

const APPS = [
  { name: "react", port: Number(process.env.AC_PORT_REACT ?? 5207) },
  { name: "vue", port: Number(process.env.AC_PORT_VUE ?? 5208) },
  { name: "svelte", port: Number(process.env.AC_PORT_SVELTE ?? 5209) },
] as const;

/** One standalone chart plus the four dashboard cells. */
const CHARTS = 5;
/** The standalone chart owns bg + gl + overlay; the dashboard shares one such set. */
const CANVASES = 6;

test.use({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });

type C = {
  isRemoved: boolean;
  series(): { range(): { first: number; last: number } | undefined; barAt(t: number): { time: number; close?: number; value?: number } | undefined; setData(d: unknown): void; update(b: unknown): void }[];
  timeline: { timeAt(i: number): number };
};
declare global {
  interface Window {
    __charts: C[];
    __tick(n: number): Promise<void>;
    __mount(): void;
    __unmount(): void;
    __counters: { listeners: number; observed(): number };
  }
}

/**
 * Counts what outlives a chart: listeners on window, document and media query
 * lists (the long-lived targets a chart can leak onto) and ResizeObserver
 * targets. Installed before any page script runs.
 */
const INSTALL_COUNTERS = () => {
  const counters = { listeners: 0, observed: () => 0 };
  window.__counters = counters;
  const ids = new WeakMap<object, number>();
  let next = 0;
  const idOf = (fn: object) => ids.get(fn) ?? (ids.set(fn, ++next), next);
  const store = new Map<EventTarget, Set<string>>();
  const global = (t: EventTarget) => t === window || t === document || t instanceof MediaQueryList;
  const sig = (type: string, fn: object, o: unknown) => `${type}|${idOf(fn)}|${(typeof o === "boolean" ? o : (o as { capture?: boolean } | undefined)?.capture) ? 1 : 0}`;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
    if (fn && global(this)) {
      const set = store.get(this) ?? new Set<string>();
      store.set(this, set);
      const s = sig(type, fn, o);
      if (!set.has(s)) {
        set.add(s);
        counters.listeners++;
      }
    }
    return add.call(this, type, fn, o);
  } as typeof add;
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
    if (fn && store.get(this)?.delete(sig(type, fn, o))) counters.listeners--;
    return remove.call(this, type, fn, o);
  } as typeof remove;

  const targets = new Map<ResizeObserver, Set<Element>>();
  counters.observed = () => [...targets.values()].reduce((n, s) => n + s.size, 0);
  const RO = window.ResizeObserver;
  window.ResizeObserver = class extends RO {
    override observe(t: Element, o?: ResizeObserverOptions) {
      const set = targets.get(this) ?? new Set<Element>();
      targets.set(this, set.add(t));
      super.observe(t, o);
    }
    override unobserve(t: Element) {
      targets.get(this)?.delete(t);
      super.unobserve(t);
    }
    override disconnect() {
      targets.delete(this);
      super.disconnect();
    }
  };
};

async function open(page: Page, port: number, query = "auto=0") {
  const problems: string[] = [];
  // WebKit keeps a removed chart's WebGL context until garbage collection and
  // warns past its cap (about 8 cycles here). Core alone does the same: 20 x
  // (createChart + Dashboard) then remove() with no wrapper logs the identical
  // warning. Chrome and Firefox are held to none.
  const webkit = test.info().project.name === "visual-webkit";
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => {
    const text = m.text();
    const contexts = /too many active webgl contexts|loseContext: context already lost/i.test(text);
    // (The favicon request is a 404 on every dev server.)
    if ((m.type() === "error" && !text.includes("404") && !(webkit && contexts)) || (!webkit && contexts)) problems.push(text);
  });
  await page.addInitScript(INSTALL_COUNTERS);
  await page.goto(`http://127.0.0.1:${port}/?${query}`);
  await settled(page);
  return problems;
}

/** Every chart made, with data on every series, and two frames drawn. */
async function settled(page: Page) {
  await page.waitForFunction(
    (n) => {
      const live = window.__charts.filter((c) => !c.isRemoved);
      return live.length === n && live.every((c) => c.series().length > 0 && c.series().every((s) => s.range()));
    },
    CHARTS,
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const snapshotOf = (page: Page) =>
  page.evaluate(() => ({
    canvases: document.querySelectorAll("canvas").length,
    live: window.__charts.filter((c) => !c.isRemoved).length,
    made: window.__charts.length,
    listeners: window.__counters.listeners,
    observed: window.__counters.observed(),
  }));

for (const { name, port } of APPS) {
  test.describe(name, () => {
    test("renders", async ({ page }) => {
      const problems = await open(page, port);
      const s = await snapshotOf(page);
      expect(s.canvases).toBe(CANVASES);
      expect(s.live).toBe(CHARTS);
      await expect(page.locator("#app")).toHaveScreenshot(`${name}.png`, { maxDiffPixels: 0 });
      expect(problems).toEqual([]);
    });

    test("live ticks reach the last bar through series.update, never setData", async ({ page }) => {
      const problems = await open(page, port);
      type Last = { count: number; time: number; close: number; vol: number };
      const last = () =>
        page.evaluate((): Last => {
          const c = window.__charts.find((c) => !c.isRemoved && c.series().length === 2)!;
          const [candles, volume] = c.series() as [C["series"] extends () => (infer S)[] ? S : never, C["series"] extends () => (infer S)[] ? S : never];
          const r = candles.range()!;
          const time = c.timeline.timeAt(r.last);
          return { count: r.last - r.first + 1, time, close: candles.barAt(time)!.close!, vol: volume.barAt(time)?.value ?? NaN };
        });
      // Count what reaches core, on the real series.
      await page.evaluate(() => {
        const c = window.__charts.find((c) => !c.isRemoved && c.series().length === 2)!;
        const calls = ((window as unknown as { __calls: Record<string, number> }).__calls = { setData: 0, update: 0 });
        for (const s of c.series()) {
          for (const m of ["setData", "update"] as const) {
            const orig = s[m].bind(s) as (x: unknown) => void;
            s[m] = (x: unknown) => {
              calls[m]++;
              orig(x);
            };
          }
        }
      });
      const before = await last();
      await page.evaluate(() => window.__tick(3));
      const mid = await last();
      expect(mid.count).toBe(before.count);
      expect(mid.time).toBe(before.time);
      expect(mid.close).not.toBe(before.close);
      expect(mid.vol).not.toBe(before.vol);
      // The 20th tick overall opens the next minute.
      await page.evaluate(() => window.__tick(17));
      const after = await last();
      expect(after.count).toBe(before.count + 1);
      expect(after.time).toBeGreaterThan(before.time);
      await expect(page.locator("#stat")).toHaveText("20 ticks");
      const calls = await page.evaluate(() => (window as unknown as { __calls: Record<string, number> }).__calls);
      // Two series, twenty ticks, one update() each.
      expect(calls).toEqual({ setData: 0, update: 40 });
      expect(problems).toEqual([]);
    });

    test("unmount and remount twenty times leaves nothing behind", async ({ page }) => {
      test.setTimeout(120_000);
      const problems = await open(page, port);
      const first = await snapshotOf(page);
      expect(first.canvases).toBe(CANVASES);
      expect(first.live).toBe(CHARTS);

      // Unmounted once, to learn what the page itself holds with no charts.
      await page.evaluate(async () => {
        window.__unmount();
        await new Promise((r) => setTimeout(r, 50));
      });
      const empty = await snapshotOf(page);
      expect(empty.canvases).toBe(0);
      expect(empty.live).toBe(0);
      expect(empty.observed).toBe(0);

      for (let i = 0; i < 20; i++) {
        await page.evaluate(() => window.__mount());
        await settled(page);
        const mounted = await snapshotOf(page);
        expect(mounted.canvases).toBe(CANVASES);
        expect(mounted.live).toBe(CHARTS);
        // Back to exactly what one mounted page holds: no growth from cycle to cycle.
        expect(mounted.listeners).toBe(first.listeners);
        expect(mounted.observed).toBe(first.observed);
        await page.evaluate(async () => {
          window.__unmount();
          await new Promise((r) => setTimeout(r, 50));
        });
        const gone = await snapshotOf(page);
        expect(gone.canvases).toBe(0);
        expect(gone.live).toBe(0);
        expect(gone.listeners).toBe(empty.listeners);
        expect(gone.observed).toBe(0);
      }
      // Charts made over 21 mounts (React's StrictMode makes two per mount): every one but none is removed.
      const end = await snapshotOf(page);
      expect(end.made).toBeGreaterThanOrEqual(CHARTS * 21);
      expect(end.live).toBe(0);
      expect(problems).toEqual([]);
    });
  });
}
