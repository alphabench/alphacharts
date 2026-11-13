// Dashed and dotted line series: the pattern a style names, the Canvas2D stroke it sets (and resets), and the shader
// uniform the WebGL2 line takes it through.
import { beforeAll, describe, expect, it } from "vitest";
import { Area2D, Line2D, type DrawView2D } from "../src/render/canvas2d.js";
import { linePattern } from "../src/render/renderers.js";
import { DataModel } from "../src/data/model.js";

class FakePath {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
}
beforeAll(() => { (globalThis as { Path2D?: unknown }).Path2D = FakePath; });

function recorder() {
  const strokes: { dash: number[]; cap: string; width: number }[] = [];
  let dash: number[] = [];
  let sets = 0;
  const ctx = {
    strokeStyle: "", fillStyle: "", lineWidth: 1, lineJoin: "", lineCap: "",
    setLineDash(d: number[]) { dash = [...d]; sets++; },
    getLineDash() { return dash; },
    createLinearGradient() { return { addColorStop() {} }; },
    fill() {},
    stroke() { strokes.push({ dash: [...dash], cap: this.lineCap, width: this.lineWidth }); },
  };
  return { ctx, strokes, dashNow: () => dash, sets: () => sets };
}

function view(ctx: unknown, dpr = 1): DrawView2D {
  const m = new DataModel();
  const s = m.add("value");
  m.setData(s, [1, 2, 3].map((i) => ({ time: i * 1000, value: 100 + i })));
  return {
    ctx: ctx as CanvasRenderingContext2D, data: s, dpr, width: 400, height: 100, lo: 0, hi: 3,
    time: { x: (i: number) => i * 10, spacing: 10 } as never,
    price: { y: (p: number) => 100 - p, logCoords: false } as never,
  };
}

describe("linePattern", () => {
  it("is empty for solid and for no style", () => {
    expect(linePattern(undefined, 2)).toEqual([]);
    expect(linePattern("solid", 2)).toEqual([]);
  });
  it("scales the price lines' patterns with the width", () => {
    expect(linePattern("dashed", 2)).toEqual([8, 6]);
    expect(linePattern("dotted", 2)).toEqual([2, 4]);
  });
  it("throws on a style it does not know", () => {
    expect(() => linePattern("wavy" as never, 1)).toThrow(/unknown lineStyle/);
  });
});

describe("Canvas2D line styles", () => {
  it("a dashed line strokes with the pattern in device px and butt caps, then resets the dash", () => {
    const { ctx, strokes, dashNow } = recorder();
    new Line2D().draw(view(ctx, 2), { color: "c", lineWidth: 1, lineStyle: "dashed" });
    expect(strokes).toEqual([{ dash: [8, 6], cap: "butt", width: 2 }]);
    expect(dashNow()).toEqual([]);
  });
  it("a solid line keeps round caps and never sets a dash", () => {
    const { ctx, strokes, sets } = recorder();
    new Line2D().draw(view(ctx), { color: "c", lineWidth: 1 });
    expect(strokes).toEqual([{ dash: [], cap: "round", width: 1 }]);
    expect(sets()).toBe(0);
  });
  it("an area's outline takes its style", () => {
    const { ctx, strokes } = recorder();
    new Area2D().draw(view(ctx), { lineColor: "c", topColor: "t", bottomColor: "b", lineWidth: 1, lineStyle: "dotted" });
    expect(strokes.map((s) => s.dash)).toEqual([[1, 2]]);
  });
});
