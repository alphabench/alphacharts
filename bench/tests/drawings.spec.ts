// Drawings in a real browser: a snapshot of every tool (zero tolerance, DPR 1
// and 2), real-mouse creation/selection/editing, anchoring across data
// changes, and layout persistence.
//
// Snapshots: `pnpm visual --update-snapshots` records them; run again without
// to prove they are stable.

import { expect, test, type Page } from "@playwright/test";

const GROUPS = ["lines", "channels", "fibonacci", "gann", "shapes", "annotations", "trading", "patterns"] as const;

type Anchor = { time: number; price: number };
type Drawing = { id: string; tool: string; anchors: Anchor[]; props: Record<string, unknown> };
interface Plugin {
  list(): Drawing[];
  selection(): string[];
  setTool(id: string | null): void;
  activeTool(): string | null;
  add(spec: { tool: string; anchors: Anchor[]; props?: Record<string, unknown> }): Drawing;
  clear(): void;
  anchorAt(pane: number, x: number, y: number): Anchor;
  pixelOf(pane: number, a: Anchor): { x: number; y: number };
  hitTest(pane: number, x: number, y: number): { id: string; handle: number | null } | null;
  setMagnet(m: "off" | "weak" | "strong"): void;
  toJSON(): unknown;
  canUndo: boolean;
}

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__ready === true);
  return errors;
}

const call = <T>(page: Page, fn: (p: Plugin) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__drawings)`) as Promise<T>;

for (const dpr of [1, 2]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });

    for (const g of GROUPS) {
      test(`catalog ${g}`, async ({ page }) => {
        const errors = await open(page, `ex=drawings&catalog=${g}`);
        expect(await page.evaluate(() => (window as unknown as { __catalog: number }).__catalog)).toBeGreaterThan(5);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(50);
        await expect(page.locator("#app")).toHaveScreenshot(`drawings-${g}-dpr${dpr}.png`, { maxDiffPixels: 0 });
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe("interaction", () => {
  test.use({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });

  /** Page coordinates of a pane pixel. */
  const at = async (page: Page, x: number, y: number) => {
    const b = (await page.locator("#app").boundingBox())!;
    return { x: b.x + x, y: b.y + y };
  };

  async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    const a = await at(page, from.x, from.y), b = await at(page, to.x, to.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  }

  test("create a trend line by dragging, select, edit a handle, undo/redo, delete, copy/paste", async ({ page }) => {
    const errors = await open(page, "ex=drawings&catalog=0");
    const A = { x: 300, y: 400 }, B = { x: 600, y: 200 };

    // create: press "t" (the playground shortcut), drag
    await page.keyboard.press("t");
    expect(await call(page, (p) => p.activeTool())).toBe("trendLine");
    await drag(page, A, B);
    let list = await call(page, (p) => p.list());
    expect(list).toHaveLength(1);
    const line = list[0]!;
    const px = await call(page, (p) => p.list().map((d) => d.anchors.map((a) => p.pixelOf(0, a))));
    expect(px[0]![0]!.x).toBeCloseTo(A.x, 6);
    expect(px[0]![0]!.y).toBeCloseTo(A.y, 6);
    expect(px[0]![1]!.x).toBeCloseTo(B.x, 6);
    expect(px[0]![1]!.y).toBeCloseTo(B.y, 6);
    expect(await call(page, (p) => p.selection())).toEqual([line.id]);
    expect(await call(page, (p) => p.activeTool())).toBeNull();

    // deselect (click empty space), then select by clicking the line
    const empty = await at(page, 900, 600);
    await page.mouse.click(empty.x, empty.y);
    expect(await call(page, (p) => p.selection())).toEqual([]);
    const mid = await at(page, 450, 300);
    await page.mouse.click(mid.x, mid.y);
    expect(await call(page, (p) => p.selection())).toEqual([line.id]);

    // move the second anchor by its handle
    await drag(page, B, { x: B.x + 80, y: B.y + 60 });
    list = await call(page, (p) => p.list());
    expect(list[0]!.anchors[0]).toEqual(line.anchors[0]);
    const moved = await call(page, (p) => p.pixelOf(0, p.list()[0]!.anchors[1]!));
    expect(moved.x).toBeCloseTo(B.x + 80, 6);
    expect(moved.y).toBeCloseTo(B.y + 60, 6);

    // undo / redo
    await page.keyboard.press("Control+z");
    expect(await call(page, (p) => p.list()[0]!.anchors)).toEqual(line.anchors);
    await page.keyboard.press("Control+Shift+z");
    expect((await call(page, (p) => p.list()[0]!.anchors))[1]).toEqual(list[0]!.anchors[1]);

    // copy / paste at the pointer
    await page.keyboard.press("Control+c");
    const target = await at(page, 700, 500);
    await page.mouse.move(target.x, target.y);
    await page.keyboard.press("Control+v");
    list = await call(page, (p) => p.list());
    expect(list).toHaveLength(2);
    const pasted = await call(page, (p) => p.pixelOf(0, p.list()[1]!.anchors[0]!));
    expect(pasted.x).toBeCloseTo(700, 6);
    expect(pasted.y).toBeCloseTo(500, 6);

    // delete the pasted copy (it is selected), then undo brings it back
    await page.keyboard.press("Delete");
    expect(await call(page, (p) => p.list().length)).toBe(1);
    await page.keyboard.press("Control+z");
    expect(await call(page, (p) => p.list().length)).toBe(2);
    expect(errors).toEqual([]);
  });

  test("a press on empty space still pans the chart; a press on a drawing does not", async ({ page }) => {
    await open(page, "ex=drawings&catalog=0");
    await call(page, (p) => void p.add({ tool: "horizontalLine", anchors: [p.anchorAt(0, 100, 300)] }));
    const left = () => page.evaluate(() => (window.__charts[0] as unknown as { time: { left: number } }).time.left);
    const l0 = await left();
    await drag(page, { x: 500, y: 450 }, { x: 600, y: 450 });
    // kinetic scrolling settles: wait until two reads agree
    let l1 = await left();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      const l = await left();
      if (l === l1) break;
      l1 = l;
    }
    expect(l1).not.toBe(l0);
    // autoscale moved with the pan: find the line where it is now
    const y = await call(page, (p) => p.pixelOf(0, p.list()[0]!.anchors[0]!).y);
    await drag(page, { x: 500, y }, { x: 600, y }); // on the horizontal line: it is dragged, the view is not
    await page.waitForTimeout(300);
    expect(await left()).toBe(l1);
  });

  test("Escape cancels a drawing in progress", async ({ page }) => {
    await open(page, "ex=drawings&catalog=0");
    await call(page, (p) => p.setTool("rectangle"));
    const a = await at(page, 300, 300);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press("Escape");
    const b = await at(page, 500, 450);
    await page.mouse.click(b.x, b.y);
    expect(await call(page, (p) => p.list().length)).toBe(0);
  });

  test("magnet (strong) puts anchors on a bar's exact high, low, open or close", async ({ page }) => {
    await open(page, "ex=drawings&catalog=0");
    await call(page, (p) => { p.setMagnet("strong"); p.setTool("horizontalLine"); });
    const a = await at(page, 640, 333);
    await page.mouse.click(a.x, a.y);
    const r = await page.evaluate(() => {
      const p = window.__drawings as unknown as Plugin;
      const anchor = p.list()[0]!.anchors[0]!;
      const bar = (window.__source as unknown as { nearest(t: number): { time: number; open: number; high: number; low: number; close: number } }).nearest(anchor.time)!;
      return { anchor, bar };
    });
    expect(r.anchor.time).toBe(r.bar.time);
    expect([r.bar.open, r.bar.high, r.bar.low, r.bar.close]).toContain(r.anchor.price);
  });

  test("drawings keep their time and price when history is prepended or the data is replaced", async ({ page }) => {
    await open(page, "ex=drawings&catalog=0");
    const made = await call(page, (p) => {
      const a = p.anchorAt(0, 300, 300), b = p.anchorAt(0, 700, 150);
      p.add({ tool: "trendLine", anchors: [a, b] });
      p.add({ tool: "fibRetracement", anchors: [p.anchorAt(0, 400, 450), p.anchorAt(0, 600, 250)] });
      return p.list();
    });
    const barOf = (t: number) => page.evaluate((t) => (window.__series as unknown as { barAt(t: number): unknown }).barAt(t), t);
    const barsBefore = await Promise.all(made.map((d) => barOf(d.anchors[0]!.time)));
    const hit = (d: Drawing) => call(page, ((p: Plugin) => p) as never).then(() => page.evaluate((a) => {
      const p = window.__drawings as unknown as Plugin;
      const px = p.pixelOf(0, a);
      return p.hitTest(0, px.x, px.y)?.id ?? null;
    }, d.anchors[0]!));

    await page.evaluate(() => (window as unknown as { __prepend(k: number): void }).__prepend(2500));
    await page.waitForTimeout(100);
    const after = await call(page, (p) => p.list());
    expect(after.map((d) => d.anchors)).toEqual(made.map((d) => d.anchors)); // exact time + price, untouched
    expect(await Promise.all(made.map((d) => barOf(d.anchors[0]!.time)))).toEqual(barsBefore); // and the time still names the same bar
    for (const d of made) expect(await hit(d)).toBe(d.id);

    // replace the whole series with the same data
    await page.evaluate(() => {
      const w = window as unknown as { __series: { setData(d: unknown): void }; __data: unknown };
      w.__series.setData(w.__data);
    });
    await page.waitForTimeout(100);
    expect((await call(page, (p) => p.list())).map((d) => d.anchors)).toEqual(made.map((d) => d.anchors));
    for (const d of made) expect(await hit(d)).toBe(d.id);
  });

  test("layout save and restore keeps drawings", async ({ page }) => {
    const errors = await open(page, "ex=drawings&catalog=0");
    await call(page, (p) => {
      p.add({ tool: "trendLine", anchors: [p.anchorAt(0, 300, 300), p.anchorAt(0, 700, 150)] });
      p.add({ tool: "longPosition", anchors: [p.anchorAt(0, 400, 400), p.anchorAt(0, 600, 300), p.anchorAt(0, 600, 450)], props: { accountSize: 100000, riskPercent: 1, lotSize: 1 } });
    });
    const before = await call(page, (p) => p.toJSON());
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify((window.__charts[0] as unknown as { saveState(): unknown }).saveState())));
    expect((saved as { plugins: Record<string, unknown> }).plugins.drawings).toEqual(before);

    await call(page, (p) => p.clear());
    expect(await call(page, (p) => p.list().length)).toBe(0);
    await page.evaluate((st) => {
      const w = window as unknown as { __charts: Array<{ restoreState(s: unknown, o: { data: () => unknown }): unknown }>; __data: unknown };
      w.__charts[0]!.restoreState(st, { data: () => w.__data });
    }, saved);
    expect(await call(page, (p) => p.toJSON())).toEqual(before);
    // and they are on screen: a hit at an anchor
    const hit = await call(page, (p) => {
      const px = p.pixelOf(0, p.list()[0]!.anchors[0]!);
      return p.hitTest(0, px.x, px.y)?.id;
    });
    expect(hit).toBe((before as { drawings: Drawing[] }).drawings[0]!.id);
    expect(errors).toEqual([]);
  });
});
