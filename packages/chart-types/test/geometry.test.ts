// Renderer geometry that does not need a GPU: the Canvas2D renderers run
// against a recording Path2D and a hand-built view, and the integer snapping
// is checked against the arithmetic written in each case.
//
// View used throughout: spacing 10 CSS px, DPR 1, level 0, bar i centred at
// x = 100 + 10 i, and y(price) = 200 - price (so higher prices are higher up).

import type { DrawView2D, SeriesData } from "@alphacharts/core";
import { barWidths } from "@alphacharts/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bricks2D, brickWidth } from "../src/series/bricks.js";
import { Columns2D } from "../src/series/columns.js";
import { HiLo2D } from "../src/series/hi-lo.js";
import { HollowCandles2D } from "../src/series/hollow-candles.js";
import { Kagi2D, kagiWidth } from "../src/series/kagi.js";
import { markersFit } from "../src/series/line-markers.js";
import { PointFigure2D } from "../src/series/point-figure.js";
import { ordinalOf, ordinalTime, ordinalTimeLabel } from "../src/store.js";

type Call = [string, ...number[]];

/** Records every path call, keyed by the Path2D's creation order. */
class FakePath {
  static all: FakePath[] = [];
  calls: Call[] = [];
  constructor() {
    FakePath.all.push(this);
  }
  rect(...a: number[]) { this.calls.push(["rect", ...a]); }
  moveTo(...a: number[]) { this.calls.push(["moveTo", ...a]); }
  lineTo(...a: number[]) { this.calls.push(["lineTo", ...a]); }
  arc(...a: number[]) { this.calls.push(["arc", ...a]); }
  closePath() {}
}

/** Fills and strokes in order: [style, path]. */
function view(rowsOhlc: number[][], opts: { logCoords?: boolean } = {}): { v: DrawView2D; painted: { op: string; style: string; path: FakePath }[] } {
  const n = rowsOhlc.length;
  const col = (k: number) => Float64Array.from(rowsOhlc.map((r) => r[k]!));
  const data = {
    shape: "ohlc",
    store: { cols: [col(0), col(1), col(2), col(3)], head: 0, first: 0, end: n },
    lod: { levels: [], level: () => undefined },
  } as unknown as SeriesData;
  const painted: { op: string; style: string; path: FakePath }[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fill: (p: FakePath) => painted.push({ op: "fill", style: String(ctx.fillStyle), path: p }),
    stroke: (p: FakePath) => painted.push({ op: "stroke", style: String(ctx.strokeStyle), path: p }),
  };
  const v = {
    ctx,
    data,
    time: { spacing: 10, x: (i: number) => 100 + 10 * i },
    price: { y: (p: number) => 200 - p, logCoords: opts.logCoords ?? false },
    dpr: 1,
    width: 400,
    height: 300,
    lo: 0,
    hi: n - 1,
  } as unknown as DrawView2D;
  return { v, painted };
}

const g = globalThis as unknown as { Path2D: unknown };
let realPath: unknown;
beforeEach(() => {
  FakePath.all = [];
  realPath = g.Path2D;
  g.Path2D = FakePath;
});
afterEach(() => {
  g.Path2D = realPath;
});

const rectsOf = (p: { path: FakePath }) => p.path.calls.filter((c) => c[0] === "rect").map((c) => c.slice(1));
const find = (painted: { style: string; path: FakePath }[], style: string) => painted.find((p) => p.style === style)!;

describe("widths", () => {
  it("body width at spacing 10, DPR 1: floor(10 * 0.8) = 8, one wick pixel, parity (8 - 1) odd -> 7", () => {
    expect(barWidths(10, 1, 0, 0.8)).toEqual([7, 1]);
  });
  it("brick width: the full column (10) less one separating pixel once it is at least 4 wide", () => {
    expect(brickWidth(10, 1, 0)).toBe(9);
    expect(brickWidth(10, 2, 0)).toBe(18); // 20 - floor(2)
    expect(brickWidth(3, 1, 0)).toBe(3); // too narrow to separate
  });
  it("kagi line width rounds to whole device pixels, at least 1", () => {
    expect(kagiWidth(1.5, 1)).toBe(2);
    expect(kagiWidth(1.5, 2)).toBe(3);
    expect(kagiWidth(0.2, 1)).toBe(1);
  });
  it("markers show only when the neighbour spacing leaves room (2 r + 2) and at level 0", () => {
    expect(markersFit(8, 3, 0)).toBe(true);
    expect(markersFit(7.9, 3, 0)).toBe(false);
    expect(markersFit(40, 3, 3)).toBe(false);
  });
});

describe("Canvas2D geometry", () => {
  it("hi-lo: a bar with high 120 and low 100 at x 100 is one 7 px column from y 80 to 100", () => {
    const { v, painted } = view([[110, 120, 100, 115]]);
    new HiLo2D().draw(v, { color: "#abc" });
    // left = floor(100 - 7/2 + 0.5) = floor(97) = 97; y(120) = 80, y(100) = 100.
    expect(rectsOf(find(painted, "#abc"))).toEqual([[97, 80, 7, 20]]);
  });

  it("hi-lo: a bar with high == low is one pixel tall, not invisible", () => {
    const { v, painted } = view([[110, 110, 110, 110]]);
    new HiLo2D().draw(v, { color: "#abc" });
    expect(rectsOf(find(painted, "#abc"))).toEqual([[97, 90, 7, 1]]);
  });

  const HOLLOW = { upColor: "up", downColor: "down", wickUpColor: "wup", wickDownColor: "wdown" };

  it("hollow candles: a rising bar is a one-pixel outline of its body, with a wick, and no solid fill", () => {
    const { v, painted } = view([[110, 120, 100, 115]]);
    new HollowCandles2D().draw(v, HOLLOW);
    // left 97, width 7, t = 1. Body from y(115) = 85 to y(110) = 90 (height 5): top, bottom, left and right edges.
    expect(rectsOf(find(painted, "up"))).toEqual([[97, 85, 7, 1], [97, 89, 7, 1], [97, 85, 1, 5], [103, 85, 1, 5]]);
    // wick from y(120) = 80 to y(100) = 100, centred in the body: x = 97 + (7 - 1) / 2 = 100
    expect(rectsOf(find(painted, "wup"))).toEqual([[100, 80, 1, 20]]);
  });

  it("hollow candles: a falling bar is a solid body in the down colour", () => {
    const { v, painted } = view([[115, 120, 100, 110]]);
    new HollowCandles2D().draw(v, HOLLOW);
    expect(rectsOf(find(painted, "down"))).toEqual([[97, 85, 7, 5]]);
    expect(rectsOf(find(painted, "up"))).toEqual([]);
  });

  it("hollow candles: a rising body too short to show an inside draws solid, so it never vanishes", () => {
    const { v, painted } = view([[110, 120, 100, 111.5]]);
    new HollowCandles2D().draw(v, HOLLOW);
    // y(111.5) = 88.5 -> 89, y(110) = 90: one pixel tall, below the 2 t + 1 = 3 an outline needs.
    expect(rectsOf(find(painted, "up"))).toEqual([[97, 89, 7, 1]]);
  });

  it("columns: from the pane bottom (300) up to the close; up when close >= open", () => {
    const { v, painted } = view([[110, 120, 100, 115], [115, 116, 90, 95]]);
    new Columns2D().draw(v, { upColor: "up", downColor: "down", base: "bottom" });
    // close 115 -> y 85, bottom 300: [85, 300) = height 215. Second: close 95 -> y 105, height 195; x 110 -> left 107.
    expect(rectsOf(find(painted, "up"))).toEqual([[97, 85, 7, 215]]);
    expect(rectsOf(find(painted, "down"))).toEqual([[107, 105, 7, 195]]);
  });

  it("columns: a price base draws between the base and the close on either side of it", () => {
    const { v, painted } = view([[110, 120, 100, 115], [115, 116, 90, 95]]);
    new Columns2D().draw(v, { upColor: "up", downColor: "down", base: 100 });
    // base y = 100. Close 115 -> y 85: rect y 85..100 (15). Close 95 -> y 105: rect y 100..105 (5).
    expect(rectsOf(find(painted, "up"))).toEqual([[97, 85, 7, 15]]);
    expect(rectsOf(find(painted, "down"))).toEqual([[107, 100, 7, 5]]);
  });

  it("bricks: the body spans open to close with no wick, 9 px wide at spacing 10", () => {
    const { v, painted } = view([[100, 110, 100, 110], [110, 110, 100, 100]]);
    new Bricks2D().draw(v, { upColor: "up", downColor: "down" });
    // up brick 100 -> 110: y 100 .. 90 -> rect y 90, h 10; left = floor(100 - 4.5 + 0.5) = 96.
    expect(rectsOf(find(painted, "up"))).toEqual([[96, 90, 9, 10]]);
    // down brick 110 -> 100 at x 110: left 106, same y range.
    expect(rectsOf(find(painted, "down"))).toEqual([[106, 90, 9, 10]]);
  });

  it("kagi: a 2 px vertical per line and a connector from line to line at the first line's close", () => {
    // Line 0 up 100 -> 120 (high 120, low 100, close 120); line 1 down 120 -> 105.
    const { v, painted } = view([[100, 120, 100, 120], [120, 120, 105, 105]]);
    new Kagi2D().draw(v, { upColor: "up", downColor: "down", lineWidth: 1.5, connectors: true });
    // t = round(1.5) = 2. Line 0: left = floor(100 - 1 + 0.5) = 99, y(120) = 80 .. y(100) = 100.
    // Connector at close 120 (y 80): x0 = 99, to line 1's left (109) + 2 = 111 -> width 12, y = floor(80 - 1 + 0.5) = 79, height 2.
    expect(rectsOf(find(painted, "up"))).toEqual([[99, 80, 2, 20], [99, 79, 12, 2]]);
    // Line 1: left 109, y(120) = 80 .. y(105) = 95.
    expect(rectsOf(find(painted, "down"))).toEqual([[109, 80, 2, 15]]);
  });

  it("kagi: no connector without the option (the thick overlay)", () => {
    const { v, painted } = view([[100, 120, 100, 120], [120, 120, 105, 105]]);
    new Kagi2D().draw(v, { upColor: "up", downColor: "down", lineWidth: 3, connectors: false });
    expect(rectsOf(find(painted, "up")).length).toBe(1);
  });

  it("point & figure: one X per box, a 6 box column of 25 px boxes", () => {
    // Column from 100 to 250 (6 boxes of 25), X (close > open). y(250) = -50 .. y(100) = 100: 150 px, 25 px per box.
    const { v, painted } = view([[100, 250, 100, 250]]);
    new PointFigure2D().draw(v, { upColor: "up", downColor: "down", boxSize: 25, lineWidth: 1.5 });
    const xs = painted.find((p) => p.op === "stroke" && p.style === "up")!.path.calls;
    expect(xs.filter((c) => c[0] === "moveTo").length).toBe(12); // 2 diagonals per box
    // Cell is min(10, 25) = 10 px, glyph half-size 0.39 * 10 = 3.9, first box centre y = -50 + 12.5.
    const first = xs.slice(0, 4);
    expect(first[0]![1]).toBeCloseTo(100 - 3.9, 10);
    expect(first[0]![2]).toBeCloseTo(-50 + 12.5 - 3.9, 10);
    expect(first[1]![1]).toBeCloseTo(100 + 3.9, 10);
  });

  it("point & figure: an O column draws rings, and a missing box size throws", () => {
    const { v, painted } = view([[250, 250, 200, 200]]);
    new PointFigure2D().draw(v, { upColor: "up", downColor: "down", boxSize: 25, lineWidth: 1.5 });
    const rings = painted.find((p) => p.op === "stroke" && p.style === "down")!.path.calls.filter((c) => c[0] === "arc");
    expect(rings.length).toBe(2); // (250 - 200) / 25 boxes
    expect(() => new PointFigure2D().draw(v, { upColor: "up", downColor: "down", boxSize: Number.NaN, lineWidth: 1 })).toThrow(/boxSize/);
  });

  it("point & figure refuses a log scale", () => {
    const { v } = view([[100, 250, 100, 250]], { logCoords: true });
    expect(() => new PointFigure2D().draw(v, { upColor: "up", downColor: "down", boxSize: 25, lineWidth: 1 })).toThrow(/log/);
  });
});

describe("ordinal axis", () => {
  it("ordinalTime and ordinalOf are inverses; real times are not ordinals", () => {
    expect(ordinalOf(ordinalTime(41))).toBe(41);
    expect(ordinalOf(Date.UTC(2026, 9, 20, 9, 15))).toBeUndefined();
    expect(ordinalOf(-86_400_000)).toBeUndefined();
  });
  it("labels the bar number, 1-based, and refuses a real time", () => {
    expect(ordinalTimeLabel(ordinalTime(9), "tick")).toBe("10");
    expect(ordinalTimeLabel(ordinalTime(9), "crosshair")).toBe("bar 10");
    expect(() => ordinalTimeLabel(Date.UTC(2026, 9, 20, 9, 15), "tick")).toThrow(/not on the ordinal axis/);
  });
});
