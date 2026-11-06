// The literal's written form decides int or float, and compile() hands the app a read-only view of the program.

import { describe, expect, it } from "vitest";
import { compile, type Expr } from "../src/index.js";
import { ok, run } from "./support.js";

const err = (src: string): string[] => {
  const r = compile(src);
  if (r.ok) throw new Error("compiled");
  return r.diagnostics.map((d) => d.message);
};

describe("numeric literals", () => {
  it("0.0, 1., 1e3 are floats whatever their value, so a var started at 0.0 takes floats", () => {
    const v = Array.from(run("var x = 0.0\nx := x + 0.5\nplot(x)")[0]!.subarray(0, 3));
    expect(v).toEqual([0.5, 1, 1.5]);
    ok("var x = 1.\nx *= 0.5\nplot(x)");
    ok("var x = 1e3\nx := x + 0.25\nplot(x)");
  });
  it("a whole-number literal stays int and refuses a float", () => {
    expect(err("var x = 0\nx := x + 0.5\nplot(x)")[0]).toMatch(/cannot assign series float to int "x" \(declare it float: float x = 0\.0, or var float x = 0\.0/);
  });
  it("a float literal is not an int argument", () => {
    expect(err("plot(ta.sma(close, 14.0))")).toEqual(['argument "length" of ta.sma must be an int, got float']);
    expect(err("var int n = 0\nn := 1.0\nplot(n)")[0]).toMatch(/to int "n"/);
  });
  it("the hint's own advice compiles", () => {
    ok("float x = 0.0\nx := 2.5\nplot(x)");
    ok("var float anchor = 0.0\nanchor := ta.sma(close, 3)[0]\nplot(anchor)");
  });
});

describe("ints that come from series", () => {
  it("ta.highestbars / ta.lowestbars are int-valued", () => {
    const vals = run("var int anchor = -1\nanchor := bar_index - ta.lowestbars(low, 5)\nplot(anchor)")[0]!;
    expect(vals.length).toBeGreaterThan(10);
    ok("int k = ta.highestbars(high, 5)\nplot(k)");
  });
  it("a series float still cannot go into an int, and the hint names a declaration that works", () => {
    expect(err("var int a = -1\na := ta.sma(close, 5)\nplot(a)")[0]).toContain("var float a = 0.0");
  });
});

describe("dead ends refused at compile time", () => {
  it("ta.linreg needs at least 2 bars", () => {
    expect(err("plot(ta.linreg(close, 1))")).toEqual(['argument "length" of ta.linreg must be between 2 and 5000, got 1']);
    ok("plot(ta.linreg(close, 2))");
  });
  it("a string chosen per bar is refused", () => {
    expect(err('s = close > open ? "a" : "b"\nplot(close)')[0]).toMatch(/a string cannot depend on a series/);
    ok('flag = input.bool(true)\nlabel = flag ? "a" : "b"\nplot(close)');
  });
});

describe("the program view", () => {
  const exprOf = (e: Expr | null): Expr => { if (!e) throw new Error("no expression"); return e; };

  it("lists the plots with their expressions, and the statements", () => {
    const r = ok('indicator("T", overlay=true)\nhline(70)\nvar float s = 0.0\ns += hlc3 * volume\nplot(s, "S")');
    expect(r.plan.overlay).toBe(true);
    expect(r.plan.needs).toBe("ohlcv");
    expect(r.plan.plots.map((p) => [p.kind, p.title])).toEqual([["hline", "Level 1"], ["line", "S"]]);
    const h = exprOf(r.plan.plots[0]!.expr);
    expect(h.k === "num" && h.value).toBe(70);
    expect(r.plan.body.map((s) => s.k)).toEqual(["expr", "expr", "decl", "assign", "expr"]);
  });
  it("names resolve to one declaration, so uses and assignments of a variable share a symbol", () => {
    const r = ok("var float s = 0.0\ns += close\nplot(s)");
    const decl = r.plan.body[0]!;
    const asg = r.plan.body[1]!;
    const used = exprOf(r.plan.plots[0]!.expr);
    if (decl.k !== "decl" || asg.k !== "assign" || used.k !== "id") throw new Error("shape");
    expect(decl.sym).toBeDefined();
    expect(asg.sym).toBe(decl.sym);
    expect(used.sym).toBe(decl.sym);
  });
  it("needs reports no volume when the script reads none", () => {
    expect(ok("plot(close)").plan.needs).toBe("value");
    expect(ok("plot(high - low)").plan.needs).toBe("ohlc");
  });
  it("a literal remembers how it was written", () => {
    const r = ok("plot(0.0)\nplot(0)");
    const a = exprOf(r.plan.plots[0]!.expr), b = exprOf(r.plan.plots[1]!.expr);
    expect(a.k === "num" && a.float).toBe(true);
    expect(b.k === "num" && b.float).toBe(false);
  });
});
