import { describe, expect, it } from "vitest";
import { boxesTouch, boxHitsCircle, placeLabels, type Anchor, type Box, type Circle } from "../src/labels.js";
import { prepare } from "../src/model.js";
import { numText, plotted, toCsv } from "../src/rows.js";
import type { Mark } from "../src/spec.js";
import { PLOT_LIGHT } from "../src/theme.js";

const area: Box = { x: 0, y: 0, w: 400, h: 300 };
// A crowded layout, already in px.
const pts: Anchor[] = [
  { x: 200, y: 150, r: 20 }, { x: 190, y: 156, r: 10 }, { x: 260, y: 90, r: 10 }, { x: 330, y: 100, r: 14 },
  { x: 120, y: 170, r: 12 }, { x: 128, y: 176, r: 4 }, { x: 100, y: 180, r: 4 }, { x: 40, y: 230, r: 5 }, { x: 52, y: 228, r: 6 }, { x: 54, y: 222, r: 5 }, { x: 60, y: 245, r: 4 },
];
const sizes = pts.map((_, i) => ({ w: 40 + (i % 3) * 14, h: 15 }));
const circles = (a: readonly Anchor[]): Circle[] => a.map((p) => ({ x: p.x, y: p.y, r: p.r }));
const run = (over: Partial<Parameters<typeof placeLabels>[0]> = {}) => placeLabels({ anchors: pts, sizes, area, circles: circles(pts), placed: [], ...over });

describe("label placement", () => {
  const boxes = run({ order: [0] });
  const drawn = boxes.map((b, i) => [b, i] as const).filter((e): e is [Box, number] => e[0] !== null);

  it("places most of a crowded layout, the focus first", () => {
    expect(boxes[0]).not.toBeNull();
    expect(drawn.length).toBeGreaterThan(5);
  });
  it("no two placed boxes intersect", () => {
    for (const [a, i] of drawn) for (const [b, j] of drawn) if (i < j) expect(boxesTouch(a, b, 0), `${i} vs ${j}`).toBe(false);
  });
  it("no box touches a point other than its own", () => {
    for (const [b, i] of drawn) pts.forEach((p, j) => j !== i && expect(boxHitsCircle(b, p, 0), `label ${i} on point ${j}`).toBe(false));
  });
  it("a label sits outside its own point", () => {
    for (const [b, i] of drawn) expect(boxHitsCircle(b, pts[i]!, 0), `label ${i}`).toBe(false);
  });
  it("every box is inside the area, on whole pixels", () => {
    for (const [b] of drawn) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(area.w);
      expect(b.y + b.h).toBeLessThanOrEqual(area.h);
      expect([b.x, b.y, b.w, b.h].every(Number.isInteger)).toBe(true);
    }
  });
  it("is deterministic", () => {
    expect(run({ order: [0] })).toEqual(boxes);
  });
  it("the first in order gets the first free position, whatever its index", () => {
    const a = run({ order: [3] });
    expect(a[3]).toEqual(placeLabels({ anchors: [pts[3]!], sizes: [sizes[3]!], area, circles: [], placed: [] })[0]);
  });
  it("drops a label that has no free position", () => {
    const tiny: Box = { x: 0, y: 0, w: 30, h: 20 };
    expect(placeLabels({ anchors: [{ x: 15, y: 10, r: 4 }], sizes: [{ w: 40, h: 15 }], area: tiny, circles: [], placed: [] })).toEqual([null]);
  });
  it("drops the one that cannot fit and keeps the one that can", () => {
    const out = placeLabels({ anchors: [{ x: 100, y: 100, r: 5 }, { x: 100, y: 200, r: 5 }], sizes: [{ w: 3000, h: 15 }, { w: 40, h: 15 }], area, circles: [], placed: [] });
    expect(out[0]).toBeNull();
    expect(out[1]).not.toBeNull();
  });
  it("skips a position blocked by another point", () => {
    const a: Anchor = { x: 200, y: 150, r: 5 };
    const block: Circle = { x: 200, y: 150 - 5 - 2 - 8, r: 12 };
    const free = placeLabels({ anchors: [a], sizes: [{ w: 30, h: 15 }], area, circles: [], placed: [] })[0]!;
    const on = placeLabels({ anchors: [a], sizes: [{ w: 30, h: 15 }], area, circles: [block], placed: [] })[0]!;
    expect(free.y + free.h).toBeLessThan(a.y); // top
    expect(boxHitsCircle(on, block, 0)).toBe(false);
    expect(on).not.toEqual(free);
  });
  it("shares taken boxes with other text marks", () => {
    const placed: Box[] = [];
    placeLabels({ anchors: [pts[0]!], sizes: [sizes[0]!], area, circles: [], placed });
    expect(placed).toHaveLength(1);
    const b = placeLabels({ anchors: [pts[0]!], sizes: [sizes[0]!], area, circles: [], placed })[0]!;
    expect(boxesTouch(b, placed[0]!, 0)).toBe(false);
  });
  it("a bigger point at the same spot pushes the label out, and a label with no anchor stays off its own dot", () => {
    const a: Anchor = { x: 200, y: 150, r: 4 };
    const big: Circle = { x: 200, y: 150, r: 20 };
    const b = placeLabels({ anchors: [a], sizes: [{ w: 40, h: 15 }], area, circles: [big], placed: [] })[0]!;
    expect(boxHitsCircle(b, big, 0)).toBe(false);
    const dot: Circle = { x: 200, y: 150, r: 3.5 };
    const c = placeLabels({ anchors: [{ x: 200, y: 150, r: 0 }], sizes: [{ w: 40, h: 15 }], area, circles: [dot], placed: [] })[0]!;
    expect(boxHitsCircle(c, dot, 0)).toBe(false);
  });
  it("a point with no position gets no label", () => {
    expect(placeLabels({ anchors: [{ x: NaN, y: 3, r: 0 }], sizes: [{ w: 10, h: 10 }], area, circles: [], placed: [] })).toEqual([null]);
  });
});

describe("label spec validation", () => {
  const text = (extra: Record<string, unknown>): Mark[] => [{ type: "text", x: [1, 2], y: [1, 2], text: ["a", "b"], ...extra } as Mark];
  const prep = (marks: Mark[]) => prepare({ marks, scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
  it("accepts a full spec", () => {
    expect(() => prep(text({ chip: { background: "#fff", border: "#ccc", color: "#000", padding: [4, 1], radius: 2, etch: { color: "rgba(0,0,0,0.3)", spacing: 6, width: 1.5 } }, chips: [null, { background: "#eee" }], weights: ["bold", "normal"], anchor: { radius: [3, 4] }, avoid: { marks: true, order: [1, 0] } }))).not.toThrow();
  });
  it.each([
    [{ chip: { background: "not a colour" } }, /./],
    [{ chip: { etch: { color: "nope" } } }, /./],
    [{ chips: [{ border: "#zzz" }, null] }, /./],
    [{ chips: [null] }, /chips has 1 entries for 2 labels/],
    [{ weights: ["bold"] }, /weights has 1/],
    [{ weights: ["bold", "heavy"] }, /weights\[1\]/],
    [{ anchor: { radius: [1] } }, /anchor.radius has 1/],
    [{ anchor: "Banks" }, /anchor must be an object/],
    [{ anchor: [] }, /anchor must be an object/],
    [{ anchor: 5 }, /anchor must be an object/],
    [{ anchor: { from: 3 } }, /anchor.from must be/],
    [{ anchor: { radius: -2 } }, /anchor.radius/],
    [{ anchor: { from: "nothing" } }, /anchor.from "nothing"/],
    [{ chip: { padding: [1] } }, /padding/],
    [{ chip: { padding: -1 } }, /padding/],
    [{ chip: { radius: NaN } }, /radius/],
    [{ chip: { etch: { color: "#000", spacing: 0 } } }, /spacing/],
    [{ avoid: { order: [2] } }, /order\[0\] = 2/],
    [{ avoid: { order: [0, 0] } }, /twice/],
    [{ avoid: { marks: "yes" } }, /avoid.marks/],
  ])("rejects %j", (extra, re) => {
    expect(() => prep(text(extra as Record<string, unknown>))).toThrow(re);
  });
  it("anchor.from needs a scatter of the same length", () => {
    const sc: Mark = { type: "scatter", name: "S", x: [1, 2, 3], y: [1, 2, 3] };
    expect(() => prep([sc, ...text({ anchor: { from: "S" } })])).toThrow(/3 points for 2 labels/);
    expect(() => prep([{ ...sc, x: [1, 2], y: [1, 2] } as Mark, ...text({ anchor: { from: "S" } })])).not.toThrow();
  });
});

describe("number text in exports", () => {
  it("drops float noise, keeps real data", () => {
    expect(numText(16491689768.999998)).toBe("16491689769");
    expect(numText(1.0000000000000002)).toBe("1");
    expect(numText(0.1 + 0.2)).toBe("0.3");
    expect(numText(13.11)).toBe("13.11");
    expect(numText(123456789012345)).toBe("123456789012345");
    expect(numText(9007199254740991)).toBe("9007199254740991");
    expect(numText(1234567890123456)).toBe("1234567890123456");
    expect(numText(-2.5)).toBe("-2.5");
    expect(numText(0)).toBe("0");
    expect(numText(1e-7)).toBe("1e-7");
    expect(numText(Infinity)).toBe("Infinity");
  });
  it("CSV and the table rows use it for every numeric column", () => {
    const p = prepare({ marks: [{ type: "scatter", x: [1.0000000000000002, 2], y: [16491689768.999998, 3], size: [0.1 + 0.2, 1] }], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
    const bar = prepare({ marks: [{ type: "bar", x: ["a"], y: [0.1 + 0.2] }], scales: undefined, theme: PLOT_LIGHT, hidden: new Set(), colors: new Map() });
    const out = plotted([{ prepared: p }, { prepared: bar }]);
    expect(out.rows[0]).toMatchObject({ x: "1", y: "16491689769", size: "0.3" });
    expect(out.rows[2]).toMatchObject({ y: "0.3" });
    expect(toCsv(out)).not.toMatch(/0000000000|9999999/);
  });
});
