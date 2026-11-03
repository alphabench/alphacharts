// Math transforms and operators (TA-Lib "Math Transform" / "Math Operators").
// Domain errors (acos of 2, ln of a negative) are absent bars, not zeros.

import type { Col, Graph, Node } from "../engine/graph.js";
import { COLORS, defineStudy, int, line, select, source } from "../define.js";
import { SOURCE_NAMES } from "../engine/graph.js";

const unary = (id: string, name: string, f: (x: number) => number, ref = `TA-Lib ${id.toUpperCase()}`) =>
  defineStudy({
    id, name, family: "math", needs: "value", pane: "new", inputs: [source()], columns: [id], plots: [line(id, COLORS.blue)],
    build: (g, p) => [g.map(g.src(p.source), (x) => { const r = f(x); return Number.isFinite(r) ? r : Number.NaN; })],
    reference: ref,
  });

export const acos = unary("acos", "Arc Cosine", Math.acos);
export const asin = unary("asin", "Arc Sine", Math.asin);
export const atan = unary("atan", "Arc Tangent", Math.atan);
export const ceil = unary("ceil", "Ceiling", Math.ceil);
export const cos = unary("cos", "Cosine", Math.cos);
export const cosh = unary("cosh", "Hyperbolic Cosine", Math.cosh);
export const exp = unary("exp", "Exponential", Math.exp);
export const floor = unary("floor", "Floor", Math.floor);
export const ln = unary("ln", "Natural Log", Math.log);
export const log10 = unary("log10", "Log10", Math.log10);
export const sin = unary("sin", "Sine", Math.sin);
export const sinh = unary("sinh", "Hyperbolic Sine", Math.sinh);
export const sqrt = unary("sqrt", "Square Root", Math.sqrt);
export const tan = unary("tan", "Tangent", Math.tan);
export const tanh = unary("tanh", "Hyperbolic Tangent", Math.tanh);

const binary = (id: string, name: string, f: (a: number, b: number) => number) =>
  defineStudy({
    id, name, family: "math", needs: "ohlc", pane: "new",
    inputs: [source("high"), source("low", "source2")], columns: [id], plots: [line(id, COLORS.orange)],
    build: (g, p) => [g.map2(g.src(p.source), g.src(p.source2), f)],
    reference: `TA-Lib ${id.toUpperCase()}`,
  });

export const add = binary("add", "Vector Arithmetic Add", (a, b) => a + b);
export const sub = binary("sub", "Vector Arithmetic Subtraction", (a, b) => a - b);
export const mult = binary("mult", "Vector Arithmetic Mult", (a, b) => a * b);
export const div = binary("div", "Vector Arithmetic Div", (a, b) => (b === 0 ? Number.NaN : a / b));

const win = (def = 30) => int("length", def, 1, 5000);

export const max = defineStudy({
  id: "max", name: "Highest value over a period", family: "math", needs: "value", pane: "overlay",
  inputs: [win(), source()], columns: ["max"], plots: [line("max", COLORS.green)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.highest(g.src(p.source), p.length)],
  reference: "TA-Lib MAX",
});
export const min = defineStudy({
  id: "min", name: "Lowest value over a period", family: "math", needs: "value", pane: "overlay",
  inputs: [win(), source()], columns: ["min"], plots: [line("min", COLORS.red)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.lowest(g.src(p.source), p.length)],
  reference: "TA-Lib MIN",
});
export const sum = defineStudy({
  id: "sum", name: "Summation", family: "math", needs: "value", pane: "new",
  inputs: [win(), source()], columns: ["sum"], plots: [line("sum", COLORS.blue)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.sum(g.src(p.source), p.length)],
  reference: "TA-Lib SUM",
});

/** Absolute bar index of the extreme (TA-Lib reports the index into the input). Its ties: the oldest maximum, the newest minimum. */
const idx = (g: Graph, bars: Node): Node => g.calc((i) => i - bars.v[i]!);

export const maxindex = defineStudy({
  id: "maxindex", name: "Index of highest value over a period", family: "math", needs: "value", pane: "new",
  inputs: [win(), source()], columns: ["maxindex"], plots: [line("maxindex", COLORS.green)],
  label: (p) => `${p.length}`,
  build: (g, p) => [idx(g, g.highestBars(g.src(p.source), p.length, true))],
  reference: "TA-Lib MAXINDEX",
});
export const minindex = defineStudy({
  id: "minindex", name: "Index of lowest value over a period", family: "math", needs: "value", pane: "new",
  inputs: [win(), source()], columns: ["minindex"], plots: [line("minindex", COLORS.red)],
  label: (p) => `${p.length}`,
  build: (g, p) => [idx(g, g.lowestBars(g.src(p.source), p.length))],
  reference: "TA-Lib MININDEX",
});
export const minmax = defineStudy({
  id: "minmax", name: "Lowest and highest values over a period", family: "math", needs: "value", pane: "overlay",
  inputs: [win(), source()], columns: ["min", "max"],
  plots: [line("min", COLORS.red), line("max", COLORS.green)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source);
    return [g.lowest(x, p.length), g.highest(x, p.length)];
  },
  reference: "TA-Lib MINMAX",
});
export const minmaxindex = defineStudy({
  id: "minmaxindex", name: "Indexes of lowest and highest values over a period", family: "math", needs: "value", pane: "new",
  inputs: [win(), source()], columns: ["minidx", "maxidx"],
  plots: [line("minidx", COLORS.red), line("maxidx", COLORS.green)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source);
    return [idx(g, g.lowestBars(x, p.length)), idx(g, g.highestBars(x, p.length, true))];
  },
  reference: "TA-Lib MINMAXINDEX",
});

void select;
export type { Col };
void SOURCE_NAMES;
