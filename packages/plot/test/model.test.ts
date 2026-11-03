import { describe, expect, it } from "vitest";
import { makeColorScale, textOn } from "../src/color.js";
import { extents, inferKinds, prepare, type PBar } from "../src/model.js";
import { plotted, toCsv } from "../src/rows.js";
import type { Mark, PlotSpec } from "../src/spec.js";
import { PLOT_LIGHT, resolveTheme } from "../src/theme.js";

const prep = (marks: Mark[], scales?: PlotSpec["scales"], hidden: string[] = []) =>
  prepare({ marks, scales, theme: PLOT_LIGHT, hidden: new Set(hidden), colors: new Map() });
const csv = (marks: Mark[], hidden: string[] = [], scales?: PlotSpec["scales"]) => toCsv(plotted([{ prepared: prep(marks, scales, hidden) }]));

describe("axis kinds", () => {
  it("categories make a band axis, numbers a linear one", () => {
    expect(inferKinds([{ type: "bar", x: ["a", "b"], y: [1, 2] }], undefined)).toMatchObject({ x: "band", y: "linear" });
    expect(inferKinds([{ type: "bar", x: [1, 2], y: [1, 2] }], undefined)).toMatchObject({ x: "linear", y: "linear" });
    expect(inferKinds([{ type: "bar", x: [5, 6], y: ["a", "b"] }], undefined)).toMatchObject({ x: "linear", y: "band" });
    expect(inferKinds([{ type: "heatmap", x: ["a"], y: ["b"], value: [1] }], undefined)).toMatchObject({ x: "band", y: "band" });
    expect(inferKinds([{ type: "treemap", root: { name: "r", value: 1 } }], undefined).noAxes).toBe(true);
  });
  it("refuses categories on a linear scale, loudly", () => {
    expect(() => inferKinds([{ type: "line", x: ["a", "b"], y: [1, 2] }], { x: { type: "linear" } })).toThrow(/categories/);
    expect(() => inferKinds([], { y2: { type: "band" } })).toThrow(/y2/);
  });
  it("rejects data that does not fit the axis", () => {
    expect(() => prep([{ type: "line", x: [1, 2, 3], y: [1, 2] }])).toThrow(/y has 2 values|x has 3/);
    expect(() => prep([{ type: "line", x: [1, 2], y: ["a" as unknown as number, 2] }])).toThrow(/not a number/);
  });
});

describe("bars", () => {
  it("stack diverging around zero; mirror flips the side but keeps the true value", () => {
    const p = prep([
      { type: "bar", name: "A", x: ["a", "b"], y: [3, -2], stack: "s" },
      { type: "bar", name: "B", x: ["a", "b"], y: [4, -1], stack: "s" },
      { type: "bar", name: "Put", x: ["a", "b"], y: [5, 6], mirror: true },
    ]);
    const [a, b, put] = p.marks as PBar[];
    expect([...a!.hi]).toEqual([3, -2]);
    expect([...b!.lo]).toEqual([3, -2]);
    expect([...b!.hi]).toEqual([7, -3]);
    expect([...put!.hi]).toEqual([-5, -6]);
    expect([...put!.value]).toEqual([5, 6]);
  });
  it("side-by-side slots per side of zero: a call and a put share a band", () => {
    const p = prep([
      { type: "bar", name: "Call", orient: "h", y: ["1", "2"], x: [1, 2] },
      { type: "bar", name: "Put", orient: "h", y: ["1", "2"], x: [1, 2], mirror: true },
      { type: "bar", name: "Other", orient: "h", y: ["1", "2"], x: [1, 2] },
    ]);
    const bars = p.marks as PBar[];
    expect(bars.map((b) => [b.slot, b.slots])).toEqual([[0, 2], [0, 1], [1, 2]]);
  });
  it("bars get zero on their value axis; areas and lines do not", () => {
    const bars = extents(prep([{ type: "bar", x: ["a"], y: [5] }]), null);
    expect(bars.zero.y).toBe(true);
    expect(bars.y).toEqual([0, 5]);
    const area = extents(prep([{ type: "area", x: [1, 2], y: [100, 120] }]), null);
    expect(area.zero.y).toBe(false);
    expect(area.y).toEqual([100, 120]);
  });
  it("a zoomed view limits the y extent to the points in view", () => {
    const p = prep([{ type: "line", x: [1, 2, 3, 4], y: [10, 20, 1000, 30] }]);
    expect(extents(p, null).y).toEqual([10, 1000]);
    expect(extents(p, [1, 2]).y).toEqual([10, 20]);
  });
  it("a hidden series takes no space in stacks, extents or exports", () => {
    const marks: Mark[] = [
      { type: "bar", name: "A", x: ["a"], y: [3], stack: "s" },
      { type: "bar", name: "B", x: ["a"], y: [4], stack: "s" },
    ];
    const p = prep(marks, undefined, ["A"]);
    expect(extents(p, null).y).toEqual([0, 4]);
    expect((p.marks[1] as PBar).lo[0]).toBe(0);
    expect(csv(marks, ["A"])).toBe("mark,series,x,y,y0\r\nbar,B,a,4,0\r\n");
  });
  it("colors must match the bars", () => {
    expect(() => prep([{ type: "bar", x: ["a", "b"], y: [1, 2], colors: ["#fff"] }])).toThrow(/colors/);
  });
});

describe("scatter per-point style", () => {
  it("validates columns and writes states to the CSV", () => {
    const m: Mark = { type: "scatter", name: "IV", x: [100, 200], y: [0.2, 0.3], hollow: [false, true], shapes: ["circle", "diamond"], colors: ["#111", "#222"], states: ["live", "stale"], labels: ["100 CE", "200 CE"] };
    expect(csv([m])).toBe("mark,series,x,y,label,state\r\nscatter,IV,100,0.2,100 CE,live\r\nscatter,IV,200,0.3,200 CE,stale\r\n");
    expect(() => prep([{ ...m, hollow: [true] } as Mark])).toThrow(/hollow has 1/);
  });
});

describe("CSV is the data actually plotted", () => {
  it("round-trips lines, columns and Float64Arrays to 15 significant digits", () => {
    const x = [1, 2, 3], y = Float64Array.from([0.1 + 0.2, 1 / 3, 1e21]);
    const out = csv([{ type: "line", name: "eq", x, y }]);
    const lines = out.trim().split("\r\n");
    expect(lines[0]).toBe("mark,series,x,y");
    lines.slice(1).forEach((l, i) => {
      const [, , cx, cy] = l.split(",");
      expect(Number(cx)).toBe(x[i]);
      expect(Number(cy)).toBe(Number(y[i]!.toPrecision(15)));
    });
  });
  it("quotes commas, quotes and newlines; leaves gaps empty", () => {
    const out = csv([{ type: "line", name: 'a,"b"', x: [1, 2], y: [NaN, 2] }]);
    expect(out).toBe('mark,series,x,y\r\nline,"a,""b""",1,\r\nline,"a,""b""",2,2\r\n');
  });
  it("histogram writes the bins, heatmap the cells, treemap the leaf paths, rules their labels", () => {
    expect(csv([{ type: "histogram", name: "h", values: [1, 2, 3, 4], bins: 2 }])).toBe("mark,series,x,x1,y\r\nhistogram,h,1,2.5,2\r\nhistogram,h,2.5,4,2\r\n");
    expect(csv([{ type: "heatmap", x: ["Jan", "Feb"], y: ["2024", "2024"], value: [1.5, -2] }])).toBe("mark,x,y,value\r\nheatmap,Jan,2024,1.5\r\nheatmap,Feb,2024,-2\r\n");
    expect(csv([{ type: "treemap", root: { name: "r", children: [{ name: "A", children: [{ name: "a1", value: 3 }] }, { name: "B", value: 2 }] } }])).toBe("mark,x,value\r\ntreemap,A / a1,3\r\ntreemap,B,2\r\n");
    expect(csv([{ type: "rule", x: [24350], y: 0, labels: ["Spot", "zero"] }])).toBe("mark,x,y,label\r\nrule,24350,,Spot\r\nrule,,0,zero\r\n");
  });
  it("a stacked area writes its baseline; a plain area does not", () => {
    expect(csv([{ type: "area", x: [1, 2], y: [3, 4] }])).toBe("mark,x,y\r\narea,1,3\r\narea,2,4\r\n");
    expect(csv([{ type: "errorBand", x: [1], lo: [2], hi: [5] }])).toBe("mark,x,y,y0\r\nerrorBand,1,5,2\r\n");
  });
  it("facet cells are labelled", () => {
    const cell = (t: string) => ({ title: t, prepared: prep([{ type: "line", x: [1], y: [2] }]) });
    expect(toCsv(plotted([cell("A"), cell("B")]))).toBe("facet,mark,x,y\r\nA,line,1,2\r\nB,line,1,2\r\n");
  });
});

describe("colour scales", () => {
  it("sequential interpolates the ramp and clamps", () => {
    const s = makeColorScale({ range: ["#000000", "#ffffff"] }, PLOT_LIGHT, [0, 10]);
    expect(s.map(0)).toBe("rgba(0,0,0,1.000)");
    expect(s.map(10)).toBe("rgba(255,255,255,1.000)");
    expect(s.map(5)).toBe("rgba(128,128,128,1.000)");
    expect(s.map(99)).toBe(s.map(10));
  });
  it("diverging puts the neutral colour on the midpoint and is symmetric by default", () => {
    const s = makeColorScale({ type: "diverging", range: ["#ff0000", "#ffffff", "#0000ff"] }, PLOT_LIGHT, [-2, 8]);
    expect(s.domain).toEqual([-8, 8]);
    expect(s.map(0)).toBe("rgba(255,255,255,1.000)");
    expect(s.map(-8)).toBe("rgba(255,0,0,1.000)");
    expect(s.map(8)).toBe("rgba(0,0,255,1.000)");
  });
  it("text colour follows luminance; unreadable theme colours fail", () => {
    expect(textOn("#ffffff")).toBe("#000000");
    expect(textOn("#0a2a8a")).toBe("#ffffff");
    expect(() => resolveTheme({ text: "oklch(0.5 0.1 200)" })).toThrow(/unsupported colour/);
  });
});

describe("bad specs fail in prepare, synchronously", () => {
  it("unreadable colours, anywhere a colour goes", () => {
    expect(() => prep([{ type: "line", x: [1], y: [1], color: "red" }])).toThrow(/unsupported colour/);
    expect(() => prep([{ type: "bar", x: ["a"], y: [1], colors: ["#fff;width:9999px"] }])).toThrow(/unsupported colour/);
    expect(() => prep([{ type: "area", x: [1], y: [1], split: { above: "green" } }])).toThrow(/unsupported colour/);
    expect(() => prep([{ type: "treemap", root: { name: "r", children: [{ name: "a", value: 1, color: "blue" }] } }])).toThrow(/unsupported colour/);
    expect(() => prep([], { color: { range: ["#fff", "nope"] } })).toThrow(/unsupported colour/);
  });
  it("log axes refuse zero and negative data; NaN is a gap", () => {
    expect(() => prep([{ type: "line", x: [1, 2], y: [5, 0] }], { y: { type: "log" } })).toThrow(/positive/);
    expect(() => prep([{ type: "bar", x: ["a"], y: [-1] }], { y: { type: "log" } })).toThrow(/positive/);
    expect(() => prep([{ type: "line", x: [1, 2], y: [5, NaN] }], { y: { type: "log" } })).not.toThrow();
    expect(() => prep([], { y: { type: "log", domain: [0, 10] } })).toThrow(/positive/);
    expect(() => prep([], { x: { domain: [5, 1] } })).toThrow(/increase/);
  });
  it("rules must be numbers on a number axis", () => {
    expect(() => prep([{ type: "line", x: [1], y: [1] }, { type: "rule", x: "abc" }])).toThrow(/not a number/);
    expect(() => prep([{ type: "bar", x: ["a"], y: [1] }, { type: "rule", x: "a" }])).not.toThrow();
  });
  it("a missing colour value is drawn as missing, not as the midpoint or a crash", () => {
    const s = makeColorScale({ type: "sequential" }, PLOT_LIGHT, [0, 1]);
    expect(s.map(NaN)).toBe(makeColorScale({ type: "diverging" }, PLOT_LIGHT, [-1, 1]).map(NaN));
  });
});

describe("export safety", () => {
  it("a stacked area exports its own values, not the running total", () => {
    const marks: Mark[] = [
      { type: "area", name: "A", x: [1, 2], y: [10, 20], stack: "s" },
      { type: "area", name: "B", x: [1, 2], y: [5, 7], stack: "s" },
    ];
    expect(csv(marks)).toBe("mark,series,x,y,y0\r\narea,A,1,10,0\r\narea,A,2,20,0\r\narea,B,1,5,10\r\narea,B,2,7,20\r\n");
  });
  it("text a spreadsheet would run as a formula is neutralised; numbers are not touched", () => {
    const out = csv([{ type: "bar", name: '=HYPERLINK("http://x")', x: ["-cmd", "+1", "ok"], y: [-3, 2, 1] }]);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain("'-cmd");
    expect(out).toContain(",-3\r\n");
    expect(out).toContain(",ok,1");
  });
  it("the table rows stop at the limit without building the rest", () => {
    const x = Array.from({ length: 50_000 }, (_, i) => i);
    const p = plotted([{ prepared: prep([{ type: "line", x, y: x }]) }], 10);
    expect(p.rows).toHaveLength(10);
  });
});
