// Per-bar colour on OHLC series: an optional column that is created on first use, belongs to (series, time),
// survives every data path and the level-of-detail pyramid, and announces itself as its own kind of change.
import { describe, expect, it } from "vitest";
import { BarShading } from "../src/chart/primitives.js";
import { COL_BAR_COLOR, DataModel, type DataChange, type OhlcBar } from "../src/data/model.js";
import { LOD_BASE, LOD_COLOR } from "../src/data/lod.js";
import { parseColor } from "../src/render/color.js";

const RED = parseColor("#ff0000");
const BLUE = parseColor("#0000ff");
const bar = (i: number): OhlcBar => ({ time: (i + 1) * 1000, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i });
const bars = (n: number, from = 0): OhlcBar[] => Array.from({ length: n }, (_, k) => bar(from + k));
const colorAt = (m: DataModel, s: ReturnType<DataModel["add"]>, i: number): number => {
  const idx = m.timeline.indexOf((i + 1) * 1000)!;
  return s.colored ? (s.store.cols[COL_BAR_COLOR] as Uint32Array)[s.store.pos(idx)]! : 0;
};
const colors = (idx: number[], c: number) => ({ time: Float64Array.from(idx.map((i) => (i + 1) * 1000)), color: new Uint32Array(idx.length).fill(c) });

describe("bar colours", () => {
  it("adds no column and no pyramid column to a series that is never coloured", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    m.setData(s, bars(40));
    m.update(s, bar(40));
    m.prepend(s, [{ ...bar(-1), time: 500 }]);
    expect(s.colored).toBe(false);
    expect(s.store.cols.length).toBe(4);
    expect(s.lod.level(LOD_BASE)!.cols.length).toBe(4);
    // an all-zero colouring is a no-op too
    m.setColors(s, colors([0, 1, 2], 0));
    expect(s.colored).toBe(false);
  });

  it("writes colours by time, ignores times with no bar, and clears them again", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    m.setData(s, bars(20));
    const seen: DataChange[] = [];
    m.onChange((c) => seen.push(c));
    m.setColors(s, { time: Float64Array.of(3000, 4000, 99_000), color: Uint32Array.of(RED, BLUE, RED) });
    expect(colorAt(m, s, 2)).toBe(RED);
    expect(colorAt(m, s, 3)).toBe(BLUE);
    expect(colorAt(m, s, 4)).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "color", reindexed: false, appended: false });
    expect([seen[0]!.lo, seen[0]!.hi]).toEqual([m.timeline.indexOf(3000), m.timeline.indexOf(4000)! + 1]);
    // the same colours again change nothing and announce nothing
    m.setColors(s, { time: Float64Array.of(3000, 4000), color: Uint32Array.of(RED, BLUE) });
    expect(seen).toHaveLength(1);
    m.clearColors(s);
    expect(s.colored).toBe(false);
    expect(s.store.cols.length).toBe(4);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.kind).toBe("color");
    // restoring the colours of a series that was never coloured is exact: nothing left behind
    expect(colorAt(m, s, 2)).toBe(0);
    m.clearColors(s);
    expect(seen).toHaveLength(2);
  });

  it("keeps a bar's colour through update, a live revision, prepend and setData", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    m.setData(s, bars(20));
    m.setColors(s, colors([5, 19], RED));
    // a live revision of the last bar does not lose the colour; a new bar starts uncoloured
    m.update(s, { ...bar(19), close: 30.5 }); // bar 19 is o=29 h=31 l=28: a close must stay inside [28, 31]
    expect(colorAt(m, s, 19)).toBe(RED);
    m.update(s, bar(20));
    expect(colorAt(m, s, 20)).toBe(0);
    // older history: the bars already there keep theirs, indices shift by nothing
    m.prepend(s, [{ ...bar(-3), time: 100 }, { ...bar(-2), time: 200 }]);
    expect(colorAt(m, s, 5)).toBe(RED);
    expect(colorAt(m, s, 19)).toBe(RED);
    // setData of the same times without colours carries them; a time that is gone loses its colour
    m.setData(s, bars(25));
    expect(colorAt(m, s, 5)).toBe(RED);
    expect(colorAt(m, s, 19)).toBe(RED);
    m.setData(s, bars(10));
    expect(colorAt(m, s, 5)).toBe(RED);
    expect(m.timeline.indexOf(20_000)).toBeUndefined();
    // rows that bring a colour win over the carried one
    m.setData(s, bars(10).map((b, i) => (i === 5 ? { ...b, color: "#0000ff" } : b)));
    expect(colorAt(m, s, 5)).toBe(BLUE);
  });

  it("keeps colours when another series' times force the timeline to be rebuilt", () => {
    const m = new DataModel();
    const a = m.add("ohlc");
    m.setData(a, bars(10));
    m.setColors(a, colors([2, 7], RED));
    const b = m.add("ohlc");
    m.setData(b, [bar(0), bar(1), { time: 2500, open: 1, high: 2, low: 0.5, close: 1.5 }, bar(2)]);
    expect(colorAt(m, a, 2)).toBe(RED);
    expect(colorAt(m, a, 7)).toBe(RED);
    expect(colorAt(m, a, 3)).toBe(0);
  });

  it("takes the last coloured row of a bucket at the pyramid levels, and every row's colour at level 0", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    const n = 1 << (LOD_BASE + 2);
    m.setData(s, bars(n));
    m.setColors(s, colors([3], RED));
    const lv = s.lod.level(LOD_BASE)!;
    expect(lv.cols[LOD_COLOR]![lv.pos(0)]).toBe(RED);
    expect(lv.cols[LOD_COLOR]![lv.pos(1)]).toBe(0);
    const up = s.lod.level(LOD_BASE + 1)!;
    expect(up.cols[LOD_COLOR]![up.pos(0)]).toBe(RED);
    m.setColors(s, colors([3], 0));
    expect(lv.cols[LOD_COLOR]![lv.pos(0)]).toBe(0);
  });

  it("takes colours from rows given to setData and update", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    const time = Float64Array.from({ length: 4 }, (_, i) => (i + 1) * 1000);
    const o = new Float64Array(4).fill(1), h = new Float64Array(4).fill(2), l = new Float64Array(4).fill(0.5), c = new Float64Array(4).fill(1.5);
    m.setData(s, { time, open: o, high: h, low: l, close: c, color: Uint32Array.of(0, RED, 0, 0) });
    expect(colorAt(m, s, 1)).toBe(RED);
    m.update(s, { time: 4000, open: 1, high: 2, low: 0.5, close: 1.6, color: "#0000ff" });
    expect(colorAt(m, s, 3)).toBe(BLUE);
    expect(() => m.setData(s, { time, open: o, high: h, low: l, close: c, color: new Uint32Array(3) })).toThrow(/color has 3 rows/);
  });

  it("refuses colours on a value series and mismatched columns", () => {
    const m = new DataModel();
    const v = m.add("value");
    m.setData(v, [{ time: 1000, value: 1 }]);
    expect(() => m.setColors(v, colors([0], RED))).toThrow(/only an OHLC series/);
    const s = m.add("ohlc");
    m.setData(s, bars(3));
    expect(() => m.setColors(s, { time: Float64Array.of(1000), color: new Uint32Array(2) })).toThrow(/2 rows/);
    expect(() => m.setColors(s, { time: Float64Array.of(2000, 1000), color: new Uint32Array(2) })).toThrow();
  });

  it("marks a value series as holding coloured points only when one is written", () => {
    const m = new DataModel();
    const v = m.add("value");
    m.setData(v, [{ time: 1000, value: 1 }, { time: 2000, value: 2 }]);
    expect(v.pointColors).toBe(false);
    m.setData(v, [{ time: 1000, value: 1 }, { time: 2000, value: 2, color: "#ff0000" }]);
    expect(v.pointColors).toBe(true);
    m.setData(v, [{ time: 1000, value: 1 }]);
    expect(v.pointColors).toBe(false);
  });
});

describe("BarShading", () => {
  const view = (n: number, spacing = 10) => ({
    width: n * spacing, height: 100, dpr: 1, lo: 0, hi: n - 1, barSpacing: spacing,
    x: (i: number) => i * spacing + spacing / 2, y: (v: number) => v, index: (x: number) => Math.floor(x / spacing), price: (y: number) => y,
    timeToIndex: (t: number) => (t % 1000 === 0 && t >= 1000 && t <= n * 1000 ? t / 1000 - 1 : undefined),
    indexToTime: (i: number) => (i + 1) * 1000, timeToX: (t: number) => (t / 1000 - 1) * spacing + spacing / 2, formatPrice: String,
  });
  const recorder = () => {
    const rects: { x: number; w: number; fill: string }[] = [];
    let fill = "";
    const ctx = { set fillStyle(v: string) { fill = v; }, fillRect: (x: number, _y: number, w: number) => rects.push({ x, w, fill }) } as unknown as CanvasRenderingContext2D;
    return { ctx, rects };
  };

  it("draws neighbouring bars of one colour as one rectangle, and a different colour as its own", () => {
    const sh = new BarShading();
    sh.set(Float64Array.of(1000, 2000, 3000, 4000, 5000), Uint32Array.of(RED, RED, 0, BLUE, BLUE));
    const { ctx, rects } = recorder();
    sh.drawBackground(ctx, view(5));
    expect(rects.map((r) => [r.x, r.w])).toEqual([[0, 20], [30, 20]]);
    expect(rects[0]!.fill).not.toBe(rects[1]!.fill);
  });

  it("draws nothing while hidden or when no bar is shaded, and follows setAt", () => {
    const sh = new BarShading();
    const a = recorder();
    sh.drawBackground(a.ctx, view(3));
    expect(a.rects).toHaveLength(0);
    sh.setAt(1000, RED);
    sh.setAt(2000, RED);
    sh.setAt(2000, 0);
    sh.setAt(3000, BLUE);
    const b = recorder();
    sh.drawBackground(b.ctx, view(3));
    expect(b.rects.map((r) => [r.x, r.w])).toEqual([[0, 10], [20, 10]]);
    sh.setVisible(false);
    const c = recorder();
    sh.drawBackground(c.ctx, view(3));
    expect(c.rects).toHaveLength(0);
    expect(() => sh.setAt(1500, RED)).toThrow(/neither the last bar nor a later one/);
  });
});
