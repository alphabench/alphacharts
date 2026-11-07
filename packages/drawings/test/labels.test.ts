// Price labels of levels: a horizontal ray's label sits at its left end, and the labels of levels close together
// are moved clear of one another (`stack`), never printed over each other.

import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE } from "../src/types.js";
import { declutter, textBox } from "../src/shapes.js";
import type { Shape } from "../src/types.js";
import { ctx, k, plugin } from "./helpers.js";

type Text = Extract<Shape, { k: "text" }>;
const measure = (t: string, f: string) => t.length * parseFloat(f.match(/(\d+(?:\.\d+)?)px/)![1]!) * 0.6;
const label = (y: number): Text => ({ k: "text", x: 700, y, text: "24579.90", align: "right", base: "bottom", stack: true });
const texts = (shapes: Shape[]) => shapes.filter((s): s is Text => s.k === "text");

describe("horizontal ray label", () => {
  it("sits left of the ray's start, centred on the line, when there is room", () => {
    const { p } = plugin();
    const d = p.add({ tool: "horizontalRay", anchors: [k(100, 110)] });
    const shapes = p.toolDef("horizontalRay").shapes(d, ctx());
    const start = shapes.find((s) => s.k === "line")!;
    const [t] = texts(shapes);
    expect(t!.align).toBe("right");
    expect(t!.base).toBe("middle");
    expect(t!.x).toBeLessThan((start as { x1: number }).x1);
    expect(t!.stack).toBe(true);
  });

  it("sits above the line at its start when the ray starts at the pane's left edge", () => {
    const { p } = plugin();
    const d = p.add({ tool: "horizontalRay", anchors: [k(2, 110)] });
    const [t] = texts(p.toolDef("horizontalRay").shapes(d, ctx()));
    expect(t!.align).toBe("left");
    expect(t!.base).toBe("bottom");
  });
});

describe("declutter", () => {
  const box = (s: Text) => textBox(s, DEFAULT_STYLE, measure);
  const overlap = (a: Text, b: Text) => {
    const p = box(a), q = box(b);
    return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  };

  it("moves a label that overlaps another down until it clears it", () => {
    const a = label(100), b = label(106), c = label(111);
    declutter([a, b, c].map((s) => ({ s, style: DEFAULT_STYLE })), measure);
    expect(overlap(a, b)).toBe(false);
    expect(overlap(b, c)).toBe(false);
    expect(overlap(a, c)).toBe(false);
    expect(a.y).toBe(100);
  });

  it("leaves labels that do not overlap where they are", () => {
    const a = label(100), b = label(200);
    declutter([a, b].map((s) => ({ s, style: DEFAULT_STYLE })), measure);
    expect([a.y, b.y]).toEqual([100, 200]);
  });

  it("leaves labels apart in x where they are", () => {
    const a = label(100), b = { ...label(100), x: 200 };
    declutter([a, b].map((s) => ({ s, style: DEFAULT_STYLE })), measure);
    expect([a.y, b.y]).toEqual([100, 100]);
  });
});
