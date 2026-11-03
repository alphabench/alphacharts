import { describe, expect, it } from "vitest";
import { Fmt } from "../src/format.js";
import { hitAt, stopsOf } from "../src/hit.js";
import { defaultPlotMessages } from "../src/messages.js";
import { prepare, extents, type PCandle } from "../src/model.js";
import { Panel, type PanelOptions } from "../src/panel.js";
import { plotted, toCsv } from "../src/rows.js";
import type { Mark, PlotSpec } from "../src/spec.js";
import { PLOT_LIGHT } from "../src/theme.js";
import { paddingOf, sidesOf, validateSpec } from "../src/validate.js";

// A 2D context with just the text measuring the layout needs: 6 px per character.
const ctx = { font: "", measureText: (s: string) => ({ width: s.length * 6 }) } as unknown as CanvasRenderingContext2D;

function panel(spec: Pick<PlotSpec, "axes" | "scales" | "padding">, marks: Mark[], w = 400, h = 200): Panel {
  validateSpec({ marks, ...spec });
  const prepared = prepare({ marks, scales: spec.scales, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
  const o: PanelOptions = { prepared, theme: PLOT_LIGHT, fmt: new Fmt("en-US", "UTC"), scales: spec.scales, axes: spec.axes, msg: defaultPlotMessages, padding: paddingOf(spec) };
  const p = new Panel(o);
  p.layout(ctx, { x: 0, y: 0, w, h }, { view: null, xLabels: true, yLabels: true });
  return p;
}

/** Pixel x of a number on the (continuous) x scale. */
const xAt = (p: Panel, v: number): number => (p.sx as { map(v: number): number }).map(v);

const line: Mark = { type: "line", name: "L", x: [0, 1, 2, 3], y: [10, 20, 15, 30] };

describe("tooltip rows carry the datum", () => {
  it("index, raw number and mark name on every row; tooltip: false leaves a mark out", () => {
    const marks: Mark[] = [line, { type: "bar", name: "Vol", x: [0, 1, 2, 3], y: [5, 6, 7, 8] }, { type: "line", x: [0, 1, 2, 3], y: [1, 2, 3, 4], tooltip: false }];
    const p = panel({}, marks);
    const hit = hitAt(p, xAt(p, 2), p.area.y + 10, "shared", true)!;
    expect(hit.rows.map((r) => [r.name, r.value, r.index, r.raw, r.mark])).toEqual([["L", "15", 2, 15, "L"], ["Vol", "7", 2, 7, "Vol"]]);
    expect(stopsOf(p, "shared", true).length).toBe(4);
  });
  it("a mark without a name is identified by type and position; NaN has no raw", () => {
    const p = panel({}, [{ type: "line", x: [0, 1, 2], y: [1, NaN, 3] }]);
    const hit = hitAt(p, xAt(p, 1), p.area.y + 5, "shared", true);
    expect(hit?.rows[0]).toMatchObject({ index: 1, mark: "line#0" });
    expect(hit?.rows[0]!.raw).toBeUndefined();
  });
});

describe("candle", () => {
  const candle = (extra: Partial<Extract<Mark, { type: "candle" }>> = {}): Mark => ({ type: "candle", name: "NIFTY", x: [0, 1, 2], open: [10, 12, 11], high: [14, 15, 13], low: [9, 11, 8], close: [12, 11, 12], ...extra });
  it("prepares open / high / low / close with the up and down colours", () => {
    const p = prepare({ marks: [candle({ up: "#00ff00" })], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
    const c = p.marks[0] as PCandle;
    expect([c.up, c.down]).toEqual(["#00ff00", PLOT_LIGHT.down]);
    expect(extents(p, null).y).toEqual([8, 15]);
  });
  it("a tooltip lists O, H, L, C, each with its raw number", () => {
    const p = panel({}, [candle()]);
    const hit = hitAt(p, xAt(p, 1), p.area.y + 5, "shared", true)!;
    expect(hit.rows.map((r) => [r.name, r.value, r.raw, r.index])).toEqual([["O", "12", 12, 1], ["H", "15", 15, 1], ["L", "11", 11, 1], ["C", "11", 11, 1]]);
    // A falling candle's rows are the down colour.
    expect(hit.rows[0]!.color).toBe(PLOT_LIGHT.down);
  });
  it("the CSV has its columns", () => {
    const p = prepare({ marks: [candle()], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
    expect(toCsv(plotted([{ prepared: p }])).split("\r\n").slice(0, 2)).toEqual(["mark,series,x,open,high,low,close", "candle,NIFTY,0,10,14,9,12"]);
  });
  it("rejects what is not a candle, and leaves NaN as a gap", () => {
    const prep = (m: Mark) => prepare({ marks: [m], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
    expect(() => prep(candle({ high: [14, 10, 13] }))).toThrow(/not a candle/);
    expect(() => prep(candle({ low: [9, 11, 12.5] }))).toThrow(/not a candle/);
    expect(() => prep(candle({ close: [12, 11] }))).toThrow(/close has 2 values/);
    expect(() => prep(candle({ up: "green" }))).toThrow(/unsupported colour/);
    expect(() => prep(candle({ width: 0 }))).toThrow(/positive/);
    expect(() => prep(candle({ high: [14, NaN, 13] }))).not.toThrow();
  });
});

describe("axis side, width and padding", () => {
  it("y on the right: the axis and its margin move, y2 takes the left", () => {
    const left = panel({}, [line]);
    const right = panel({ axes: { y: { side: "right" } } }, [line]);
    expect(right.axes.find((a) => a.id === "y")!.side).toBe("right");
    expect(left.axes.find((a) => a.id === "y")!.side).toBe("left");
    // The label gutter that was on the left is on the right; the other side keeps the built-in margin.
    expect(left.area.x).toBeGreaterThan(20);
    expect(right.area.x).toBe(8);
    expect(right.rect.w - (right.area.x + right.area.w)).toBeCloseTo(left.area.x, 5);
    expect(sidesOf({ y: { side: "right" } })).toEqual({ y: "right", y2: "left" });
    expect(sidesOf({ y2: { side: "left" } })).toEqual({ y: "right", y2: "left" });
  });
  it("the grid and the zero line stay with the primary axis", () => {
    const marks: Mark[] = [{ type: "line", x: [0, 1, 2], y: [-5, 5, 10] }, { type: "line", x: [0, 1, 2], y: [100, 200, 300], yAxis: "y2" }];
    const p = panel({ axes: { y: { side: "right" } } }, marks);
    expect(p.axes.find((a) => a.id === "y")!.grid).toBe(true);
    expect(p.axes.find((a) => a.id === "y2")).toMatchObject({ grid: false, side: "left" });
  });
  it("a fixed width is the whole gutter, so two plots with it line up", () => {
    const a = panel({ axes: { y: { width: 60 } } }, [line]);
    const b = panel({ axes: { y: { width: 60 } } }, [{ type: "line", x: [0, 1], y: [1000000, 20000000] }]);
    expect(a.area.x).toBe(60);
    expect(b.area.x).toBe(60);
  });
  it("tickMarks: false is kept on the axis model", () => {
    expect(panel({ axes: { y: { tickMarks: false } } }, [line]).axes.find((a) => a.id === "y")!.tickMarks).toBe(false);
    expect(panel({}, [line]).axes.find((a) => a.id === "y")!.tickMarks).toBe(true);
  });
  it("padding replaces the built-in margins", () => {
    const hidden = { x: false, y: false } as const;
    const base = panel({ axes: hidden }, [line], 100, 40);
    expect(base.area).toEqual({ x: 8, y: 8, w: 78, h: 24 }); // 8 px on each side but the right, which keeps 14
    const tight = panel({ axes: hidden, padding: 2 }, [line], 100, 40);
    expect(tight.area).toEqual({ x: 2, y: 2, w: 96, h: 36 });
    const sides = panel({ axes: hidden, padding: { top: 1, right: 3, bottom: 5, left: 7 } }, [line], 100, 40);
    expect(sides.area).toEqual({ x: 7, y: 1, w: 90, h: 34 });
  });
  it("a hidden y2 axis keeps its scale: the marks stay on y2", () => {
    const marks: Mark[] = [{ type: "line", x: [0, 1, 2], y: [1, 2, 3] }, { type: "bar", x: [0, 1, 2], y: [1000, 2000, 3000], yAxis: "y2" }];
    const hidden = panel({ axes: { y2: false } }, marks);
    expect(hidden.axes.some((a) => a.id === "y2")).toBe(false);
    expect(hidden.sy2).toBeDefined();
    expect(hidden.sy2!.domain[1]).toBeGreaterThanOrEqual(3000);
    // Without a y2 axis hidden the margin on the right is the built-in one.
    expect(hidden.rect.w - (hidden.area.x + hidden.area.w)).toBe(14);
  });
});

describe("chrome validation", () => {
  const bad = (s: Partial<PlotSpec>) => () => validateSpec({ marks: [], ...s });
  it("rejects values that mean nothing, loudly", () => {
    expect(bad({ padding: -1 })).toThrow(/padding/);
    expect(bad({ padding: NaN })).toThrow(/padding/);
    expect(bad({ padding: { top: 1, right: 1, bottom: 1 } as never })).toThrow(/padding.left/);
    expect(bad({ axes: { x: { side: "left" } } })).toThrow(/axes.x.side/);
    expect(bad({ axes: { y: { side: "top" as never } } })).toThrow(/"left" or "right"/);
    expect(bad({ axes: { y: { side: "right" }, y2: { side: "right" } } })).toThrow(/both on the right/);
    expect(bad({ axes: { y: { width: 0 } } })).toThrow(/positive/);
    expect(bad({ axes: { x: { width: 40 } } })).toThrow(/axes.x.width/);
    expect(bad({ axes: { y: { tickMarks: "no" as never } } })).toThrow(/tickMarks/);
    expect(bad({ decorative: "yes" as never })).toThrow(/decorative/);
    expect(bad({ padding: 4, decorative: true, axes: { y: { side: "right", width: 50, tickMarks: false } } })).not.toThrow();
  });
});

describe("area and bar styling", () => {
  const prep = (m: Mark) => prepare({ marks: [m], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
  it("gradient needs a level baseline; strokeColor and width are checked", () => {
    expect(() => prep({ type: "area", x: [0, 1], y: [1, 2], gradient: true })).not.toThrow();
    expect(() => prep({ type: "area", x: [0, 1], y: [1, 2], y0: 0, gradient: true })).not.toThrow();
    expect(() => prep({ type: "area", x: [0, 1], y: [1, 2], y0: [0, 0], gradient: true })).toThrow(/level baseline/);
    expect(() => prep({ type: "area", x: [0, 1], y: [1, 2], stack: "s", gradient: true })).toThrow(/level baseline/);
    expect(() => prep({ type: "area", x: [0, 1], y: [1, 2], strokeColor: "blue" })).toThrow(/unsupported colour/);
    expect(() => prep({ type: "area", x: [0, 1], y: [1, 2], width: -1 })).toThrow(/positive/);
  });
  it("an area does not force zero (the spec says so)", () => {
    expect(extents(prep({ type: "area", x: [0, 1], y: [100, 120] }), null).zero.y).toBe(false);
  });
  it("bar strokes: one per bar, colours or null, a width needs strokes", () => {
    const bar = (extra: object): Mark => ({ type: "bar", x: ["a", "b"], y: [1, 2], ...extra }) as Mark;
    expect(() => prep(bar({ strokes: ["#000", null], strokeWidth: 2 }))).not.toThrow();
    expect(() => prep(bar({ strokes: ["#000"] }))).toThrow(/strokes has 1 entries for 2 bars/);
    expect(() => prep(bar({ strokes: ["x", null] }))).toThrow(/unsupported colour/);
    expect(() => prep(bar({ strokeWidth: 2 }))).toThrow(/needs strokes/);
    expect(() => prep(bar({ strokes: [null, null], strokeWidth: 0 }))).toThrow(/positive/);
  });
  it("scatter shapes: triangleDown is one, an unknown name is refused", () => {
    expect(() => prep({ type: "scatter", x: [0, 1], y: [1, 2], shapes: ["triangle", "triangleDown"] })).not.toThrow();
    expect(() => prep({ type: "scatter", x: [0, 1], y: [1, 2], shapes: ["triangle", "star" as never] })).toThrow(/shapes\[1\]/);
  });
});
