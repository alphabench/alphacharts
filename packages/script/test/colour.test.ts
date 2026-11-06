// barcolor, bgcolor, the colour that depends on the bar, indicator(scale=) and the strings of outside(): what they
// compile to, what they compute, that they follow ticks exactly like a batch, and that a string is only ever data.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudyEngine, type BarInput } from "@alphacharts/indicators";
import { compile } from "../src/index.js";
import { DATA, ok } from "./support.js";
import { randomBars, rng } from "../../indicators/test/support.js";

const msgs = (src: string) => { const r = compile(src); return r.ok ? [] : r.diagnostics.map((d) => d.message); };

describe("barcolor and bgcolor", () => {
  const src = 'indicator("t", overlay=true)\nbarcolor(close > open, color.yellow)\nbgcolor(close < open, color.new(color.red, 80))\nbarcolor(close > ta.sma(close, 5) and close > open, #00ff00)';
  it("compile to plots with a column each that is 1 where the condition holds and absent elsewhere", () => {
    const r = ok(src);
    expect(r.study.plots.map((p) => p.kind)).toEqual(["barcolor", "bgcolor", "barcolor"]);
    expect(r.study.plots.map((p) => ("color" in p ? p.color : ""))).toEqual(["#fdd835", "rgba(242,54,69,0.2)", "#00ff00"]);
    const e = new StudyEngine(r.study);
    e.load(DATA);
    for (let i = 0; i < DATA.close.length; i++) {
      expect(e.column(0)[i]).toBe(DATA.close[i]! > DATA.open[i]! ? 1 : Number.NaN);
      expect(e.column(1)[i]).toBe(DATA.close[i]! < DATA.open[i]! ? 1 : Number.NaN);
    }
  });
  it("count as the script drawing something, and need no plot() in an overlay script", () => {
    expect(msgs('indicator("t", overlay=true)\nbarcolor(close > open, color.red)')).toEqual([]);
    expect(msgs("barcolor(close > open, color.red)")).toEqual([]);
  });
  it("take a colour input", () => {
    const r = ok('c = input.color(color.blue)\nbarcolor(close > open, c)\nplot(close)');
    expect(r.colorInputs.map((c) => [c.key, c.plotKeys.length])).toEqual([["c", 1]]);
  });
});

describe("a colour that depends on the bar", () => {
  it("compiles to the line's own colour plus a colour for the bars where the condition holds", () => {
    const r = ok("plot(close, \"c\", color = close > open ? color.green : color.red)");
    const line = r.study.plots[0]!;
    expect(line).toMatchObject({ kind: "line", color: "#f23645", colorBy: { col: "c~when", color: "#4caf50" } });
    expect(r.study.columns).toEqual(["c", "c~when"]);
    const e = new StudyEngine(r.study);
    e.load(DATA);
    expect(e.column(1)[3]).toBe(DATA.close[3]! > DATA.open[3]! ? 1 : 0);
  });
  it("takes color.new and a state variable for the condition", () => {
    const r = ok('var bool up = false\nup := close > nz(close[1])\nplot(close, color = up ? color.new(color.green, 30) : color.new(color.red, 30))');
    expect(r.study.plots[0]).toMatchObject({ colorBy: { color: "rgba(76,175,80,0.7)" }, color: "rgba(242,54,69,0.7)" });
    const e = new StudyEngine(r.study);
    e.load(DATA);
    expect(e.column(1)[10]).toBe(DATA.close[10]! > DATA.close[9]! ? 1 : 0);
  });
});

describe("indicator(scale=)", () => {
  it("puts the study's series on the left axis, and the default is the right", () => {
    expect(ok('indicator("a", scale="left")\nplot(close)').study.scale).toBe("left");
    expect(ok('indicator("a", overlay=true, scale="left")\nplot(close)').study.scale).toBe("left");
    expect(ok('indicator("a", scale="right")\nplot(close)').study.scale).toBeUndefined();
    expect(ok("plot(close)").study.scale).toBeUndefined();
  });
});

describe("incremental == batch for the new outputs", () => {
  const src = 'var float f = 0.0\nf := nz(f[1]) + (close - nz(f[1])) * 0.2\nplot(f, "f", color = close > f ? color.green : color.red)\nbarcolor(close > f and close > open, color.yellow)\nbgcolor(ta.crossover(close, f), color.blue)';
  it("appends and revisions leave the columns of a batch run", () => {
    const N = 300;
    const d = randomBars(N, 77);
    const r = rng(5);
    const batch = new StudyEngine(ok(src).study);
    batch.load(d);
    const live = new StudyEngine(ok(src).study);
    const bar = (i: number): BarInput => ({ time: d.time[i]!, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, volume: d.volume[i]! });
    for (let i = 0; i < N; i++) {
      const b = bar(i);
      live.push({ ...b, close: b.close * (1 + (r() - 0.5) * 0.02), high: b.high + 1 });
      live.reviseLast(b);
    }
    for (let c = 0; c < batch.outputs.length; c++) {
      const a = batch.column(c), b = live.column(c);
      for (let i = 0; i < N; i++) if (!Object.is(a[i], b[i])) throw new Error(`column ${c}[${i}]: ${a[i]} vs ${b[i]}`);
    }
  });
});

describe("the strings of outside() are data", () => {
  const g = globalThis as unknown as { eval: unknown; Function: unknown; pwned?: unknown };
  let realEval: unknown, realFunction: unknown, calls: string[];
  beforeEach(() => {
    realEval = g.eval; realFunction = g.Function; calls = [];
    g.eval = (s: string) => { calls.push(`eval:${s}`); throw new Error("eval called"); };
    g.Function = function (...a: unknown[]) { calls.push(`Function:${a.join(",")}`); throw new Error("Function called"); };
  });
  afterEach(() => { g.eval = realEval; g.Function = realFunction; });

  for (const p of ['"); globalThis.pwned = 1; ("', "'); globalThis.pwned = 1; ('", "</script><script>globalThis.pwned=1</script>", "${globalThis.pwned = 1}", "__proto__", "constructor", "a b", "NSE:ABC\\\\"]) {
    it(JSON.stringify(p), () => {
      const lit = JSON.stringify(p).replace(/\\u2028/g, " ");
      const r = compile(`plot(outside(${lit}, "close"))`);
      if (!r.ok) { expect(r.diagnostics.length).toBeGreaterThan(0); return; }
      expect(r.plan.dependencies[0]!.symbol).toBe(p);
      const e = new StudyEngine(r.study);
      e.load(DATA);
      expect(calls).toEqual([]);
      expect(g.pwned).toBeUndefined();
    });
  }
  it("the timeframe must be the exact shape, so no other text reaches the host as one", () => {
    for (const tf of ['1d"); x(', "1d ", "1D", "../1d", "1d\\n"]) expect(msgs(`plot(outside("X", timeframe = ${JSON.stringify(tf)}))`)[0]).toMatch(/is not written like/);
  });
});
