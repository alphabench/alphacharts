import { ArrayBarSource, DrawingsPlugin, allTools } from "@alphacharts/drawings";
import { describe, expect, it } from "vitest";
import { runAnalysis, type AnalysisAdapter, type AnalysisContext, type AnalysisResult } from "../src/index.js";
import { manifest } from "./fixtures.js";

const signal = () => new AbortController().signal;
const plugin = () => new DrawingsPlugin({ tools: allTools, source: new ArrayBarSource({ time: new Float64Array(0), open: new Float64Array(0), high: new Float64Array(0), low: new Float64Array(0), close: new Float64Array(0), volume: new Float64Array(0) }) });
const line = (price: number) => ({ tool: "horizontalLine", anchors: [{ time: 1, price }] });
const adapter = (run: (c: AnalysisContext) => Promise<AnalysisResult>, perms: readonly "bars"[] = []): AnalysisAdapter => ({ kind: "analysis", manifest: manifest("an", perms), run });
const opts = (d: DrawingsPlugin, extra = {}) => ({ drawings: d, symbol: "X", interval: 60_000, signal: signal(), ...extra });

describe("runAnalysis", () => {
  it("adds the drawings through the plugin and returns them", async () => {
    const d = plugin();
    const out = await runAnalysis(adapter(async () => ({ drawings: [line(10), line(20)] })), opts(d));
    expect(out.map((x) => x.anchors[0]!.price)).toEqual([10, 20]);
    expect(d.list()).toHaveLength(2);
  });

  it("adds all or none: a refused drawing leaves no drawing, no undo step and no event behind", async () => {
    const d = plugin();
    const seen: string[] = [];
    d.events.on("created", () => seen.push("created"));
    d.add(line(1));
    d.undo();
    expect(d.canRedo).toBe(true);
    const p = runAnalysis(adapter(async () => ({ drawings: [line(10), { tool: "nope" }, line(30)] })), opts(d));
    await expect(p).rejects.toThrow(/drawing 2 of 3 is invalid/);
    expect(d.list()).toEqual([]);
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true); // the user's redo survives
    expect(seen).toEqual(["created"]); // only the user's own add, none of the analysis
  });

  it("a successful run is one undo step", async () => {
    const d = plugin();
    await runAnalysis(adapter(async () => ({ drawings: [line(10), line(20), line(30)] })), opts(d));
    expect(d.list()).toHaveLength(3);
    d.undo();
    expect(d.list()).toEqual([]);
    expect(d.canUndo).toBe(false);
  });

  it("refuses more drawings than the cap, a malformed result, and a throwing adapter", async () => {
    const d = plugin();
    await expect(runAnalysis(adapter(async () => ({ drawings: [line(1), line(2)] })), opts(d, { maxDrawings: 1 }))).rejects.toThrow(/limit is 1/);
    await expect(runAnalysis(adapter(async () => ({}) as AnalysisResult), opts(d))).rejects.toThrow(/must return/);
    await expect(runAnalysis(adapter(async () => { throw new Error("boom"); }), opts(d))).rejects.toThrow(/run\(\) failed: boom/);
    expect(d.list()).toEqual([]);
  });

  it("gives bars only to an adapter that has the permission", async () => {
    const bars = [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
    const got: AnalysisContext[] = [];
    const run = async (c: AnalysisContext) => { got.push(c); return { drawings: [] }; };
    await runAnalysis(adapter(run, ["bars"]), opts(plugin(), { bars, allowBars: true }));
    await runAnalysis(adapter(run, ["bars"]), opts(plugin()));
    expect(got[0]!.bars).toBe(bars);
    expect("bars" in got[1]!).toBe(false);
    // The host's grant decides, not what the adapter says about itself.
    await expect(runAnalysis(adapter(run, ["bars"]), opts(plugin(), { bars }))).rejects.toThrow(/without the host granting/);
  });

  it("does not add anything once aborted", async () => {
    const d = plugin();
    const ac = new AbortController();
    const p = runAnalysis(adapter(async () => { ac.abort(new Error("stop")); return { drawings: [line(1)] }; }), opts(d, { signal: ac.signal }));
    await expect(p).rejects.toThrow("stop");
    expect(d.list()).toEqual([]);
  });
});
