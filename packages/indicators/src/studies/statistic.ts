// Statistic functions (TA-Lib "Statistic Functions"): regression, deviation,
// variance, correlation and beta over a rolling window.

import type { Col, Graph, Node } from "../engine/graph.js";
import { COLORS, defineStudy, float, int, line, select, source } from "../define.js";
import { SOURCE_NAMES } from "../engine/graph.js";

const len = (def: number, min = 2) => int("length", def, min, 5000);
const RAD = 180 / Math.PI;

const reg = (id: string, name: string, color: string, pick: (r: ReturnType<Graph["linreg"]>, g: Graph) => Node, ref: string, pane: "overlay" | "new") =>
  defineStudy({
    id, name, family: "statistic", needs: "value", pane, inputs: [len(14), source()], columns: [id], plots: [line(id, color)],
    label: (p) => `${p.length}`,
    build: (g, p) => [pick(g.linreg(g.src(p.source), p.length), g)],
    reference: ref,
  });

export const linearreg = reg("linearreg", "Linear Regression", COLORS.blue, (r) => r.value, "TA-Lib LINEARREG", "overlay");
export const linearregSlope = reg("linearreg-slope", "Linear Regression Slope", COLORS.orange, (r) => r.slope, "TA-Lib LINEARREG_SLOPE", "new");
export const linearregIntercept = reg("linearreg-intercept", "Linear Regression Intercept", COLORS.teal, (r) => r.intercept, "TA-Lib LINEARREG_INTERCEPT", "overlay");
export const linearregAngle = reg("linearreg-angle", "Linear Regression Angle", COLORS.purple, (r, g) => g.map(r.slope, (m) => Math.atan(m) * RAD), "TA-Lib LINEARREG_ANGLE (degrees)", "new");
export const tsf = reg("tsf", "Time Series Forecast", COLORS.pink, (r, g) => g.map2(r.value, r.slope, (v, m) => v + m), "TA-Lib TSF = regression value one bar ahead", "overlay");

export const stddev = defineStudy({
  id: "stddev", name: "Standard Deviation", family: "statistic", needs: "value", pane: "new",
  inputs: [len(5, 1), float("nbdev", 1, 0, 100, 0.1), source()], columns: ["stddev"], plots: [line("stddev", COLORS.blue)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.map(g.stdev(g.src(p.source), p.length), (v) => v * p.nbdev)],
  reference: "TA-Lib STDDEV (population)",
});

export const variance = defineStudy({
  id: "var", name: "Variance", family: "statistic", needs: "value", pane: "new",
  inputs: [len(5, 1), source()], columns: ["var"], plots: [line("var", COLORS.blue)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.variance(g.src(p.source), p.length)],
  reference: "TA-Lib VAR (population)",
});

const SOURCES2 = [...SOURCE_NAMES, "volume"] as const;
function pick(g: Graph, name: string): Col {
  return name === "volume" ? g.volume : g.src(name as (typeof SOURCE_NAMES)[number]);
}

export const correl = defineStudy({
  id: "correl", name: "Correlation Coefficient", family: "statistic", needs: "ohlcv", pane: "new",
  inputs: [len(30), source("close"), select("source2", "volume", SOURCES2)], columns: ["correl"], plots: [line("correl", COLORS.teal)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source), y = pick(g, p.source2), n = p.length;
    return [g.calc((i) => {
      if (i < n - 1) return Number.NaN;
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const a = x.v[j]!, b = y.v[j]!;
        sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
      }
      const d = (n * sxx - sx * sx) * (n * syy - sy * sy);
      return d > 0 ? (n * sxy - sx * sy) / Math.sqrt(d) : 0;
    })];
  },
  reference: "TA-Lib CORREL (Pearson; a constant window gives 0 as TA-Lib does)",
});

export const beta = defineStudy({
  id: "beta", name: "Beta", family: "statistic", needs: "ohlcv", pane: "new",
  inputs: [len(5, 1), source("close"), select("source2", "volume", SOURCES2)], columns: ["beta"], plots: [line("beta", COLORS.orange)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source), y = pick(g, p.source2), n = p.length;
    const rx = g.map2(x, g.lag(x, 1), (a, b) => (b === 0 ? 0 : (a - b) / b));
    const ry = g.map2(y, g.lag(y, 1), (a, b) => (b === 0 ? 0 : (a - b) / b));
    return [g.calc((i) => {
      if (i < n) return Number.NaN;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const a = rx.v[j]!, b = ry.v[j]!;
        sx += a; sy += b; sxx += a * a; sxy += a * b;
      }
      const d = n * sxx - sx * sx;
      return d === 0 ? 0 : (n * sxy - sx * sy) / d;
    })];
  },
  reference: "TA-Lib BETA: slope of source2's one-bar returns on source's over `length` returns",
});
