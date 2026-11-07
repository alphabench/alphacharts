// plot(..., offset=) and plotshape(..., offset=) take a literal or a whole-number input expression (`-right`), worked
// out from the study's inputs when it is built. A mark shifted back by `right` sits on the swing bar itself.

import { describe, expect, it } from "vitest";
import { resolveParams, StudyEngine, type PlotDef } from "@alphacharts/indicators";
import { compile } from "../src/index.js";
import { DATA, ok } from "./support.js";

const SWING = [
  'indicator("Swings", overlay=true)',
  'left = input.int(3, "Left", minval=1, maxval=50)',
  'right = input.int(2, "Right", minval=1, maxval=50)',
  "isHigh = high[right] == ta.highest(high, left + right + 1)",
  'plotshape(isHigh, "Swing high", shape.triangledown, location.abovebar, color.red, offset=-right)',
].join("\n");

const markers = (src: string) => ok(src).study.plots.find((p) => p.kind === "markers") as Extract<PlotDef, { kind: "markers" }>;
const shift = (p: Extract<PlotDef, { kind: "markers" | "line" }>, inputs: Record<string, number> = {}) => {
  const study = ok(SWING).study;
  return typeof p.offset === "function" ? p.offset(resolveParams(study, inputs)) : p.offset;
};

describe("offset from an input", () => {
  it("is the input's value, negated, for the inputs given", () => {
    const p = markers(SWING);
    expect(typeof p.offset).toBe("function");
    expect(shift(p)).toBe(-2);
    expect(shift(p, { right: 7 })).toBe(-7);
  });

  it("works on plot too, with an expression of inputs", () => {
    const study = ok('r = input.int(4, "R", minval=1, maxval=50)\nplot(close, "c", offset=-(r + 1))').study;
    const line = study.plots.find((x) => x.kind === "line") as Extract<PlotDef, { kind: "line" }>;
    expect((line.offset as (p: unknown) => number)(resolveParams(study, {}))).toBe(-5);
  });

  it("keeps a literal a plain number", () => {
    expect(markers('plotshape(close > open, "x", offset=-3)').offset).toBe(-3);
  });

  it("puts a swing's mark on the swing bar: the column is true on the confirming bar, the shift is `right` back", () => {
    const study = ok(SWING).study;
    const e = new StudyEngine(study);
    e.load(DATA);
    const p = study.plots[0] as Extract<PlotDef, { kind: "markers" }>;
    const col = e.column(study.columns.indexOf(p.col));
    const off = shift(p) as number;
    const high = DATA.high;
    let seen = 0;
    for (let i = 0; i < col.length; i++) {
      if (Number.isNaN(col[i]!)) continue;
      seen++;
      const bar = i + off;
      // the marked bar is the highest of the `left` bars before it, itself and the `right` after it
      expect(high[bar]).toBe(Math.max(...Array.from(high.slice(bar - 3, bar + 3))));
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("offset refusals", () => {
  const refused = (src: string) => {
    const r = compile(src);
    expect(r.ok, src).toBe(false);
    return r.ok ? "" : r.diagnostics.map((d) => d.message).join(" | ");
  };

  it("refuses a series, a float input and a float literal", () => {
    expect(refused('plot(close, "c", offset=close)')).toMatch(/must be an int/);
    expect(refused('r = input.float(2, "R")\nplot(close, "c", offset=r)')).toMatch(/must be an int/);
    expect(refused('plot(close, "c", offset=1.5)')).toMatch(/must be an int/);
  });

  it("refuses a value that changes bar by bar", () => {
    expect(refused('plot(close, "c", offset=bar_index)')).toMatch(/literal or an input/);
  });

  it("fails the build, not the draw, when the inputs put the shift out of range", () => {
    const study = ok('r = input.int(5, "R", minval=1, maxval=9000)\nplot(close, "c", offset=-r)').study;
    const line = study.plots.find((x) => x.kind === "line") as Extract<PlotDef, { kind: "line" }>;
    expect(() => (line.offset as (p: unknown) => number)(resolveParams(study, { r: 9000 }))).toThrow(/between -5000 and 5000/);
  });
});
