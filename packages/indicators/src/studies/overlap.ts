// Overlap studies: moving averages and bands drawn over price. TA-Lib group
// "Overlap Studies" plus the TradingView moving averages built on the same nodes.

import { band, COLORS, defineStudy, float, hline, int, line, select, source } from "../define.js";
import { dema as maDema, kama as maKama, ma as genericMa, MA_TYPES, t3 as maT3, tema as maTema, trima as maTrima, type MaType } from "./ma.js";

const len = (def: number) => int("length", def, 1, 5000);

export const sma = defineStudy({
  id: "sma", name: "Simple Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(9), source()], columns: ["sma"], plots: [line("sma", COLORS.neutral)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.sma(g.src(p.source), p.length)],
  reference: "TA-Lib SMA",
});

export const ema = defineStudy({
  id: "ema", name: "Exponential Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(9), source()], columns: ["ema"], plots: [line("ema", COLORS.orange)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.ema(g.src(p.source), p.length)],
  reference: "TA-Lib EMA",
});

export const wma = defineStudy({
  id: "wma", name: "Weighted Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(9), source()], columns: ["wma"], plots: [line("wma", COLORS.teal)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.wma(g.src(p.source), p.length)],
  reference: "TA-Lib WMA",
});

export const dema = defineStudy({
  id: "dema", name: "Double Exponential Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(9), source()], columns: ["dema"], plots: [line("dema", COLORS.teal)],
  label: (p) => `${p.length}`,
  build: (g, p) => [maDema(g, g.src(p.source), p.length)],
  reference: "TA-Lib DEMA",
});

export const tema = defineStudy({
  id: "tema", name: "Triple Exponential Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(9), source()], columns: ["tema"], plots: [line("tema", COLORS.pink)],
  label: (p) => `${p.length}`,
  build: (g, p) => [maTema(g, g.src(p.source), p.length)],
  reference: "TA-Lib TEMA",
});

export const trima = defineStudy({
  id: "trima", name: "Triangular Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(30), source()], columns: ["trima"], plots: [line("trima", COLORS.cyan)],
  label: (p) => `${p.length}`,
  build: (g, p) => [maTrima(g, g.src(p.source), p.length)],
  reference: "TA-Lib TRIMA",
});

export const kama = defineStudy({
  id: "kama", name: "Kaufman Adaptive Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(10), int("fast", 2, 1, 1000), int("slow", 30, 2, 5000), source()], columns: ["kama"], plots: [line("kama", COLORS.lime)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`kama: fast (${p.fast}) must be below slow (${p.slow})`);
    return [maKama(g, g.src(p.source), p.length, p.fast, p.slow)];
  },
  reference: "TA-Lib KAMA (fast/slow limits 2 and 30)",
});

export const t3 = defineStudy({
  id: "t3", name: "Tillson T3", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(5), float("vfactor", 0.7, 0, 1, 0.1), source()], columns: ["t3"], plots: [line("t3", COLORS.brown)],
  label: (p) => `${p.length}, ${p.vfactor}`,
  build: (g, p) => [maT3(g, g.src(p.source), p.length, p.vfactor)],
  reference: "TA-Lib T3",
});

export const ma = defineStudy({
  id: "ma", name: "Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(30), source(), select("type", "sma", MA_TYPES)], columns: ["ma"], plots: [line("ma", COLORS.neutral)],
  label: (p) => `${p.type.toUpperCase()} ${p.length}`,
  build: (g, p) => [genericMa(g, p.type as MaType, g.src(p.source), p.length)],
  reference: "TA-Lib MA (types SMA, EMA, WMA, DEMA, TEMA, TRIMA, KAMA, T3; RMA is Wilder's)",
});

export const bbands = defineStudy({
  id: "bbands", name: "Bollinger Bands", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(20), source(), float("multUp", 2, 0, 100, 0.1), float("multDn", 2, 0, 100, 0.1), select("maType", "sma", MA_TYPES)],
  columns: ["upper", "middle", "lower"],
  plots: [band("band", "upper", "lower", COLORS.neutral, "chart-1/0.1", "Bands"), line("middle", COLORS.orange)],
  label: (p) => `${p.length}, ${p.multUp}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const mid = genericMa(g, p.maType as MaType, x, p.length);
    const sd = g.stdev(x, p.length);
    return [g.calc((i) => mid.v[i]! + p.multUp * sd.v[i]!), mid, g.calc((i) => mid.v[i]! - p.multDn * sd.v[i]!)];
  },
  reference: "TA-Lib BBANDS (population standard deviation)",
});

export const bbpb = defineStudy({
  id: "bbpb", name: "Bollinger Bands %B", family: "overlap", needs: "value", pane: "new",
  inputs: [len(20), source(), float("mult", 2, 0, 100, 0.1)], columns: ["pb"],
  plots: [line("pb", COLORS.teal, { title: "%B" }), hline("upper", 1), hline("lower", 0), hline("middle", 0.5, COLORS.gray, "dotted")],
  label: (p) => `${p.length}, ${p.mult}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const mid = g.sma(x, p.length), sd = g.stdev(x, p.length);
    return [g.calc((i) => {
      const w = 2 * p.mult * sd.v[i]!;
      return w === 0 ? Number.NaN : (x.v[i]! - (mid.v[i]! - p.mult * sd.v[i]!)) / w;
    })];
  },
  reference: "TradingView Bollinger Bands %B = (source - lower) / (upper - lower)",
});

export const bbw = defineStudy({
  id: "bbw", name: "Bollinger Bands Width", family: "overlap", needs: "value", pane: "new",
  inputs: [len(20), source(), float("mult", 2, 0, 100, 0.1)], columns: ["bbw"],
  plots: [line("bbw", COLORS.neutral, { title: "BBW" })],
  label: (p) => `${p.length}, ${p.mult}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const mid = g.sma(x, p.length), sd = g.stdev(x, p.length);
    return [g.calc((i) => (2 * p.mult * sd.v[i]!) / mid.v[i]!)];
  },
  reference: "Pine ta.bbw = ((basis + dev) - (basis - dev)) / basis",
});

export const midpoint = defineStudy({
  id: "midpoint", name: "MidPoint over period", family: "overlap", needs: "value", pane: "overlay",
  inputs: [len(14), source()], columns: ["midpoint"], plots: [line("midpoint", COLORS.purple)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const hi = g.highest(x, p.length), lo = g.lowest(x, p.length);
    return [g.calc((i) => (hi.v[i]! + lo.v[i]!) / 2)];
  },
  reference: "TA-Lib MIDPOINT",
});

export const midprice = defineStudy({
  id: "midprice", name: "Midpoint Price over period", family: "overlap", needs: "ohlc", pane: "overlay",
  inputs: [len(14)], columns: ["midprice"], plots: [line("midprice", COLORS.purple)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const hi = g.highest(g.high, p.length), lo = g.lowest(g.low, p.length);
    return [g.calc((i) => (hi.v[i]! + lo.v[i]!) / 2)];
  },
  reference: "TA-Lib MIDPRICE",
});
