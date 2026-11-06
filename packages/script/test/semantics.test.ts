import { describe, expect, it } from "vitest";
import { StudyEngine } from "@alphacharts/indicators";
import { compile } from "../src/index.js";
import { DATA, ok, run } from "./support.js";
import { randomBars } from "../../indicators/test/support.js";

const first = (src: string, n = 8, inputs: Record<string, number | boolean | string> = {}) => Array.from(run(src, inputs)[0]!.subarray(0, n));

describe("na semantics", () => {
  it("arithmetic with na is na; comparisons with na are false (both == and !=)", () => {
    expect(first("plot(close[1] + 1)", 3).map((v) => (v === v ? 1 : 0))).toEqual([0, 1, 1]);
    expect(first("plot(close[1] > 0 ? 1 : 2)", 2)).toEqual([2, 1]);
    expect(first("plot(close[1] != close ? 1 : 2)", 2)).toEqual([2, 1]);
    expect(first("plot(close[1] == close[1] ? 1 : 2)", 2)).toEqual([2, 1]);
  });
  it("division by zero is na, never Infinity; math results that are not finite are na", () => {
    expect(first("plot(1 / (bar_index - 1))", 4).map((v) => (v === v ? v : "na"))).toEqual([-1, "na", 1, 0.5]);
    expect(first("plot(math.log(bar_index))", 2)).toEqual([Number.NaN, 0]);
    expect(first("plot(5 % (bar_index - 1))", 3).map((v) => (v === v ? v : "na"))).toEqual([0 === 0 ? 5 % -1 : 0, "na", 0]);
  });
  it("nz and na()", () => {
    expect(first("plot(nz(close[1]))", 2)[0]).toBe(0);
    expect(first("plot(nz(close[1], 7))", 2)[0]).toBe(7);
    expect(first("plot(na(close[1]) ? 1 : 0)", 2)).toEqual([1, 0]);
  });
  it("history before the first bar is na, history by an input works", () => {
    const v = first("n = input.int(2)\nplot(close[n])", 4, { n: 2 });
    expect(v[0]).toBeNaN(); expect(v[1]).toBeNaN(); expect(v[2]).toBe(DATA.close[0]);
  });
  it("a negative or fractional dynamic offset fails loudly", () => {
    expect(() => run("plot(close[bar_index - 5])")).toThrow(/history offset/);
    expect(() => run("plot(close[bar_index / 2])")).toThrow(/history offset/);
  });
});

describe("control flow and state", () => {
  it("if / else if / else", () => {
    const v = first("float x = 0.0\nif bar_index == 0\n    x := 1.0\nelse if bar_index == 1\n    x := 2.0\nelse\n    x := 3.0\nplot(x)", 4);
    expect(v).toEqual([1, 2, 3, 3]);
  });
  it("for loops: inclusive, step, descending", () => {
    expect(first("float a = 0.0\nfor i = 1 to 4\n    a += i\nplot(a)", 1)).toEqual([10]);
    expect(first("float a = 0.0\nfor i = 0 to 10 by 5\n    a += i\nplot(a)", 1)).toEqual([15]);
    expect(first("float a = 0.0\nfor i = 3 to 1\n    a := a * 10 + i\nplot(a)", 1)).toEqual([321]);
  });
  it("var keeps its value from bar to bar and initialises once", () => {
    expect(first("var n = 10\nn := n + 1\nplot(n)", 3)).toEqual([11, 12, 13]);
    expect(first("var float s = 0.0\ns += 2\nplot(s[1])", 3).map((v) => (v === v ? v : "na"))).toEqual(["na", 2, 4]);
  });
  it("a non-var variable restarts every bar; its history is the previous bar's final value", () => {
    expect(first("float x = 1.0\nx := x + nz(x[1])\nplot(x)", 4)).toEqual([1, 2, 3, 4]);
  });
  it("block locals are scoped", () => {
    expect(first("float r = 0.0\nif close > 0\n    t = close * 2\n    r := t\nplot(r / close)", 2)).toEqual([2, 2]);
  });
  it("a loop that would exceed the iteration limit at run time is stopped", () => {
    expect(() => run("float a = 0.0\nfor i = 1 to bar_index * 100000\n    a += 1\nplot(a)")).toThrow(/limit is 10000 iterations/);
  });
});

describe("types", () => {
  it("int / int is float, int + int is int", () => {
    expect(first("plot(7 / 2)", 1)).toEqual([3.5]);
    expect(first("int k = 7\nint j = 2\nplot(k % j)", 1)).toEqual([1]);
  });
  it("a number is never a condition, a bool never a number", () => {
    for (const s of ["if close\n    x = 1\nplot(close)", "plot(close > open ? 1 : 0 + (close > open))", "plot(not 1)"]) expect(compile(s).ok).toBe(false);
  });
  it("na needs a type; typed na is fine", () => {
    expect(compile("x = na\nplot(close)").ok).toBe(false);
    expect(compile("float x = na\nplot(nz(x, 3))").ok).toBe(true);
  });
  it("strings compare as constants", () => {
    expect(first("m = input.string(\"a\", options=[\"a\", \"b\"])\nplot(m == \"a\" ? 1 : 2)", 1, { m: "b" })).toEqual([2]);
  });
});

describe("study definition", () => {
  it("inputs feed the study schema (int/float/bool/select/source) and colours stay out of it", () => {
    const r = ok(`indicator("Demo", overlay=true)
a = input.int(14, "Length", minval=2, maxval=50)
b = input.float(1.5, "Mult", 0.5, 4, 0.5)
c = input.bool(true, "On")
d = input.string("x", "Mode", options=["x", "y"])
e = input.source(hl2, "Src")
f = input.color(#ff0000, "Colour")
plot(ta.sma(e, a) * b, "Main", f)`);
    expect(r.study.name).toBe("Demo");
    expect(r.study.pane).toBe("overlay");
    expect(r.study.inputs).toEqual([
      { key: "a", label: "Length", type: "int", default: 14, min: 2, max: 50, step: 1 },
      { key: "b", label: "Mult", type: "float", default: 1.5, min: 0.5, max: 4, step: 0.5 },
      { key: "c", label: "On", type: "bool", default: true },
      { key: "d", label: "Mode", type: "select", default: "x", options: ["x", "y"] },
      expect.objectContaining({ key: "e", type: "source", default: "hl2" }),
    ]);
    expect(r.colorInputs).toEqual([{ key: "f", label: "Colour", default: "#ff0000", plotKeys: ["main"] }]);
    expect(r.study.needs).toBe("ohlc");
    expect(r.study.plots).toEqual([expect.objectContaining({ kind: "line", key: "main", color: "#ff0000" })]);
  });
  it("inputs are validated by the engine like a built-in's", () => {
    const r = ok("len = input.int(14, minval=2, maxval=50)\nplot(ta.sma(close, len))");
    expect(() => new StudyEngine(r.study, { len: 1 })).toThrow(/below the minimum/);
    expect(() => new StudyEngine(r.study, { nope: 1 })).toThrow(/unknown input/);
  });
  it("a bad period from an input is a positioned error at build", () => {
    const r = ok("len = input.int(14)\nplot(ta.sma(close, len))");
    expect(() => new StudyEngine(r.study, { len: 9000 })).toThrow(/length of ta.sma must be an integer between 1 and 5000/);
  });
  it("plots: styles, hline, fill, markers; needs follow what is used", () => {
    const r = ok(`p1 = plot(close, "A", color.red, 2)
p2 = plot(open, "B", color.blue)
fill(p1, p2, color.new(color.blue, 80))
hline(50, "Mid", color.gray, hline.style_dotted)
plot(volume, "V", style=plot.style_histogram, color_down=color.red)
plotshape(close > open, "Up", shape.triangleup, location.belowbar, color.green)`);
    expect(r.study.needs).toBe("ohlcv");
    expect(r.study.columns).toEqual(["a", "b", "v", "up"]);
    const kinds = r.study.plots.map((p) => p.kind);
    expect(kinds).toEqual(["line", "line", "fill", "hline", "histogram", "markers"]);
    expect(r.study.plots[2]).toMatchObject({ a: "a", b: "b", color: "rgba(41,98,255,0.2)" });
    expect(r.study.plots[3]).toMatchObject({ kind: "hline", style: "dotted" });
    expect((r.study.plots[3] as { value: (p: object) => number }).value({})).toBe(50);
    expect(r.study.plots[5]).toMatchObject({ shape: "triangleUp", position: "below" });
  });
  it("hline returns a handle that fill takes: between two levels, and between a plot and a level", () => {
    const r = ok(`up = hline(70, "Up", color.red)
lo = hline(30, "Low", color.green)
p = plot(ta.rsi(close, 14), "RSI")
fill(up, lo, color.new(color.gray, 90), "Band")
fill(p, up, color.new(color.red, 80), "Overbought")`);
    expect(r.study.columns).toEqual(["up~level", "low~level", "rsi"]);
    expect(r.study.plots.map((p) => [p.kind, p.key])).toEqual([["hline", "up"], ["hline", "low"], ["line", "rsi"], ["fill", "band"], ["fill", "overbought"]]);
    expect(r.study.plots[3]).toMatchObject({ a: "up~level", b: "low~level" });
    expect(r.study.plots[4]).toMatchObject({ a: "rsi", b: "up~level" });
    const cols = run(`up = hline(70)\nlo = hline(30)\nfill(up, lo)`);
    expect(cols.length).toBe(2);
    for (let i = 0; i < DATA.close.length; i++) { expect(cols[0]![i]).toBe(70); expect(cols[1]![i]).toBe(30); }
  });
  it("an hline handle takes its level from an input, and an hline nobody fills adds no column", () => {
    expect(ok("h = hline(50)\nplot(close)").study.columns.length).toBe(1);
    const cols = run("lvl = input.float(65, \"Level\")\nh = hline(lvl)\np = plot(close)\nfill(p, h)", { lvl: 70 });
    expect(cols.length).toBe(2);
    expect(cols[0]![0]).toBe(70);
    expect(run("lvl = input.float(65, \"Level\")\nh = hline(lvl)\np = plot(close)\nfill(p, h)")[0]![3]).toBe(65);
  });
  it("a markers plot is na where the condition is false and 1 where true", () => {
    const v = run("plotshape(close > close[1])")[0]!;
    for (let i = 1; i < 30; i++) expect(v[i]).toBe(DATA.close[i]! > DATA.close[i - 1]! ? 1 : Number.NaN);
  });
  it("study ids are stable per source", () => {
    expect(ok("plot(close)").study.id).toBe(ok("plot(close)").study.id);
    expect(ok("plot(close)").study.id).not.toBe(ok("plot(open)").study.id);
  });
  it("the same engine drives scripts over random bars without error", () => {
    const e = new StudyEngine(ok("plot(ta.ema(close, 3))").study);
    e.load(randomBars(50, 3));
    expect(e.column(0)[49]).toBeGreaterThan(0);
  });
});
