import { ArrayBarSource, DrawingsPlugin, allTools, type Bar } from "@alphacharts/drawings";
import { describe, expect, it } from "vitest";
import { autoDrawings, autoFibExtension, autoFibRetracement, autoKeyLevels, autoPitchfork, autoTrendlines, createAdapterRegistry, keyLevels, runAnalysis, swings } from "../src/index.js";

const T0 = 1_000_000, STEP = 60_000;
/** Bars from [high, low] pairs; open and close sit inside. */
const mk = (rows: Array<[number, number]>): Bar[] => rows.map(([high, low], i) => ({ time: T0 + i * STEP, open: low, high, low, close: high, volume: 1 }));
const signal = () => new AbortController().signal;
const ctx = (bars?: Bar[]) => ({ symbol: "X", interval: STEP, ...(bars ? { bars } : {}), signal: signal() });

describe("swings", () => {
  it("finds a high and a low that beat strength bars on each side, and none in the last strength bars", () => {
    //            0       1       2        3       4       5       6
    const bars = mk([[5, 4], [6, 5], [9, 7], [6, 5], [5, 2], [6, 4], [7, 5]]);
    const sw = swings(bars, 1);
    expect(sw.map((s) => [s.index, s.kind, s.price])).toEqual([[2, "high", 9], [4, "low", 2]]);
  });
  it("counts the earliest of equal highs as the swing and ignores a flat series", () => {
    expect(swings(mk([[1, 0], [3, 1], [3, 1], [1, 0], [1, 0]]), 1).filter((s) => s.kind === "high").map((s) => s.index)).toEqual([1]);
    expect(swings(mk([[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]), 1)).toEqual([]);
  });
  it("refuses a strength below 1", () => {
    expect(() => swings([], 0)).toThrow(/>= 1/);
    expect(() => swings([], 1.5)).toThrow(/>= 1/);
  });
});

// A zig-zag with clear swings: lows at 2, 4 (price 10, 12), highs at 1, 3, 5 (20, 25, 22), then a fall.
const ZIG = mk([[15, 12], [20, 14], [16, 10], [25, 15], [18, 12], [22, 13], [17, 11], [16, 12], [15, 11]]);

describe("auto drawings", () => {
  it("fib retracement spans the last swing high and last swing low, earliest first", async () => {
    const r = await autoFibRetracement({ strength: 1 }).run(ctx(ZIG));
    // highs: idx1 20, idx3 25, idx5 22 -> last high idx5 22; lows: idx2 10, idx4 12, idx6 11 -> last low idx6 11 (after the high)
    expect(r.drawings).toEqual([{ tool: "fibRetracement", anchors: [{ time: T0 + 5 * STEP, price: 22 }, { time: T0 + 6 * STEP, price: 11 }] }]);
  });
  it("trend lines run through the last two swing highs and the last two swing lows, extended right", async () => {
    const r = await autoTrendlines({ strength: 1 }).run(ctx(ZIG));
    expect(r.drawings.map((d) => [d.tool, d.anchors!.map((a) => a.price), d.style?.extendRight])).toEqual([["trendLine", [25, 22], true], ["trendLine", [12, 11], true]]);
  });
  it("key levels cluster swings within the tolerance, most touched first, and need minTouches", () => {
    const sw = [100, 100.1, 100.2, 150, 150.2, 200].map((price, index) => ({ index, time: index, price, kind: "high" as const }));
    const levels = keyLevels(sw, 0.01, 2, 6);
    expect(levels.map((l) => [Math.round(l.price * 100) / 100, l.touches])).toEqual([[100.1, 3], [150.1, 2]]);
    expect(keyLevels(sw, 0.01, 2, 1)).toHaveLength(1);
    expect(() => keyLevels(sw, 0, 2, 6)).toThrow(/tolerance/);
  });
  it("key levels draw one dashed horizontal line per level", async () => {
    const bars = mk([[10, 5], [20, 6], [10, 5], [20.01, 6], [10, 5], [20, 6], [10, 5]]);
    const r = await autoKeyLevels({ strength: 1, tolerance: 0.01 }).run(ctx(bars));
    expect(r.drawings.every((d) => d.tool === "horizontalLine")).toBe(true);
    expect(r.drawings.length).toBeGreaterThan(0);
  });
  it("pitchfork takes the last three alternating swings", async () => {
    const r = await autoPitchfork({ strength: 1 }).run(ctx(ZIG));
    // swings alternate h1 20, l2 10, h3 25, l4 12, h5 22, l6 11: the last three are 12, 22, 11
    expect(r.drawings).toHaveLength(1);
    expect(r.drawings[0]!.tool).toBe("pitchfork");
    expect(r.drawings[0]!.anchors!.map((a) => a.price)).toEqual([12, 22, 11]);
  });
  it("fib extension takes the last three alternating swings: the move and its pullback", async () => {
    const r = await autoFibExtension({ strength: 1 }).run(ctx(ZIG));
    expect(r.drawings).toHaveLength(1);
    expect(r.drawings[0]!.tool).toBe("fibExtension");
    expect(r.drawings[0]!.anchors!.map((a) => a.price)).toEqual([12, 22, 11]);
  });
  it("draw nothing when the bars have no swings, and refuse to run without bars", async () => {
    const flat = mk([[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);
    for (const a of autoDrawings({ strength: 1 })) expect((await a.run(ctx(flat))).drawings, a.manifest.id).toEqual([]);
    await expect(autoFibRetracement().run(ctx())).rejects.toThrow(/bars permission/);
  });
  it("register through the registry only when the host grants bars, and every drawing they produce is accepted by the plugin", async () => {
    expect(() => createAdapterRegistry().register(autoFibRetracement())).toThrow(/did not grant/);
    const reg = createAdapterRegistry({ allow: ["bars"] });
    for (const a of autoDrawings({ strength: 1 })) reg.register(a);
    const src = new ArrayBarSource({ time: Float64Array.from(ZIG.map((b) => b.time)), open: Float64Array.from(ZIG.map((b) => b.open)), high: Float64Array.from(ZIG.map((b) => b.high)), low: Float64Array.from(ZIG.map((b) => b.low)), close: Float64Array.from(ZIG.map((b) => b.close)), volume: Float64Array.from(ZIG.map((b) => b.volume)) });
    const drawings = new DrawingsPlugin({ tools: allTools, source: src, interval: STEP });
    for (const a of reg.list("analysis")) {
      await runAnalysis(a as ReturnType<typeof autoFibRetracement>, { drawings, symbol: "X", interval: STEP, bars: ZIG, allowBars: reg.mayReadBars(a.manifest.id), signal: signal() });
    }
    const tools = drawings.list().map((d) => d.tool);
    // fib 1, two trend lines, at least one pitchfork; key levels depend on the 0.25% tolerance and may be none on this path
    expect(tools.filter((t) => t === "fibRetracement")).toHaveLength(1);
    expect(tools.filter((t) => t === "trendLine")).toHaveLength(2);
    expect(tools.filter((t) => t === "pitchfork")).toHaveLength(1);
  });
});
