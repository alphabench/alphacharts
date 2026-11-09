// Every tool: validates, draws, serializes, and is hit-testable; plus the
// geometry of each family at exact coordinates.

import { describe, expect, it } from "vitest";
import { clipLine, circumcircle, distToSegment, pointInPolygon } from "../src/geometry.js";
import { shapeDistance } from "../src/shapes.js";
import { allTools } from "../src/tools/all.js";
import { arcThrough, rotatedRectCorners } from "../src/tools/figures.js";
import { forkGeometry } from "../src/tools/channels.js";
import type { Shape } from "../src/types.js";
import { BARS, H, W, ctx, fixture, k, plugin, px, recorder, view } from "./helpers.js";

const measure = (t: string, f: string) => t.length * parseFloat(f.match(/(\d+(?:\.\d+)?)px/)![1]!) * 0.6;

/** A point that lies on the first hittable, non-text shape of a drawing. */
function pointOn(s: Shape): { x: number; y: number } | null {
  if (s.hit === false || s.k === "text") return null;
  switch (s.k) {
    case "line": return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    case "poly": {
      const n = s.pts.length / 2;
      if (s.fill && s.width === 0) {
        let cx = 0, cy = 0;
        for (let i = 0; i < n; i++) (cx += s.pts[2 * i]!, (cy += s.pts[2 * i + 1]!));
        return { x: cx / n, y: cy / n };
      }
      return { x: s.pts[0]!, y: s.pts[1]! };
    }
    case "ellipse": return { x: s.cx + s.rx, y: s.cy };
    case "arc": return { x: s.cx + s.r * Math.cos(s.a0), y: s.cy + s.r * Math.sin(s.a0) };
  }
}

describe("every tool", () => {
  it("has 90 tools with unique ids", () => {
    expect(allTools.length).toBe(90);
    expect(new Set(allTools.map((t) => t.id)).size).toBe(90);
  });

  for (const def of allTools) {
    describe(def.id, () => {
      it("creates, draws without error and with finite numbers", () => {
        const { p, chart, errors } = plugin();
        p.add(fixture(def.id));
        const { ctx: c, calls } = recorder();
        p.drawPane(c, chart.api.paneView(0));
        expect(errors).toEqual([]);
        expect(calls.length).toBeGreaterThan(0);
      });

      it("is hit where its stroke or fill is, and not far away", () => {
        const { p, errors } = plugin();
        const d = p.add(fixture(def.id));
        const shapes = def.shapes(d, ctx());
        let target: { x: number; y: number } | null = null;
        for (const s of shapes) if ((target = pointOn(s))) break;
        if (!target) {
          const t = shapes.find((s) => s.k === "text" && s.hit !== false) as Extract<Shape, { k: "text" }> | undefined;
          expect(t, `${def.id} has nothing hittable`).toBeDefined();
          target = { x: t!.x + 2, y: t!.y + (t!.base === "bottom" ? -2 : 2) };
        }
        expect(shapes.some((s) => shapeDistance(s, target!.x, target!.y, W, H, d.style, measure) <= 1), `${def.id} shape distance`).toBe(true);
        expect(p.hitTest(0, target.x, target.y, 3)?.id).toBe(d.id);
        expect(p.hitTest(0, -5000, -5000, 5)).toBeNull();
        expect(errors).toEqual([]);
      });

      it("round-trips through JSON to identical shapes", () => {
        const a = plugin();
        const d = a.p.add(fixture(def.id));
        const json = JSON.parse(JSON.stringify(a.p.toJSON()));
        const b = plugin();
        b.p.fromJSON(json);
        expect(b.p.toJSON()).toEqual(a.p.toJSON());
        expect(def.shapes(b.p.get(d.id)!, ctx())).toEqual(def.shapes(d, ctx()));
      });
    });
  }
});

describe("line geometry", () => {
  it("clips a segment and its rays to the pane", () => {
    expect(clipLine(100, 100, 200, 100, false, false, 800, 400)).toEqual([100, 100, 200, 100]);
    expect(clipLine(100, 100, 200, 100, true, true, 800, 400, 0)).toEqual([0, 100, 800, 100]);
    expect(clipLine(100, 100, 200, 100, false, true, 800, 400, 0)).toEqual([100, 100, 800, 100]);
    expect(clipLine(100, 500, 200, 500, true, true, 800, 400)).toBeNull();
    // 45° ray from (100,100) leaves through the bottom edge at (400,400)
    expect(clipLine(100, 100, 200, 200, false, true, 800, 400, 0)).toEqual([100, 100, 400, 400]);
  });

  it("measures distance to a segment, clamped to its ends", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
  });

  it("trend line: hit on the line within tolerance, extension only when asked", () => {
    const { p } = plugin();
    const d = p.add({ tool: "trendLine", anchors: [k(20, 100), k(60, 110)] });
    const a = px(d.anchors[0]!), b = px(d.anchors[1]!);
    expect(p.hitTest(0, (a.x + b.x) / 2, (a.y + b.y) / 2 + 4, 5)?.id).toBe(d.id);
    expect(p.hitTest(0, (a.x + b.x) / 2, (a.y + b.y) / 2 + 9, 5)).toBeNull();
    const beyond = { x: b.x + (b.x - a.x) / 2, y: b.y + (b.y - a.y) / 2 };
    expect(p.hitTest(0, beyond.x, beyond.y, 5)).toBeNull();
    p.update(d.id, { style: { extendRight: true } });
    expect(p.hitTest(0, beyond.x, beyond.y, 5)?.id).toBe(d.id);
  });

  it("horizontal and vertical lines hit anywhere along their length", () => {
    const { p } = plugin();
    const h = p.add({ tool: "horizontalLine", anchors: [k(40, 110)] });
    const v = p.add({ tool: "verticalLine", anchors: [k(150, 110)] });
    const y = view().priceToY(110);
    expect(p.hitTest(0, 700, y)?.id).toBe(h.id);
    expect(p.hitTest(0, view().timeToX(k(150, 0).time), 5)?.id).toBe(v.id);
  });
});

describe("channel and pitchfork geometry", () => {
  it("parallel channel: second line is the baseline shifted by the third anchor's offset", () => {
    const { p } = plugin();
    const d = p.add({ tool: "parallelChannel", anchors: [k(20, 100), k(80, 112), k(50, 114)], props: { midline: false } });
    const shapes = p.toolDef("parallelChannel").shapes(d, ctx());
    const lines = shapes.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line");
    expect(lines).toHaveLength(2);
    // baseline at t=50 is 106 (halfway); anchor 3 is 114 → the offset is 8 price units = 80 px up
    expect(lines[1]!.y1 - lines[0]!.y1).toBeCloseTo(-80, 9);
    expect(lines[1]!.y2 - lines[0]!.y2).toBeCloseTo(-80, 9);
  });

  it("standard pitchfork: median runs from A to the midpoint of B and C; tines through B and C", () => {
    const g = forkGeometry("standard", { x: 0, y: 0 }, { x: 40, y: -20 }, { x: 60, y: 30 });
    expect(g.m).toEqual({ x: 50, y: 5 });
    expect(g.origin).toEqual({ x: 0, y: 0 });
    expect([g.t1, g.t2]).toEqual([{ x: 40, y: -20 }, { x: 60, y: 30 }]);
  });

  it("Schiff and modified Schiff start the median at the A–B midpoint (price only, then both axes); inside uses A–B and A–C midpoints", () => {
    const a = { x: 0, y: 0 }, b = { x: 40, y: -20 }, c = { x: 60, y: 30 };
    expect(forkGeometry("schiff", a, b, c).origin).toEqual({ x: 0, y: -10 });
    expect(forkGeometry("modifiedSchiff", a, b, c).origin).toEqual({ x: 20, y: -10 });
    const i = forkGeometry("inside", a, b, c);
    expect([i.t1, i.t2]).toEqual([{ x: 20, y: -10 }, { x: 30, y: 15 }]);
  });
});

describe("figure geometry", () => {
  it("circumcircle of three points on the unit circle", () => {
    const c = circumcircle({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 })!;
    expect(c.cx).toBeCloseTo(0, 12);
    expect(c.cy).toBeCloseTo(0, 12);
    expect(c.r).toBeCloseTo(1, 12);
    expect(circumcircle({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it("arc sweeps from start to end through the third point", () => {
    const g = arcThrough({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 })!;
    // in y-down screen space (0,1) is at +90°: increasing angle from 0 reaches it before π
    expect(g.a0).toBeCloseTo(0, 12);
    expect(g.a1).toBeCloseTo(Math.PI, 12);
    const h = arcThrough({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 })!;
    expect(h.a1).toBeCloseTo(-Math.PI, 12);
  });

  it("rotated rectangle: far edge is the first edge moved by the signed distance of the third point", () => {
    const q = rotatedRectCorners({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 4 });
    expect(q).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }]);
    expect(() => rotatedRectCorners({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 4 })).toThrow(/coincide/);
  });

  it("rectangle hits inside its fill but a transparent one only on its outline", () => {
    const { p } = plugin();
    const r = p.add({ tool: "rectangle", anchors: [k(20, 100), k(80, 120)] });
    const c = { x: (px(r.anchors[0]!).x + px(r.anchors[1]!).x) / 2, y: (px(r.anchors[0]!).y + px(r.anchors[1]!).y) / 2 };
    expect(p.hitTest(0, c.x, c.y)?.id).toBe(r.id);
    p.update(r.id, { style: { fill: null } });
    expect(p.hitTest(0, c.x, c.y)).toBeNull();
    expect(p.hitTest(0, px(r.anchors[0]!).x, c.y)?.id).toBe(r.id);
  });

  it("point in polygon", () => {
    expect(pointInPolygon(5, 5, [0, 0, 10, 0, 10, 10, 0, 10])).toBe(true);
    expect(pointInPolygon(15, 5, [0, 0, 10, 0, 10, 10, 0, 10])).toBe(false);
  });
});

describe("invalid drawings fail loudly", () => {
  const { p } = plugin();
  it("wrong anchor count", () => expect(() => p.add({ tool: "trendLine", anchors: [k(1, 1)] })).toThrow(/needs 2 anchors/));
  it("unknown tool", () => expect(() => p.add({ tool: "nope", anchors: [] })).toThrow(/unknown tool "nope"/));
  it("non-finite anchor", () => expect(() => p.add({ tool: "trendLine", anchors: [k(1, NaN), k(2, 1)] })).toThrow(/finite/));
  it("channel anchors at one time", () => expect(() => p.add({ tool: "parallelChannel", anchors: [k(5, 1), k(5, 2), k(7, 3)] })).toThrow(/different times/));
  it("long position with the stop above the entry", () =>
    expect(() => p.add({ tool: "longPosition", anchors: [k(1, 100), k(5, 110), k(5, 105)] })).toThrow(/target ≥ entry ≥ stop/));
  it("a bar-reading tool without a source", () => {
    const n = plugin({ source: undefined as never });
    const bare = new (p.constructor as new (o: unknown) => typeof p)({ tools: allTools });
    bare.install(n.chart.api);
    expect(() => bare.add({ tool: "anchoredVwap", anchors: [k(1, 1)] })).toThrow(/needs a BarSource/);
  });
  it("fromJSON refuses a newer version and unknown fields types", () => {
    expect(() => p.fromJSON({ version: 99, drawings: [] })).toThrow(/newer/);
    expect(() => p.fromJSON({ version: 1, drawings: [{}] })).toThrow();
  });
  it("validateState throws what fromJSON would and changes nothing", () => {
    const before = JSON.stringify(p.toJSON());
    expect(() => p.validateState({ version: 99, drawings: [] })).toThrow(/newer/);
    expect(() => p.validateState({ version: 1, drawings: [{}] })).toThrow();
    expect(() => p.validateState(p.toJSON())).not.toThrow();
    expect(JSON.stringify(p.toJSON())).toBe(before);
  });
});

describe("trend angle, sector, side arrows, pin, table, icon, anchored volume profile", () => {
  it("trend angle prints the screen angle: 45° when the line rises as many pixels as it runs", () => {
    // 4 px per bar, 10 px per price unit: 10 bars right is 40 px; 4 price units up is 40 px.
    const { p } = plugin();
    const d = p.add({ tool: "trendAngle", anchors: [k(20, 100), k(30, 104)] });
    const label = p.toolDef("trendAngle").shapes(d, ctx()).find((s): s is Extract<Shape, { k: "text" }> => s.k === "text")!;
    expect(label.text).toBe("45.0°");
    const down = p.add({ tool: "trendAngle", anchors: [k(20, 100), k(30, 96)] });
    expect(p.toolDef("trendAngle").shapes(down, ctx()).find((s) => s.k === "text")).toMatchObject({ text: "-45.0°" });
    const left = p.add({ tool: "trendAngle", anchors: [k(30, 100), k(20, 104)] });
    expect(p.toolDef("trendAngle").shapes(left, ctx()).find((s) => s.k === "text")).toMatchObject({ text: "135.0°" });
  });

  it("trend angle draws the short arc when the line points left and up", () => {
    const { p } = plugin();
    // 10 bars left (40 px) and 4 price units up (40 px): 135 degrees counter-clockwise from the rightward horizontal
    const d = p.add({ tool: "trendAngle", anchors: [k(30, 100), k(20, 104)] });
    const a = p.toolDef("trendAngle").shapes(d, ctx()).find((s): s is Extract<Shape, { k: "arc" }> => s.k === "arc")!;
    expect(a.a0).toBeCloseTo(Math.PI, 9);
    expect(Math.abs(a.a1 - a.a0)).toBeCloseTo(Math.PI / 4, 9); // 45 degrees to the horizontal on the left, not 315
  });

  it("trend angle refuses two anchors at one time", () => {
    const { p } = plugin();
    expect(() => p.add({ tool: "trendAngle", anchors: [k(5, 1), k(5, 2)] })).toThrow(/different times/);
  });

  it("sector sweeps the shorter way between its edges, with the radius of the first edge", () => {
    const { p } = plugin();
    // centre (20,100); first edge 10 bars right (40 px, level); second edge straight up 40 px: a quarter turn counter-clockwise.
    const d = p.add({ tool: "sector", anchors: [k(20, 100), k(30, 100), k(20, 104)] });
    const arcShape = p.toolDef("sector").shapes(d, ctx()).find((s): s is Extract<Shape, { k: "arc" }> => s.k === "arc")!;
    expect(arcShape.r).toBeCloseTo(40, 9);
    expect(arcShape.a0).toBeCloseTo(0, 9);
    expect(arcShape.a1).toBeCloseTo(-Math.PI / 2, 9); // canvas angles: up is negative
    // A third point just past straight left sweeps the short way (through the top), not 270° the long way.
    const wide = p.add({ tool: "sector", anchors: [k(20, 100), k(30, 100), k(10, 100.5)] });
    const a = p.toolDef("sector").shapes(wide, ctx()).find((s): s is Extract<Shape, { k: "arc" }> => s.k === "arc")!;
    expect(Math.abs(a.a1 - a.a0)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("left and right arrow marks have their tip at the anchor and extend away from it", () => {
    const { p } = plugin();
    const at = px(k(40, 110));
    for (const [tool, sign] of [["arrowMarkLeft", 1], ["arrowMarkRight", -1]] as const) {
      const d = p.add({ tool, anchors: [k(40, 110)] });
      const poly = p.toolDef(tool).shapes(d, ctx())[0] as Extract<Shape, { k: "poly" }>;
      expect([poly.pts[0], poly.pts[1]]).toEqual([at.x, at.y]);
      const xs = poly.pts.filter((_, i) => i % 2 === 0);
      expect(Math.max(...xs.map((x) => sign * (x - at.x)))).toBe(28);
      expect(Math.min(...xs.map((x) => sign * (x - at.x)))).toBeCloseTo(0, 9);
    }
  });

  it("table draws one cell per entry, positioned by fraction of the pane, and refuses bad cells", () => {
    const { p } = plugin();
    const d = p.add({ tool: "table", anchors: [], props: { fx: 0.5, fy: 0.25, cells: [["a", "b", "c"], ["d", "e", "f"]] } });
    const shapes = p.toolDef("table").shapes(d, ctx());
    expect(shapes.filter((s) => s.k === "poly")).toHaveLength(6);
    expect(shapes.filter((s) => s.k === "text")).toHaveLength(6);
    expect((shapes[0] as Extract<Shape, { k: "poly" }>).pts.slice(0, 2)).toEqual([W * 0.5, H * 0.25]);
    const bad = (cells: unknown) => () => p.add({ tool: "table", anchors: [], props: { fx: 0.5, fy: 0.5, cells } });
    expect(bad([])).toThrow(/rows/);
    expect(bad([[]])).toThrow(/cells/);
    expect(bad([[1]])).toThrow(/text/);
    expect(bad([["x".repeat(201)]])).toThrow(/at most 200/);
    expect(bad(Array.from({ length: 21 }, () => ["x"]))).toThrow(/rows/);
  });

  it("icon draws its glyph at the anchor and refuses an empty or long glyph", () => {
    const { p } = plugin();
    const d = p.add({ tool: "icon", anchors: [k(40, 110)], props: { glyph: "🚀" } });
    expect(p.toolDef("icon").shapes(d, ctx())[0]).toMatchObject({ k: "text", text: "🚀", size: 24 });
    expect(() => p.add({ tool: "icon", anchors: [k(40, 110)], props: { glyph: "  " } })).toThrow(/glyph/);
    expect(() => p.add({ tool: "icon", anchors: [k(40, 110)], props: { glyph: "x".repeat(17) } })).toThrow(/glyph/);
    expect(() => p.add({ tool: "icon", anchors: [k(40, 110)], props: { glyph: 7 } })).toThrow(/glyph/);
  });

  it("anchored volume profile covers the bars from the anchor to the last bar and draws nothing when none follow", () => {
    const { p, src } = plugin();
    const d = p.add({ tool: "anchoredVolumeProfile", anchors: [k(100, 110)] });
    const shapes = p.toolDef("anchoredVolumeProfile").shapes(d, ctx(src));
    expect(shapes.filter((s) => s.k === "poly").length).toBeGreaterThan(0);
    const last = p.add({ tool: "anchoredVolumeProfile", anchors: [k(BARS - 1, 110)] });
    expect(p.toolDef("anchoredVolumeProfile").shapes(last, ctx(src))).toEqual([]);
    expect(() => p.add({ tool: "anchoredVolumeProfile", anchors: [k(100, 110)], props: { rows: 0 } })).toThrow(/rows/);
  });
});
