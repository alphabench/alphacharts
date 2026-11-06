// plotshape(..., last=N, within=M): only the newest marks are kept. The column is the plain condition on every bar; the
// cut is made from the finished column when marks are drawn (markerFloor), so a batch over all the bars and bars
// appended one at a time (with revisions of the live bar) keep the same marks at every length.

import { describe, expect, it } from "vitest";
import { markerFloor, StudyEngine, type BarInput } from "@alphacharts/indicators";
import { compile } from "../src/index.js";
import { ok } from "./support.js";
import { randomBars, rng } from "../../indicators/test/support.js";

const markers = (src: string) => ok(src).study.plots.find((p) => p.kind === "markers") as Extract<ReturnType<typeof ok>["study"]["plots"][number], { kind: "markers" }>;

describe("plotshape last / within: the language", () => {
  it("are plain integer constants carried on the markers plot", () => {
    const p = markers("plotshape(close > open, \"Up\", last=3, within=100)");
    expect(p.last).toBe(3);
    expect(p.within).toBe(100);
  });

  it("are absent unless written", () => {
    const p = markers("plotshape(close > open)");
    expect(p.last).toBeUndefined();
    expect(p.within).toBeUndefined();
  });

  it("refuse 0, a number past 5000 and anything that is not a literal", () => {
    for (const bad of ["last=0", "within=0", "last=5001", "last=2.5"]) {
      const r = compile(`plotshape(close > open, ${bad})`);
      expect(r.ok, bad).toBe(false);
    }
    const r = compile("n = input.int(3, \"N\")\nplotshape(close > open, last=n)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.message).join(" ")).toMatch(/literal/);
  });
});

describe("plotshape last / within: incremental == batch", () => {
  const bar = (d: ReturnType<typeof randomBars>, i: number): BarInput => ({ time: d.time[i]!, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, volume: d.volume[i]! });
  for (const [name, src] of Object.entries({
    last: "plotshape(close > close[1], last=3)",
    within: "plotshape(close > close[1], within=20)",
    both: "plotshape(close > ta.sma(close, 5), last=4, within=40)",
  })) {
    it(name, () => {
      const N = 150;
      const d = randomBars(N, 99);
      const r = rng(5);
      const p = markers(src);
      const def = ok(src).study;
      const live = new StudyEngine(def);
      const col = def.columns.indexOf(p.col);
      for (let i = 0; i < N; i++) {
        const b = bar(d, i);
        // the live bar is revised before it closes, as ticks do
        live.push({ ...b, close: b.close * (1 + (r() - 0.5) * 0.02) });
        live.reviseLast(b);
        const batch = new StudyEngine(def);
        batch.load({ time: d.time.slice(0, i + 1), open: d.open.slice(0, i + 1), high: d.high.slice(0, i + 1), low: d.low.slice(0, i + 1), close: d.close.slice(0, i + 1), volume: d.volume.slice(0, i + 1) });
        const n = i + 1;
        expect(markerFloor(live.column(col), n, p), `length ${n}`).toBe(markerFloor(batch.column(col), n, p));
      }
    });
  }

  it("a tick does not move a kept mark: only the live bar's own mark comes and goes", () => {
    const def = ok("plotshape(close > open, last=2)").study;
    const p = markers("plotshape(close > open, last=2)");
    const col = def.columns.indexOf(p.col);
    const e = new StudyEngine(def);
    const up = (t: number): BarInput => ({ time: t, open: 10, high: 12, low: 9, close: 11, volume: 1 });
    const down = (t: number): BarInput => ({ time: t, open: 10, high: 12, low: 9, close: 9.5, volume: 1 });
    e.push(up(1)); e.push(up(2)); e.push(down(3)); // marks on bars 0 and 1
    const keptBefore = markerFloor(e.column(col), 3, p);
    e.reviseLast(up(3)); // the live bar turns up: bars 1 and 2 are the newest two
    const keptUp = markerFloor(e.column(col), 3, p);
    e.reviseLast(down(3)); // and back down: exactly as before, nothing flickered in between
    expect(markerFloor(e.column(col), 3, p)).toBe(keptBefore);
    expect(keptBefore).toBe(0);
    expect(keptUp).toBe(1);
  });
});
