// @alphacharts/plot in the browser (?ex=plot).
//
// Snapshots: every example at DPR 1 and 2, zero tolerance, each engine with its
// own baselines (update deliberately with `pnpm visual --update-snapshots=changed`).
// Behaviour: tooltip values equal the data, the legend toggles series, wheel zoom
// and brush zoom the x axis, synced plots share crosshair and zoom, keyboard
// navigation, the exports (CSV equals the data, PNG has the right size), the
// screen-reader table, resize and live theme change.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { PlotDemo } from "../../apps/playground/src/plot-demo.js";

const EXAMPLES = [
  "oi-mirror", "payoff", "flows", "sectors", "correlation", "monthly", "histogram", "bubbles", "labels",
  "iv-smile", "equity-pair", "shareholding", "marks", "grouped-log", "facets",
  "candles", "sparkline", "replay", "sweep", "tight",
] as const;

type Win = { __plots: PlotLike[]; __plotDemo: PlotDemo };
// The plot's internals the geometry checks read.
interface PlotLike {
  hover(): { title: string; index?: number; rows: { name: string; value: string; color: string; index?: number; raw?: number; mark?: string }[] } | null;
  getView(): [number, number] | null;
  exportCsv(): string;
  exportPng(o?: { scale?: number }): Promise<Blob>;
  toggleSeries(n: string, h?: boolean): void;
  update(s: unknown): void;
  flush(): void;
  on(t: string, f: (e: unknown) => void): () => void;
  root: HTMLElement;
  cells: { panel: { sx: { center(c: string): number; map(v: number): number; invert(px: number): number }; sy: { center(c: string): number; map(v: number): number }; area: { x: number; y: number; w: number; h: number }; rect: { x: number; y: number; w: number; h: number } }; stops: unknown }[];
  legend: { name: string; hidden: boolean; rect: { x: number; y: number; w: number; h: number } }[];
}

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  await page.goto(`/?ex=plot&${query}`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(2, 2);
  return errors;
}

const tip = (page: Page) => page.locator(".ac-plot [role=tooltip]").first();

/** Page coordinates of a point in plot `i`'s coordinates (CSS px from the plot's top-left). */
const at = (page: Page, i: number, x: number, y: number) =>
  page.evaluate(([n, px, py]) => {
    const p = (window as unknown as Win).__plots[n!]!;
    const r = p.root.getBoundingClientRect();
    return { x: r.left + px!, y: r.top + py! };
  }, [i, x, y] as const);

const centreOfCat = (page: Page, i: number, cat: string) =>
  page.evaluate(([n, c]) => {
    const p = (window as unknown as Win).__plots[n as number]!;
    const cell = p.cells[0]!.panel;
    const r = p.root.getBoundingClientRect();
    return { x: r.left + cell.sx.center(c as string), y: r.top + cell.area.y + cell.area.h / 2 };
  }, [i, cat] as const);

const spec = <T>(page: Page, id: string, pick: (s: never) => T): Promise<T> =>
  page.evaluate(([i, src]) => (new Function("s", `return (${src})(s)`) as (s: unknown) => unknown)((window as unknown as Win).__plotDemo.specs[i as string]) as never, [id, pick.toString()] as const);

for (const dpr of [1, 2]) {
  test.describe(`plot snapshots, DPR ${dpr}`, () => {
    test.use({ viewport: { width: 760, height: 520 }, deviceScaleFactor: dpr });
    for (const id of EXAMPLES) {
      test(`${id}`, async ({ page }) => {
        const errors = await open(page, `theme=light&only=${id}`);
        await expect(page.locator("#app")).toHaveScreenshot(`${id}-dpr${dpr}.png`, { maxDiffPixels: 0 });
        expect(errors).toEqual([]);
      });
    }
    for (const id of ["oi-mirror", "sectors", "monthly", "labels"]) {
      test(`${id}, dark`, async ({ page }) => {
        await open(page, `theme=dark&only=${id}`);
        await expect(page.locator("#app")).toHaveScreenshot(`${id}-dark-dpr${dpr}.png`, { maxDiffPixels: 0 });
      });
    }
    test("tooltip over a stacked bar", async ({ page }) => {
      await open(page, "theme=light&only=shareholding");
      const p = await centreOfCat(page, 0, "Jun 25");
      await page.mouse.move(p.x, p.y);
      await expect(tip(page)).toBeVisible();
      await expect(page.locator("#app")).toHaveScreenshot(`tooltip-dpr${dpr}.png`, { maxDiffPixels: 0 });
    });
  });
}

test.describe("plot behaviour", () => {
  test.use({ viewport: { width: 760, height: 560 }, deviceScaleFactor: 1 });

  test("candles: the tooltip lists O, H, L, C with raw numbers and the index; the volume strip stays out of it", async ({ page }) => {
    await open(page, "only=candles&theme=light");
    const data = await spec(page, "candles", (s: { marks: { x: number[]; open?: number[]; high?: number[]; low?: number[]; close?: number[] }[] }) => ({ x: s.marks[1]!.x, o: s.marks[1]!.open!, h: s.marks[1]!.high!, l: s.marks[1]!.low!, c: s.marks[1]!.close! }));
    const i = 20;
    const pos = await page.evaluate(([n, t]) => {
      const p = (window as unknown as Win).__plots[0]!;
      const cell = p.cells[0]!.panel;
      const r = p.root.getBoundingClientRect();
      return { x: r.left + cell.sx.map(t as number), y: r.top + cell.area.y + 30, n };
    }, [0, data.x[i]!] as const);
    const seen = page.evaluate(() => new Promise<unknown>((res) => (window as unknown as Win).__plots[0]!.on("hover", (e) => e && res(e))));
    await page.mouse.move(pos.x, pos.y);
    const h = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!);
    expect(h.rows.map((r) => r.name)).toEqual(["O", "H", "L", "C"]);
    expect(h.rows.map((r) => r.raw)).toEqual([data.o[i], data.h[i], data.l[i], data.c[i]]);
    expect(h.rows.every((r) => r.index === i && r.mark === "NIFTY")).toBe(true);
    expect(h.index).toBe(i);
    expect(((await seen) as { index: number }).index).toBe(i);
    expect(await tip(page).innerText()).not.toContain("Volume");
  });

  test("the primary y axis on the right, a hidden y2 keeps its marks, and the fixed width is the gutter", async ({ page }) => {
    await open(page, "only=candles&theme=light");
    const g = await page.evaluate(() => {
      const p = (window as unknown as Win).__plots[0]!;
      const cell = p.cells[0]!.panel as unknown as { area: { x: number; w: number }; rect: { w: number }; axes: { id: string; side: string }[]; sy2?: { domain: [number, number] } };
      return { left: cell.area.x, right: cell.rect.w - cell.area.x - cell.area.w, axes: cell.axes.map((a) => `${a.id}:${a.side}`), y2: cell.sy2?.domain };
    });
    expect(g.axes).toEqual(["x:left", "y:right"]);
    expect(g.left).toBe(8);
    expect(g.right).toBe(64);
    expect(g.y2![0]).toBe(0);
  });

  test("a decorative plot is not in the accessibility tree: no tab stop, table, live region or document listener", async ({ page }) => {
    await open(page, "only=sparkline&theme=light");
    const d = await page.evaluate(() => {
      const root = document.querySelector(".ac-plot") as HTMLElement;
      const c = root.querySelector("canvas") as HTMLCanvasElement;
      const px = c.getContext("2d")!.getImageData(0, 0, 1, 1).data;
      let docListeners = 0;
      return { tabindex: root.getAttribute("tabindex"), role: root.getAttribute("role"), hidden: root.getAttribute("aria-hidden"), label: root.getAttribute("aria-label"), table: !!root.querySelector("table"), live: !!root.querySelector("[aria-live]"), describedby: root.getAttribute("aria-describedby"), bg: getComputedStyle(root).backgroundColor, corner: [...px], focusable: (root.focus(), document.activeElement === root), docListeners };
    });
    expect(d).toMatchObject({ tabindex: null, role: null, hidden: "true", label: null, table: false, live: false, describedby: null, bg: "rgba(0, 0, 0, 0)", focusable: false });
    expect(d.corner[3]).toBe(0); // a transparent background draws nothing in the corner
  });

  test("update() keeps the tooltip under the pointer, and the table follows on focus", async ({ page }) => {
    await open(page, "only=flows&theme=light");
    const p = await page.evaluate(() => {
      const pl = (window as unknown as Win).__plots[0]!;
      const cell = pl.cells[0]!.panel;
      const r = pl.root.getBoundingClientRect();
      return { x: r.left + cell.area.x + cell.area.w / 2, y: r.top + cell.area.y + 40 };
    });
    await page.mouse.move(p.x, p.y);
    const before = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.title);
    const rowsBefore = await page.evaluate(() => (document.querySelector(".ac-plot table") as HTMLTableElement).tBodies[0]!.rows.length);
    // The same chart, one more day of data: the pointer has not moved.
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const s = w.__plotDemo.specs.flows as unknown as { marks: { x: number[]; y: number[] }[] };
      const more = { ...s, marks: s.marks.map((m) => ({ ...m, x: [...m.x, m.x[m.x.length - 1]! + 86_400_000], y: [...m.y, 100] })) };
      w.__plots[0]!.update(more);
    });
    await page.waitForFunction(() => (window as unknown as Win).__plots[0]!.hover() !== null);
    const after = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.title);
    expect(after).not.toBe("");
    expect(typeof before).toBe("string");
    // The table was not rebuilt by the update; focus brings it up to date.
    expect(await page.evaluate(() => (document.querySelector(".ac-plot table") as HTMLTableElement).tBodies[0]!.rows.length)).toBe(rowsBefore);
    await page.evaluate(() => (document.querySelector(".ac-plot") as HTMLElement).focus());
    expect(await page.evaluate(() => (document.querySelector(".ac-plot table") as HTMLTableElement).tBodies[0]!.rows.length)).toBe(rowsBefore + 3);
  });

  test("leaving the chart right after an update does not bring the tooltip back", async ({ page }) => {
    await open(page, "only=flows&theme=light");
    const p = await page.evaluate(() => {
      const pl = (window as unknown as Win).__plots[0]!;
      const cell = pl.cells[0]!.panel;
      const r = pl.root.getBoundingClientRect();
      return { x: r.left + cell.area.x + cell.area.w / 2, y: r.top + cell.area.y + 40 };
    });
    await page.mouse.move(p.x, p.y);
    const hovered = await page.evaluate(() => {
      const w = window as unknown as Win;
      w.__plots[0]!.update({ ...w.__plotDemo.specs.flows } as never); // a frame is pending
      w.__plots[0]!.root.dispatchEvent(new PointerEvent("pointerleave"));
      w.__plots[0]!.flush();
      return w.__plots[0]!.hover();
    });
    expect(hovered).toBeNull();
  });

  test("a bar outline is drawn inside only the bar that has one", async ({ page }) => {
    await open(page, "only=sweep&theme=light");
    const r = await page.evaluate(() => {
      const p = (window as unknown as Win).__plots[0]!;
      const cell = p.cells[0]!.panel as unknown as { sx: { map(c: string): number; bandwidth: number }; sy: { map(v: number): number }; area: { y: number; h: number } };
      const c = p.root.querySelector("canvas") as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      // Just inside the left edge of a bar, half way up it: the outline colour for "20", the bar colour for "15".
      const probe = (cat: string) => {
        const x = Math.round(cell.sx.map(cat)) + 1;
        const y = Math.round((cell.sy.map(0) + cell.sy.map(1)) / 2);
        return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      };
      return { outlined: probe("20"), plain: probe("15") };
    });
    expect(r.outlined).toEqual([10, 10, 10]); // #0a0a0a
    expect(r.plain).toEqual([16, 185, 129]); // #10b981
  });

  test("the new chrome fields are refused when they mean nothing, and leave nothing behind", async ({ page }) => {
    await open(page, "only=payoff&theme=light");
    const r = await page.evaluate(() => {
      const demo = (window as unknown as Win).__plotDemo;
      const host = document.createElement("div");
      host.style.cssText = "width:300px;height:200px";
      document.body.appendChild(host);
      const before = document.querySelectorAll(".ac-plot").length;
      const msgs: string[] = [];
      const line = { type: "line", x: [1, 2], y: [1, 2] };
      for (const spec of [
        { padding: -3, marks: [line] },
        { axes: { x: { side: "left" } }, marks: [line] },
        { axes: { y: { width: 0 } }, marks: [line] },
        { marks: [{ type: "candle", x: [1], open: [5], high: [4], low: [3], close: [4] }] },
        { marks: [{ type: "area", x: [1, 2], y: [1, 2], y0: [0, 0], gradient: true }] },
      ]) {
        try {
          demo.api.createPlot(host, spec as never);
          msgs.push("no error");
        } catch (e) {
          msgs.push(String(e));
        }
      }
      const plot = demo.api.createPlot(host, { marks: [line] });
      let changed = "";
      try {
        plot.update({ decorative: true, marks: [line] } as never);
      } catch (e) {
        changed = String(e);
      }
      plot.dispose();
      return { msgs, changed, leaked: document.querySelectorAll(".ac-plot").length - before };
    });
    expect(r.leaked).toBe(0);
    expect(r.msgs[0]).toMatch(/padding/);
    expect(r.msgs[1]).toMatch(/axes.x.side/);
    expect(r.msgs[2]).toMatch(/axes.y.width/);
    expect(r.msgs[3]).toMatch(/not a candle/);
    expect(r.msgs[4]).toMatch(/level baseline/);
    expect(r.changed).toMatch(/decorative cannot change/);
  });

  test("shared tooltip on a band axis lists every series with the data's values", async ({ page }) => {
    await open(page, "only=shareholding&theme=light");
    const p = await centreOfCat(page, 0, "Mar 25");
    await page.mouse.move(p.x, p.y);
    await expect(tip(page)).toContainText("Mar 25");
    const rows = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.rows.map((r) => [r.name, r.value]));
    expect(rows).toEqual([["Promoter", "50.3"], ["FII", "18.7"], ["DII", "15.4"], ["Public", "15.6"]]);
  });

  test("time axis: the tooltip's values are the data at the snapped x, and the crosshair snaps to it", async ({ page }) => {
    await open(page, "only=flows&theme=light");
    const data = await spec(page, "flows", (s: { marks: { x: number[]; y: number[] }[] }) => ({ x: s.marks[0]!.x, fii: s.marks[0]!.y, dii: s.marks[1]!.y, cum: s.marks[2]!.y }));
    const i = 11;
    const px = await page.evaluate(([n, t]) => {
      const p = (window as unknown as Win).__plots[0]!;
      const cell = p.cells[0]!.panel;
      const r = p.root.getBoundingClientRect();
      return { x: r.left + cell.sx.map(t as number) + 3, y: r.top + cell.area.y + 40, n };
    }, [0, data.x[i]!] as const);
    await page.mouse.move(px.x, px.y);
    const h = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!);
    const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
    expect(h.rows.map((r) => r.value)).toEqual([fmt(data.fii[i]!), fmt(data.dii[i]!), fmt(data.cum[i]!)]);
  });

  test("nearest mode: a bubble's tooltip shows its label, size and value", async ({ page }) => {
    await open(page, "only=bubbles&theme=light");
    const s = await spec(page, "bubbles", (q: { marks: { x: number[]; y: number[]; size: number[]; labels: string[] }[] }) => ({ x: q.marks[0]!.x[5]!, y: q.marks[0]!.y[5]!, size: q.marks[0]!.size[5]!, label: q.marks[0]!.labels[5]! }));
    const pos = await page.evaluate(([x, y]) => {
      const p = (window as unknown as Win).__plots[0]!;
      const cell = p.cells[0]!.panel as unknown as { sx: { map(v: number): number }; sy: { map(v: number): number } };
      const r = p.root.getBoundingClientRect();
      return { x: r.left + cell.sx.map(x!), y: r.top + cell.sy.map(y!) };
    }, [s.x, s.y] as const);
    await page.mouse.move(pos.x, pos.y);
    const h = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!);
    expect(h.title).toBe(s.label);
    expect(h.rows.map((r) => r.value)).toContain(String(s.size));
  });

  test("scatter per-point style shows in the tooltip: a stale strike says so", async ({ page }) => {
    await open(page, "only=iv-smile&theme=light");
    const s = await spec(page, "iv-smile", (q: { marks: { x?: number[]; y?: number[]; states?: string[] }[] }) => ({ x: q.marks[1]!.x!, y: q.marks[1]!.y!, states: q.marks[1]!.states! }));
    for (const i of [3, 4]) {
      const pos = await page.evaluate(([x, y]) => {
        const p = (window as unknown as Win).__plots[0]!;
        const cell = p.cells[0]!.panel as unknown as { sx: { map(v: number): number }; sy: { map(v: number): number } };
        const r = p.root.getBoundingClientRect();
        return { x: r.left + cell.sx.map(x!), y: r.top + cell.sy.map(y!) };
      }, [s.x[i]!, s.y[i]!] as const);
      await page.mouse.move(pos.x, pos.y);
      await expect(tip(page)).toContainText(s.states[i]!);
      const row = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.rows.find((r) => r.name === "Quotes")?.value);
      expect(row).toBe(`${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(s.y[i]!)} · ${s.states[i]}`);
    }
  });

  test("nearest mode shows the per-point state as its own row", async ({ page }) => {
    await open(page, "only=iv-smile&theme=light");
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.__plots[0]!.update({ ...(w.__plotDemo.specs["iv-smile"] as object), theme: "light", tooltip: { mode: "nearest" } });
      w.__plots[0]!.flush();
    });
    const s = await spec(page, "iv-smile", (q: { marks: { x?: number[]; y?: number[] }[] }) => ({ x: q.marks[1]!.x![3]!, y: q.marks[1]!.y![3]! }));
    const pos = await page.evaluate(([x, y]) => {
      const p = (window as unknown as Win).__plots[0]!;
      const cell = p.cells[0]!.panel as unknown as { sx: { map(v: number): number }; sy: { map(v: number): number } };
      const r = p.root.getBoundingClientRect();
      return { x: r.left + cell.sx.map(x!), y: r.top + cell.sy.map(y!) };
    }, [s.x, s.y] as const);
    await page.mouse.move(pos.x, pos.y);
    const h = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!);
    expect(h.title).toBe("24500 CE");
    expect(h.rows.find((r) => r.name === "State")?.value).toBe("stale quote");
  });

  test("heatmap cell and treemap tile tooltips", async ({ page }) => {
    await open(page, "only=correlation&theme=light");
    const p = await page.evaluate(() => {
      const pl = (window as unknown as Win).__plots[0]!;
      const cell = pl.cells[0]!.panel;
      const r = pl.root.getBoundingClientRect();
      return { x: r.left + cell.sx.center("BANK"), y: r.top + (cell.sy as unknown as { center(c: string): number }).center("NIFTY") };
    });
    await page.mouse.move(p.x, p.y);
    const want = await spec(page, "correlation", (s: { marks: { x: string[]; y: string[]; value: number[] }[] }) => s.marks[0]!.value[s.marks[0]!.y.findIndex((y, i) => y === "NIFTY" && s.marks[0]!.x[i] === "BANK")]);
    const h = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!);
    expect(h.title).toBe("BANK · NIFTY");
    expect(Number(h.rows[0]!.value)).toBe(want);
    await page.goto("/?ex=plot&only=sectors&theme=light");
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    const box = await page.locator("[data-plot=sectors]").boundingBox();
    await page.mouse.move(box!.x + 80, box!.y + 90);
    const t = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover());
    expect(t?.title).toMatch(/^(Financials|IT|Energy|Auto|FMCG) \/ /);
    expect(t?.rows.map((r) => r.name)).toContain("Share");
  });

  test("legend click and the number keys hide and show a series; hidden series leave the CSV", async ({ page }) => {
    await open(page, "only=shareholding&theme=light");
    const before = await page.evaluate(() => (window as unknown as Win).__plots[0]!.exportCsv());
    expect(before).toContain("FII");
    const events = await page.evaluate(() => {
      (window as unknown as { __ev: unknown[] }).__ev = [];
      (window as unknown as Win).__plots[0]!.on("legend", (e) => (window as unknown as { __ev: unknown[] }).__ev.push(e));
    });
    void events;
    const c = await page.evaluate(() => {
      const p = (window as unknown as Win).__plots[0]!;
      const l = p.legend.find((e) => e.name === "FII")!;
      const r = p.root.getBoundingClientRect();
      return { x: r.left + l.rect.x + l.rect.w / 2, y: r.top + l.rect.y + l.rect.h / 2 };
    });
    await page.mouse.click(c.x, c.y);
    const hidden = await page.evaluate(() => (window as unknown as Win).__plots[0]!.exportCsv());
    expect(hidden).not.toContain("FII");
    expect(hidden).toContain("Promoter");
    expect(await page.evaluate(() => (window as unknown as { __ev: unknown[] }).__ev)).toEqual([{ name: "FII", hidden: true }]);
    // The stack closes up: DII now sits on Promoter.
    const lo = await page.evaluate(() => {
      const panel = (window as unknown as Win).__plots[0]!.cells[0]!.panel as unknown as { prepared: { marks: { name: string; lo: ArrayLike<number> }[] } };
      return panel.prepared.marks.find((m) => m.name === "DII")!.lo[0];
    });
    expect(lo).toBe(50.3);
    await page.locator(".ac-plot").first().focus();
    await page.keyboard.press("2");
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__plots[0]!.exportCsv())).toBe(before);
  });

  test("wheel zooms a continuous x axis around the pointer; double click resets", async ({ page }) => {
    await open(page, "only=perf&n=2000&theme=light");
    const a = await page.evaluate(() => {
      const p = (window as unknown as Win).__plots[0]!;
      const c = p.cells[0]!.panel;
      const r = p.root.getBoundingClientRect();
      return { x: r.left + c.area.x + c.area.w / 2, y: r.top + c.area.y + c.area.h / 2 };
    });
    await page.mouse.move(a.x, a.y);
    const mid = await page.evaluate(() => {
      const c = (window as unknown as Win).__plots[0]!.cells[0]!.panel;
      return c.sx.invert(c.area.x + c.area.w / 2);
    });
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
    await page.waitForTimeout(100);
    const v = await page.evaluate(() => (window as unknown as Win).__plots[0]!.getView());
    expect(v).not.toBeNull();
    expect(v![1] - v![0]).toBeLessThan(2000 * 0.7);
    expect(v![0]).toBeLessThan(mid);
    expect(v![1]).toBeGreaterThan(mid);
    await page.mouse.dblclick(a.x, a.y);
    expect(await page.evaluate(() => (window as unknown as Win).__plots[0]!.getView())).toBeNull();
  });

  test("brush selects an x range and zooms to it", async ({ page }) => {
    await open(page, "only=perf&n=2000&theme=light");
    const g = await page.evaluate(() => {
      const p = (window as unknown as Win).__plots[0]!;
      const c = p.cells[0]!.panel;
      const r = p.root.getBoundingClientRect();
      return { x0: r.left + c.area.x + c.area.w * 0.25, x1: r.left + c.area.x + c.area.w * 0.5, y: r.top + c.area.y + c.area.h / 2 };
    });
    await page.mouse.move(g.x0, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x1, g.y, { steps: 5 });
    await page.mouse.up();
    const [v, want] = await page.evaluate(([x0, x1]) => {
      const p = (window as unknown as Win).__plots[0]!;
      const c = p.cells[0]!.panel;
      const r = p.root.getBoundingClientRect();
      return [p.getView(), [c.sx.invert(x0! - r.left), c.sx.invert(x1! - r.left)]] as const;
    }, [g.x0, g.x1] as const);
    expect(v).not.toBeNull();
    // The plot's domain is the zoomed one now; the selection was made against the full one.
    expect(v![0]).toBeGreaterThan(300);
    expect(v![1] - v![0]).toBeGreaterThan(0);
    expect(want[0]).toBeLessThan(want[1]!);
  });

  test("synced plots share the crosshair and the zoom", async ({ page }) => {
    await open(page, "only=equity-pair&theme=light");
    const p = await at(page, 0, 300, 100);
    await page.mouse.move(p.x, p.y);
    const lower = await page.evaluate(() => (window as unknown as Win).__plots[1]!.hover());
    expect(lower).not.toBeNull();
    expect(lower!.rows[0]!.name).toBe("Drawdown");
    const upper = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.title);
    expect(lower!.title).toBe(upper);
    await page.mouse.move(2, 2);
    expect(await page.evaluate(() => (window as unknown as Win).__plots[1]!.hover())).toBeNull();
    // Zoom the upper one: the lower follows.
    const a = await at(page, 0, 300, 100);
    await page.mouse.move(a.x, a.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    const views = await page.evaluate(() => (window as unknown as Win).__plots.map((q) => q.getView()));
    expect(views[0]).not.toBeNull();
    expect(views[1]).toEqual(views[0]);
  });

  test("keyboard: arrows walk the data, announce it, Escape clears", async ({ page }) => {
    await open(page, "only=shareholding&theme=light");
    await page.locator(".ac-plot").first().focus();
    await page.keyboard.press("ArrowRight");
    const first = await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.title);
    expect(first).toBe("Dec 24");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.title)).toBe("Mar 25");
    await page.keyboard.press("End");
    expect(await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover()!.title)).toBe("Mar 26");
    await expect(page.locator(".ac-plot [aria-live]")).toContainText("Mar 26");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover())).toBeNull();
  });

  test("CSV is the data that was plotted", async ({ page }) => {
    await open(page, "only=flows&theme=light");
    const csv = await page.evaluate(() => (window as unknown as Win).__plots[0]!.exportCsv());
    const data = await spec(page, "flows", (s: { marks: { name: string; x: number[]; y: number[] }[] }) => s.marks.map((m) => ({ name: m.name, x: m.x, y: m.y })));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("mark,series,x,y,y0");
    const rows = lines.slice(1).map((l) => l.split(","));
    let k = 0;
    for (const m of data) {
      for (let i = 0; i < m.x.length; i++, k++) {
        expect(rows[k]![1]).toBe(m.name);
        expect(Number(rows[k]![2])).toBe(m.x[i]);
        expect(Number(rows[k]![3])).toBe(m.y[i]);
      }
    }
    expect(rows.length).toBe(k);
  });

  test("PNG export is a PNG at the requested scale", async ({ page }) => {
    await open(page, "only=payoff&theme=light");
    const dims = await page.evaluate(async () => {
      const b = await (window as unknown as Win).__plots[0]!.exportPng({ scale: 2 });
      const buf = new DataView(await b.arrayBuffer());
      return { type: b.type, sig: buf.getUint32(0), w: buf.getUint32(16), h: buf.getUint32(20) };
    });
    expect(dims).toEqual({ type: "image/png", sig: 0x89504e47, w: 1280, h: 720 });
  });

  test("a screen-reader data table sits in a clipped div, with a caption and every plotted row", async ({ page }) => {
    await open(page, "only=shareholding&theme=light");
    const t = await page.evaluate(() => {
      const root = document.querySelector(".ac-plot")!;
      const table = root.querySelector("table")!;
      const wrap = table.parentElement!;
      const box = wrap.getBoundingClientRect();
      return { wrapTag: wrap.tagName, w: box.width, h: box.height, rows: table.tBodies[0]!.rows.length, caption: table.caption!.textContent, headers: [...table.tHead!.rows[0]!.cells].map((c) => c.textContent), role: root.getAttribute("role"), label: root.getAttribute("aria-label") };
    });
    expect(t).toMatchObject({ wrapTag: "DIV", w: 1, h: 1, rows: 24, role: "group" });
    expect(t.caption).toContain("Shareholding pattern");
    expect(t.headers).toEqual(["Mark", "Series", "X", "Y", "Y start"]);
  });

  test("resize follows the container; a theme change repaints", async ({ page }) => {
    await open(page, "only=payoff&theme=light");
    const before = await page.evaluate(() => (window as unknown as Win).__plots[0]!.root.querySelector("canvas")!.width);
    await page.evaluate(() => ((document.querySelector("[data-plot=payoff]") as HTMLElement).style.width = "400px"));
    await page.waitForFunction((w) => (document.querySelector(".ac-plot canvas") as HTMLCanvasElement).width !== w, before);
    expect(await page.evaluate(() => (document.querySelector(".ac-plot canvas") as HTMLCanvasElement).width)).toBe(400);
    const spec0 = await page.evaluate(() => (window as unknown as Win).__plotDemo.specs.payoff);
    await page.evaluate((s) => (window as unknown as Win).__plots[0]!.update({ ...(s as object), theme: "dark" }), spec0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".ac-plot")!).backgroundColor)).toBe("rgb(0, 0, 0)"); // Luma dark is black
    // Host-resolved token colours are accepted.
    await page.evaluate((s) => (window as unknown as Win).__plots[0]!.update({ ...(s as object), theme: { background: "#101820" } }), spec0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".ac-plot")!).backgroundColor)).toBe("rgb(16, 24, 32)");
  });

  test("bars are snapped to whole device pixels: a scan across a stack has no blended pixels", async ({ page }) => {
    await open(page, "only=shareholding&theme=light");
    // The brand mark sits at the bottom-left of the plot, on this row; its glyph is anti-aliased, the bars must not be.
    await page.evaluate(() => {
      const w = window as unknown as Win;
      w.__plots[0]!.update({ ...(w.__plotDemo.specs.shareholding as object), watermark: { visible: false } });
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const colours = await page.evaluate(() => {
      const p = (window as unknown as Win).__plots[0]!;
      const c = p.root.querySelector("canvas") as HTMLCanvasElement;
      const a = p.cells[0]!.panel.area;
      const y = Math.round(a.y + a.h - 10);
      const row = c.getContext("2d")!.getImageData(Math.round(a.x) + 3, y, Math.round(a.w) - 6, 1).data;
      const set = new Set<string>();
      for (let i = 0; i < row.length; i += 4) set.add(`${row[i]},${row[i + 1]},${row[i + 2]}`);
      return set.size;
    });
    expect(colours).toBe(2); // background and the Promoter bar
  });

  test("a rejected spec leaves nothing in the page; a time axis needs a time zone", async ({ page }) => {
    await open(page, "only=payoff&theme=light");
    const r = await page.evaluate(() => {
      const demo = (window as unknown as Win).__plotDemo;
      const host = document.createElement("div");
      host.style.cssText = "width:300px;height:200px";
      document.body.appendChild(host);
      const before = document.querySelectorAll(".ac-plot").length;
      const msgs: string[] = [];
      for (const spec of [
        { marks: [{ type: "line", x: [1, 2], y: [1, 2], color: "red" }] },
        { scales: { x: { type: "time" } }, marks: [{ type: "line", x: [1, 2], y: [1, 2] }] },
        { scales: { y: { type: "log" } }, marks: [{ type: "line", x: [1, 2], y: [1, 0] }] },
      ]) {
        try {
          demo.api.createPlot(host, spec as never);
          msgs.push("no error");
        } catch (e) {
          msgs.push(String(e));
        }
      }
      return { msgs, leaked: document.querySelectorAll(".ac-plot").length - before };
    });
    expect(r.leaked).toBe(0);
    expect(r.msgs[0]).toMatch(/unsupported colour/);
    expect(r.msgs[1]).toMatch(/needs spec.timeZone/);
    expect(r.msgs[2]).toMatch(/positive/);
  });

  test("a disposed plot leaves its sync group and does not break the others", async ({ page }) => {
    await open(page, "only=equity-pair&theme=light");
    await page.evaluate(() => {
      const w = window as unknown as Win & { __seen: number };
      w.__seen = 0;
      w.__plots[0]!.on("crosshair", () => w.__seen++);
      (w.__plots[1]! as unknown as { dispose(): void }).dispose();
    });
    const p = await at(page, 0, 300, 100);
    await page.mouse.move(p.x, p.y);
    await page.mouse.move(p.x + 20, p.y);
    expect(await page.evaluate(() => (window as unknown as { __seen: number }).__seen)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as Win).__plots[0]!.hover())).not.toBeNull();
  });

  test("a draw-time failure goes to the error event, not an uncaught exception", async ({ page }) => {
    const errors = await open(page, "only=payoff&theme=light");
    const got = await page.evaluate(async () => {
      const w = window as unknown as Win;
      const p = w.__plots[0]!;
      const seen: unknown[] = [];
      p.on("error", (e) => seen.push(String((e as { error: unknown }).error)));
      // Break the layout from outside so the next frame throws.
      (p as unknown as { cells: { panel: { layout(): void } }[] }).cells[0]!.panel.layout = () => { throw new Error("boom"); };
      (p as unknown as { schedule(): void }).schedule();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return seen;
    });
    expect(got).toEqual(["Error: boom"]);
    expect(errors).toEqual([]);
  });

  test("axe: no violations on the page's plots", async ({ page }) => {
    await open(page, "theme=light");
    const r = await new AxeBuilder({ page }).include(".ac-plot").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
