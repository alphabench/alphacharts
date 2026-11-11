import { beforeAll, describe, expect, it } from "vitest";
import { drawPanel } from "../src/draw.js";
import { Fmt } from "../src/format.js";
import { placeTooltip } from "../src/placement.js";
import { hitAt } from "../src/hit.js";
import { defaultPlotMessages } from "../src/messages.js";
import { prepare } from "../src/model.js";
import { Panel, type PanelOptions } from "../src/panel.js";
import type { AxisSpec, Mark, PlotSpec } from "../src/spec.js";
import { PLOT_DARK, PLOT_LIGHT, resolveTheme, tooltipChrome, type PlotTheme } from "../src/theme.js";
import { validateSpec } from "../src/validate.js";

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class {};
});

const measure = { font: "", measureText: (s: string) => ({ width: s.length * 6 }) } as unknown as CanvasRenderingContext2D;

function panelOf(marks: Mark[], extra: Partial<PanelOptions> = {}, locale = "en-US"): Panel {
  const prepared = prepare({ marks, scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
  const p = new Panel({ prepared, theme: PLOT_LIGHT, fmt: new Fmt(locale, "UTC"), scales: undefined, axes: undefined, msg: defaultPlotMessages, ...extra });
  p.layout(measure, { x: 0, y: 0, w: 400, h: 200 }, { view: null, xLabels: true, yLabels: true });
  return p;
}

const xAt = (p: Panel, v: number): number => (p.sx as { map(v: number): number }).map(v);

/** The fillStyle values a panel sets while drawing. */
function fills(marks: Mark[]): string[] {
  const calls: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), k === "fillStyle" && calls.push(String(v)), true),
  }) as unknown as CanvasRenderingContext2D;
  drawPanel(panelOf(marks), ctx, 1);
  return calls;
}

describe("bar opacity", () => {
  const bar = (extra: object = {}): Mark => ({ type: "bar", x: ["a", "b"], y: [1, 2], color: "#ff0000", ...extra }) as Mark;
  it("fills at the opacity; unset leaves the colour as it was", () => {
    expect(fills([bar({ opacity: 0.5 })])).toContain("rgba(255,0,0,0.5)");
    expect(fills([bar()])).toContain("#ff0000");
  });
  it("multiplies the alpha of a per-bar colour", () => {
    expect(fills([bar({ colors: ["rgba(0,0,255,0.5)", "#00ff00"], opacity: 0.5 })])).toEqual(expect.arrayContaining([expect.stringMatching(/^rgba\(0,0,255,0\.25\d*\)$/), "rgba(0,255,0,0.5)"]));
  });
  it("must be a number from 0 to 1", () => {
    const prep = (opacity: unknown) => () => prepare({ marks: [bar({ opacity })], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
    expect(prep(0)).not.toThrow();
    expect(prep(1)).not.toThrow();
    expect(prep(1.2)).toThrow(/opacity must be a number from 0 to 1/);
    expect(prep(-0.1)).toThrow(/opacity/);
    expect(prep(NaN)).toThrow(/opacity/);
    expect(prep("0.5")).toThrow(/opacity/);
  });
});

describe("tooltip title and swatch", () => {
  const line: Mark = { type: "line", name: "L", x: [0, 1, 2, 3], y: [10, 20, 15, 30] };
  it("a number axis without a formatter titles with the value, as before", () => {
    const p = panelOf([line]);
    expect(hitAt(p, xAt(p, 2), p.area.y + 5, "shared", true)!.title).toBe("2");
  });
  it("an x axis tickFormat does not change the default title", () => {
    const p = panelOf([line], { axes: { x: { tickFormat: (v) => `bar ${v}` } } });
    expect(hitAt(p, xAt(p, 2), p.area.y + 5, "shared", true)!.title).toBe("2");
  });
  it('title: "axis" uses the x axis\' tickFormat, told the step and the datum', () => {
    const seen: unknown[] = [];
    const tickFormat = (v: number | string, c: unknown) => (seen.push([v, c]), `bar ${v}`);
    const p = panelOf([line], { axes: { x: { tickFormat } }, tooltipTitle: "axis" });
    seen.length = 0;
    expect(hitAt(p, xAt(p, 2), p.area.y + 5, "shared", true)!.title).toBe("bar 2");
    expect(seen).toEqual([[2, { step: p.axes.find((a) => a.id === "x")!.step, values: [2], index: 0 }]]);
  });
  it("tooltip.title wins, with the index, the exact x and the title it replaces", () => {
    const calls: unknown[] = [];
    const title = (c: { index: number; x: unknown; label?: string }) => (calls.push(c), `i${c.index}`);
    const p = panelOf([line], { axes: { x: { tickFormat: (v) => `bar ${v}` } }, tooltipTitle: title });
    expect(hitAt(p, xAt(p, 2) + 1, p.area.y + 5, "shared", true)!.title).toBe("i2");
    expect(calls).toEqual([{ index: 2, x: 2, label: "2" }]);
  });
  it("a category is the x and the label; \"\" gives no title", () => {
    const calls: unknown[] = [];
    const p = panelOf([{ type: "bar", name: "B", x: ["a", "b"], y: [1, 2] }], { tooltipTitle: (c) => (calls.push(c), "") });
    const hit = hitAt(p, p.area.x + p.area.w / 4, p.area.y + 5, "shared", true)!;
    expect(hit.title).toBe("");
    expect(calls).toEqual([{ index: 0, x: "a", label: "a" }]);
  });
  it("is validated with the spec", () => {
    const bad = (tooltip: object) => () => validateSpec({ marks: [], tooltip } as PlotSpec);
    expect(bad({ title: "x" })).toThrow(/tooltip.title must be a function or "axis"/);
    expect(bad({ title: "axis" })).not.toThrow();
    expect(bad({ swatch: "no" })).toThrow(/tooltip.swatch must be true or false/);
    expect(bad({ title: () => "", swatch: false })).not.toThrow();
  });
});

describe("tickFormat context", () => {
  it("a one-argument call and a one-argument implementation both type-check; the library supplies the context", () => {
    const axis: AxisSpec = { tickFormat: (v) => `<${v}>` };
    expect(axis.tickFormat!(1)).toBe("<1>");
    let got: unknown;
    panelOf([{ type: "line", x: [0, 1], y: [0, 1] }], { axes: { y: { tickFormat: (v, c) => ((got = c), String(v)) } } });
    expect(got).toBeDefined();
  });
  it("a number axis gets the step, the tick values and the tick's index", () => {
    const seen: [unknown, { step: number; values: readonly number[]; index: number }][] = [];
    const p = panelOf([{ type: "line", x: [0, 1, 2, 3], y: [0, 10, 20, 30] }], { axes: { y: { tickValues: [0, 10, 20], tickFormat: (v, c) => (seen.push([v, c!]), String(v)) } } });
    const y = p.axes.find((a) => a.id === "y")!;
    expect(y.ticks.map((t) => t.label)).toEqual(["0", "10", "20"]);
    expect(seen.slice(0, 3).map(([v, c]) => [v, c.step, c.values, c.index])).toEqual([[0, 10, [0, 10, 20], 0], [10, 10, [0, 10, 20], 1], [20, 10, [0, 10, 20], 2]]);
    expect(y.step).toBe(10);
  });
  it("a band axis gets the stride, the categories' domain positions and the index; a one-argument formatter still works", () => {
    const seen: { step: number; values: readonly number[]; index: number }[] = [];
    const marks: Mark[] = [{ type: "bar", x: ["a", "b", "c", "d"], y: [1, 2, 3, 4] }];
    const p = panelOf(marks, { axes: { x: { tickValues: ["b", "d"], tickFormat: (v, c) => (seen.push(c!), String(v).toUpperCase()) } } });
    expect(p.axes.find((a) => a.id === "x")!.ticks.map((t) => t.label)).toEqual(["B", "D"]);
    expect(seen.slice(0, 2)).toEqual([{ step: 1, values: [1, 3], index: 0 }, { step: 1, values: [1, 3], index: 1 }]);
    const one = (v: number | string) => `<${v}>`;
    expect(panelOf(marks, { axes: { x: { tickFormat: one } } }).axes.find((a) => a.id === "x")!.ticks[0]!.label).toBe("<a>");
  });
});

describe("built-in number ticks", () => {
  const f = new Fmt("en-US", "UTC");
  it("evenly spaced ticks keep the decimals of their step", () => {
    expect(f.numberTicks([1.5, 2, 2.5], undefined)).toEqual(["1.5", "2.0", "2.5"]);
  });
  it("adds decimals while two different ticks would read the same", () => {
    expect(f.numberTicks([0, 10, 10.004], undefined)).toEqual(["0.000", "10.000", "10.004"]);
    expect(f.numberTicks([0, 10, 10.004], "percent")).toEqual(["0.000%", "10.000%", "10.004%"]);
  });
  it("stops at 10 decimals, and a repeated value is not a clash", () => {
    expect(f.numberTicks([0, 1, 1 + 1e-12], undefined)[2]).toBe("1.0000000000");
    expect(f.numberTicks([1, 1], undefined)).toEqual(["1", "1"]);
  });
  it("a mirrored axis shows -10 and 10 alike, as asked", () => {
    expect(f.numberTicks([-10, 0, 10], "abs")).toEqual(["10", "0", "10"]);
  });
  it("compact honours an Indian locale: K / L / Cr (this was already so)", () => {
    expect(new Fmt("en-IN", "UTC").numberTicks([1268000, 14800000, 4500], "compact")).toEqual(["12.68L", "1.48Cr", "4.5K"]);
    expect(f.numberTicks([1268000, 14800000], "compact")).toEqual(["1.27M", "14.8M"]);
  });
});

describe("tooltip chrome and focus ring in the theme", () => {
  it("a PlotTheme written before the new fields still type-checks and gets the defaults", () => {
    const { tooltipRadius: _r, tooltipShadow: _s, ...old } = PLOT_LIGHT;
    const theme: PlotTheme = old; // no tooltipRadius, tooltipShadow, tooltipFontSize or focusRing
    expect(tooltipChrome(theme)).toEqual({ borderRadius: "4px", boxShadow: "0 2px 8px rgba(0,0,0,.25)", fontSize: "12px" });
    expect(tooltipChrome(resolveTheme(theme))).toEqual(tooltipChrome(theme));
  });
  it("defaults keep today's radius, shadow and 12 px text", () => {
    for (const t of [PLOT_LIGHT, PLOT_DARK, resolveTheme("light"), resolveTheme({})]) {
      expect(tooltipChrome(t)).toEqual({ borderRadius: "4px", boxShadow: "0 2px 8px rgba(0,0,0,.25)", fontSize: "12px" });
    }
  });
  it("a theme sets the radius and shadow, and the text follows fontSize", () => {
    const t = resolveTheme({ tooltipRadius: "10px", tooltipShadow: "none", fontSize: 14 });
    expect(tooltipChrome(t)).toEqual({ borderRadius: "10px", boxShadow: "none", fontSize: "15px" });
  });
  it("tooltipFontSize unset keeps fontSize + 1; set wins as is; invalid is rejected", () => {
    expect(tooltipChrome(resolveTheme({ fontSize: 12 })).fontSize).toBe("13px");
    expect(tooltipChrome(resolveTheme({ fontSize: 12, tooltipFontSize: 12 })).fontSize).toBe("12px");
    for (const v of [0, -1, NaN, Infinity, "12" as never]) expect(() => resolveTheme({ tooltipFontSize: v })).toThrow(/tooltipFontSize/);
  });
  it("refuses an empty radius or shadow, and a focus ring that is not a colour", () => {
    expect(() => resolveTheme({ tooltipRadius: "" })).toThrow(/tooltipRadius/);
    expect(() => resolveTheme({ tooltipShadow: " " })).toThrow(/tooltipShadow/);
    expect(() => resolveTheme({ focusRing: "nope" })).toThrow();
  });
  it("focusRing is unset by default (the plot then draws in accent) and kept when given", () => {
    expect(resolveTheme("dark").focusRing).toBeUndefined();
    expect(resolveTheme({ focusRing: "#778899" }).focusRing).toBe("#778899");
  });
});

describe("tooltip placement", () => {
  const canvas = { x: 0, y: 0, w: 400, h: 200 };
  // A plot area with a right-hand axis: x 40..340.
  const area = { x: 40, y: 10, w: 300, h: 150 };
  it("canvas: right of and below the pointer, flipped at the right edge, as before", () => {
    expect(placeTooltip(100, 50, 80, 40, canvas, 4)).toEqual({ x: 114, y: 64 });
    expect(placeTooltip(380, 50, 80, 40, canvas, 4)).toEqual({ x: 286, y: 64 });
    expect(placeTooltip(100, 190, 80, 40, canvas, 4)).toEqual({ x: 114, y: 156 });
  });
  it("plot: near the right edge with a right axis it flips and never reaches the axis", () => {
    const at = placeTooltip(330, 50, 80, 40, area, 0);
    expect(at.x).toBe(236);
    expect(at.x + 80).toBeLessThanOrEqual(area.x + area.w);
  });
  it("plot: near the left edge it stays inside the area", () => {
    expect(placeTooltip(45, 50, 80, 40, area, 0).x).toBe(59);
    expect(placeTooltip(45, 50, 300, 40, area, 0).x).toBe(40); // flipped past the left edge: held at it
  });
  it("plot: pushed up from the bottom edge; taller than the area it is pinned to the top", () => {
    expect(placeTooltip(100, 150, 80, 40, area, 0).y).toBe(120);
    expect(placeTooltip(100, 50, 80, 400, area, 0).y).toBe(area.y);
  });
  it("confine is validated", () => {
    const bad = (confine: unknown) => () => validateSpec({ marks: [], tooltip: { confine } } as PlotSpec);
    expect(bad("plot")).not.toThrow();
    expect(bad("canvas")).not.toThrow();
    expect(bad("axes")).toThrow(/tooltip.confine must be "canvas" or "plot"/);
  });
});
