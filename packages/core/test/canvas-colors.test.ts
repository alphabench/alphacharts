// The Canvas2D colour paths (candles, bars, per-point lines), driven through a recording context and a Path2D stub:
// which fill / stroke style gets how many marks, at raw resolution and at a deep zoom-out where a pixel holds many bars.
import { beforeAll, describe, expect, it } from "vitest";
import { Bars2D, Candles2D, Line2D, type DrawView2D } from "../src/render/canvas2d.js";
import { DataModel, type OhlcBar } from "../src/data/model.js";
import { LOD_BASE } from "../src/data/lod.js";
import { chooseLevel } from "../src/render/window.js";
import { cssColor, parseColor } from "../src/render/color.js";

class FakePath {
  rects = 0;
  moves = 0;
  lines = 0;
  rect(): void { this.rects++; }
  moveTo(): void { this.moves++; }
  lineTo(): void { this.lines++; }
}
beforeAll(() => { (globalThis as { Path2D?: unknown }).Path2D = FakePath; });

interface Mark { style: string; path: FakePath; op: "fill" | "stroke" }
function recorder() {
  const marks: Mark[] = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineJoin: "", lineCap: "",
    fill(p: FakePath) { marks.push({ style: this.fillStyle, path: p, op: "fill" }); },
    stroke(p: FakePath) { marks.push({ style: this.strokeStyle, path: p, op: "stroke" }); },
  };
  return { ctx, marks };
}
function view(data: ReturnType<DataModel["add"]>, ctx: unknown, spacing: number, n: number): DrawView2D {
  return {
    ctx: ctx as CanvasRenderingContext2D, data, dpr: 1, width: 4000, height: 1000, lo: 0, hi: n,
    time: { x: (i: number) => i * spacing, spacing } as never,
    price: { y: (p: number) => 900 - p, logCoords: false } as never,
  };
}

const RED = parseColor("#ff0000");
const RED_CSS = cssColor(RED);
const st = { upColor: "up", downColor: "down", wickUpColor: "wup", wickDownColor: "wdown" } as never;
const bar = (i: number): OhlcBar => ({ time: (i + 1) * 1000, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i });
const rectsOf = (marks: Mark[], style: string) => marks.filter((m) => m.style === style).reduce((a, m) => a + m.path.rects, 0);

function colored(n: number, at: number[]) {
  const m = new DataModel();
  const s = m.add("ohlc");
  m.setData(s, Array.from({ length: n }, (_, i) => bar(i)));
  m.setColors(s, { time: Float64Array.from(at.map((i) => (i + 1) * 1000)), color: new Uint32Array(at.length).fill(RED) });
  return s;
}

describe("Canvas2D bar colours at raw resolution", () => {
  it("candles: a coloured bar's body and wick leave the up/down paths and go into one path of its colour", () => {
    const s = colored(3, [1]);
    const { ctx, marks } = recorder();
    new Candles2D().draw(view(s, ctx, 10, 3), st);
    expect(rectsOf(marks, RED_CSS)).toBe(2); // wick + body of bar 1
    expect(rectsOf(marks, "up")).toBe(2); // bodies of bars 0 and 2 (all three bars are up bars)
    expect(rectsOf(marks, "wup")).toBe(2);
    expect(marks[marks.length - 1]!.style).toBe(RED_CSS); // drawn after the plain ones
  });
  it("bars: the three strokes of a coloured bar go into its colour's path", () => {
    const s = colored(3, [1]);
    const { ctx, marks } = recorder();
    new Bars2D().draw(view(s, ctx, 10, 3), { upColor: "up", downColor: "down" } as never);
    expect(rectsOf(marks, RED_CSS)).toBe(3);
    expect(rectsOf(marks, "up")).toBe(6);
  });
  it("two colours make two paths, and a series never coloured draws exactly as before", () => {
    const s = colored(4, [0]);
    const m2 = new DataModel();
    const plain = m2.add("ohlc");
    m2.setData(plain, Array.from({ length: 4 }, (_, i) => bar(i)));
    const a = recorder();
    new Candles2D().draw(view(plain, a.ctx, 10, 4), st);
    expect(a.marks.map((x) => x.style)).toEqual(["wup", "wdown", "up", "down"]);
    const b = recorder();
    new Candles2D().draw(view(s, b.ctx, 10, 4), st);
    expect(b.marks.map((x) => x.style)).toEqual(["wup", "wdown", "up", "down", RED_CSS]);
  });
});

describe("Canvas2D per-point line colours", () => {
  const pts = (cols: (string | undefined)[]) => cols.map((color, i) => ({ time: (i + 1) * 1000, value: 100 + i, ...(color ? { color } : {}) }));
  it("each segment takes the colour of the point it arrives at; 0 is the series colour", () => {
    const m = new DataModel();
    const s = m.add("value");
    m.setData(s, pts([undefined, "#ff0000", "#ff0000", undefined]));
    expect(s.pointColors).toBe(true);
    const { ctx, marks } = recorder();
    new Line2D().draw(view(s, ctx, 10, 4), { color: "series", lineWidth: 1 } as never);
    const red = marks.filter((x) => x.style === RED_CSS), base = marks.filter((x) => x.style === "series");
    expect(red.map((x) => x.op)).toEqual(["stroke"]);
    expect(red[0]!.path.lines).toBe(2); // segments 0->1 and 1->2 arrive at red points
    expect(base[0]!.path.lines).toBe(1); // segment 2->3 arrives at the uncoloured point; point 0 has no segment
  });
  it("a series with no coloured point strokes one path in the series colour", () => {
    const m = new DataModel();
    const s = m.add("value");
    m.setData(s, pts([undefined, undefined, undefined]));
    expect(s.pointColors).toBe(false);
    const { ctx, marks } = recorder();
    new Line2D().draw(view(s, ctx, 10, 3), { color: "series", lineWidth: 1 } as never);
    expect(marks.map((x) => x.style)).toEqual(["series"]);
  });
});

describe("Canvas2D colours at deep zoom-out (a pixel holds many bars)", () => {
  const n = 1024;
  it("one coloured bar among a thousand still shows, in its colour, in its bucket", () => {
    const s = colored(n, [300]);
    const spacing = 0.01; // 100 bars per pixel
    expect(chooseLevel(s, spacing)).toBeGreaterThanOrEqual(LOD_BASE);
    for (const Draw of [Candles2D, Bars2D]) {
      const { ctx, marks } = recorder();
      new Draw().draw(view(s, ctx, spacing, n), st);
      expect(rectsOf(marks, RED_CSS), Draw.name).toBeGreaterThan(0);
      expect(marks.filter((x) => x.style === RED_CSS)).toHaveLength(1);
    }
  });
  it("an uncoloured series has no coloured mark at that zoom", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    m.setData(s, Array.from({ length: n }, (_, i) => bar(i)));
    const { ctx, marks } = recorder();
    new Candles2D().draw(view(s, ctx, 0.01, n), st);
    expect(marks.map((x) => x.style)).toEqual(["wup", "wdown", "up", "down"]);
  });
  it("a coloured line point is kept in its bucket's colour only when it made the bucket's high (value series pyramid)", () => {
    // Documents the current rule: a value series' bucket takes the colour of the row that made its high.
    const m = new DataModel();
    const s = m.add("value");
    const rows = Array.from({ length: n }, (_, i) => ({ time: (i + 1) * 1000, value: i === 300 ? 5000 : 100 + (i % 7), ...(i === 300 || i === 301 ? { color: "#ff0000" } : {}) }));
    m.setData(s, rows);
    const { ctx, marks } = recorder();
    new Line2D().draw(view(s, ctx, 0.01, n), { color: "series", lineWidth: 1 } as never);
    expect(marks.some((x) => x.style === RED_CSS)).toBe(true);
  });
});
