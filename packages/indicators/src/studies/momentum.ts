// Momentum studies and oscillators: TA-Lib group "Momentum Indicators" with the
// TradingView oscillators that are the same computation. Where TradingView and
// TA-Lib differ in method the input says so and TradingView's is the default.

import type { Col, Graph, Node } from "../engine/graph.js";
import { band, COLORS, defineStudy, float, hist, hline, int, line, select, source } from "../define.js";
import { ma, maGated, MA_TYPES, type MaType } from "./ma.js";

const len = (def: number, min = 1) => int("length", def, min, 5000);

// ---- RSI, CMO ---------------------------------------------------------------

export const rsi = defineStudy({
  id: "rsi", name: "Relative Strength Index", family: "momentum", needs: "value", pane: "new",
  inputs: [len(14), source()], columns: ["rsi"],
  plots: [line("rsi", COLORS.purple), hline("upper", 70), hline("lower", 30), hline("middle", 50, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const ch = g.change(g.src(p.source), 1);
    const au = g.rma(g.map(ch, (d) => (d > 0 ? d : d === d ? 0 : Number.NaN)), p.length);
    const ad = g.rma(g.map(ch, (d) => (d < 0 ? -d : d === d ? 0 : Number.NaN)), p.length);
    return [g.map2(au, ad, (u, d) => (u + d === 0 ? 0 : (100 * u) / (u + d)))];
  },
  reference: "TA-Lib RSI (Wilder smoothing, seeded with the mean of the first `length` changes)",
});

export const cmo = defineStudy({
  id: "cmo", name: "Chande Momentum Oscillator", family: "momentum", needs: "value", pane: "new",
  inputs: [len(9), source(), select("method", "sum", ["sum", "wilder"])], columns: ["cmo"],
  plots: [line("cmo", COLORS.blue), hline("upper", 50), hline("lower", -50), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const ch = g.change(g.src(p.source), 1);
    const up = g.map(ch, (d) => (d > 0 ? d : d === d ? 0 : Number.NaN));
    const dn = g.map(ch, (d) => (d < 0 ? -d : d === d ? 0 : Number.NaN));
    const [u, d] = p.method === "wilder" ? [g.rma(up, p.length), g.rma(dn, p.length)] : [g.sum(up, p.length), g.sum(dn, p.length)];
    return [g.map2(u, d, (a, b) => (a + b === 0 ? 0 : (100 * (a - b)) / (a + b)))];
  },
  reference: "method sum = TradingView ta.cmo (window sums); method wilder = TA-Lib CMO",
});

// ---- rate of change family ----------------------------------------------------

export const mom = defineStudy({
  id: "mom", name: "Momentum", family: "momentum", needs: "value", pane: "new",
  inputs: [len(10), source()], columns: ["mom"], plots: [line("mom", COLORS.blue), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.change(g.src(p.source), p.length)],
  reference: "TA-Lib MOM",
});

const rocLike = (id: string, name: string, f: (x: number, b: number) => number, ref: string, hz?: number) =>
  defineStudy({
    id, name, family: "momentum", needs: "value", pane: "new",
    inputs: [len(id === "roc" ? 9 : 10), source()], columns: [id],
    plots: [line(id, COLORS.orange), ...(hz === undefined ? [] : [hline("base", hz, COLORS.gray, "dotted")])],
    label: (p) => `${p.length}`,
    build: (g, p) => {
      const x = g.src(p.source), b = g.lag(x, p.length);
      return [g.map2(x, b, (cur, base) => (base === 0 ? Number.NaN : f(cur, base)))];
    },
    reference: ref,
  });

export const roc = rocLike("roc", "Rate of Change", (x, b) => ((x - b) / b) * 100, "TA-Lib ROC = (x / x[n] - 1) * 100", 0);
export const rocp = rocLike("rocp", "Rate of Change Percentage", (x, b) => (x - b) / b, "TA-Lib ROCP = (x - x[n]) / x[n]", 0);
export const rocr = rocLike("rocr", "Rate of Change Ratio", (x, b) => x / b, "TA-Lib ROCR = x / x[n]", 1);
export const rocr100 = rocLike("rocr100", "Rate of Change Ratio 100 scale", (x, b) => (x / b) * 100, "TA-Lib ROCR100 = x / x[n] * 100", 100);

export const trix = defineStudy({
  id: "trix", name: "TRIX", family: "momentum", needs: "value", pane: "new",
  inputs: [len(18), source()], columns: ["trix"], plots: [line("trix", COLORS.red), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const e3 = g.ema(g.ema(g.ema(g.src(p.source), p.length), p.length), p.length);
    return [g.map2(e3, g.lag(e3, 1), (a, b) => (b === 0 ? Number.NaN : (a / b - 1) * 100))];
  },
  reference: "TA-Lib TRIX = 1-bar ROC (percent) of a triple-smoothed EMA",
});

// ---- price oscillators and MACD ---------------------------------------------

const maInput = (def: string, key = "maType") => select(key, def, MA_TYPES);

function twoMas(g: Graph, x: Col, fast: number, slow: number, type: MaType, gated = false): [Node, Node] {
  const s = ma(g, type, x, slow);
  return [gated ? maGated(g, type, x, fast, s) : ma(g, type, x, fast), s];
}

export const apo = defineStudy({
  id: "apo", name: "Absolute Price Oscillator", family: "momentum", needs: "value", pane: "new",
  inputs: [int("fast", 12, 1, 5000), int("slow", 26, 2, 5000), source(), maInput("ema")], columns: ["apo"],
  plots: [line("apo", COLORS.blue), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.fast}, ${p.slow}`,
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`apo: fast (${p.fast}) must be below slow (${p.slow})`);
    const [f, s] = twoMas(g, g.src(p.source), p.fast, p.slow, p.maType);
    return [g.sub(f, s)];
  },
  reference: "TA-Lib APO (fast average starts at the slow average's first bar)",
});

export const ppo = defineStudy({
  id: "ppo", name: "Percentage Price Oscillator", family: "momentum", needs: "value", pane: "new",
  inputs: [int("fast", 12, 1, 5000), int("slow", 26, 2, 5000), int("signal", 9, 1, 5000), source(), maInput("ema")], columns: ["ppo", "signal", "histogram"],
  plots: [hist("histogram", COLORS.green, COLORS.red), line("ppo", COLORS.blue), line("signal", COLORS.orange)],
  label: (p) => `${p.fast}, ${p.slow}, ${p.signal}`,
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`ppo: fast (${p.fast}) must be below slow (${p.slow})`);
    const [f, s] = twoMas(g, g.src(p.source), p.fast, p.slow, p.maType);
    const line_ = g.map2(f, s, (a, b) => (b === 0 ? Number.NaN : ((a - b) / b) * 100));
    const sig = g.ema(line_, p.signal);
    return [line_, sig, g.sub(line_, sig)];
  },
  reference: "TA-Lib PPO (line only; the signal EMA and histogram follow TradingView's Price Oscillator)",
});

const macdColumns = ["macd", "signal", "histogram"];
const macdPlots = [hist("histogram", COLORS.green, COLORS.red), line("macd", COLORS.blue), line("signal", COLORS.orange)];

export const macd = defineStudy({
  id: "macd", name: "MACD", family: "momentum", needs: "value", pane: "new",
  inputs: [int("fast", 12, 1, 5000), int("slow", 26, 2, 5000), int("signal", 9, 1, 5000), source()], columns: macdColumns, plots: macdPlots,
  label: (p) => `${p.fast}, ${p.slow}, ${p.signal}`,
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`macd: fast (${p.fast}) must be below slow (${p.slow})`);
    const x = g.src(p.source);
    const [f, s] = twoMas(g, x, p.fast, p.slow, "ema", true);
    const line_ = g.sub(f, s), sig = g.ema(line_, p.signal);
    return [line_, sig, g.sub(line_, sig)];
  },
  reference: "TA-Lib MACD (the fast EMA is seeded at the slow EMA's first bar; TradingView seeds it at bar 0, the difference decays below 1e-9 within ~150 bars)",
});

export const macdfix = defineStudy({
  id: "macdfix", name: "MACD Fix 12/26", family: "momentum", needs: "value", pane: "new",
  inputs: [int("signal", 9, 1, 5000), source()], columns: macdColumns, plots: macdPlots,
  label: (p) => `${p.signal}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const s = g.smooth(x, 26, 0.075);
    const f = maGatedAlpha(g, x, 12, 0.15, s);
    const line_ = g.sub(f, s), sig = g.ema(line_, p.signal);
    return [line_, sig, g.sub(line_, sig)];
  },
  reference: "TA-Lib MACDFIX: fixed 12/26 with smoothing constants 0.15 and 0.075",
});

function maGatedAlpha(g: Graph, x: Col, p: number, alpha: number, gate: Col): Node {
  return emaG(g, x, p, alpha, gate);
}
import { emaGated as emaG } from "./ma.js";

export const macdext = defineStudy({
  id: "macdext", name: "MACD with controllable MA type", family: "momentum", needs: "value", pane: "new",
  inputs: [int("fast", 12, 1, 5000), int("slow", 26, 2, 5000), int("signal", 9, 1, 5000), source(),
    maInput("ema", "fastType"), maInput("ema", "slowType"), maInput("ema", "signalType")],
  columns: macdColumns, plots: macdPlots,
  label: (p) => `${p.fast}, ${p.slow}, ${p.signal}`,
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`macdext: fast (${p.fast}) must be below slow (${p.slow})`);
    const x = g.src(p.source);
    const s = ma(g, p.slowType, x, p.slow);
    const f = maGated(g, p.fastType, x, p.fast, s);
    const line_ = g.sub(f, s), sig = ma(g, p.signalType, line_, p.signal);
    return [line_, sig, g.sub(line_, sig)];
  },
  reference: "TA-Lib MACDEXT",
});

// ---- stochastic -------------------------------------------------------------

/** 100 * (close - LL) / (HH - LL); a flat range gives 0 as TA-Lib defines it. */
function rawStoch(g: Graph, x: Col, hi: Col, lo: Col, p: number): Node {
  const hh = g.highest(hi, p), ll = g.lowest(lo, p);
  return g.calc((i) => {
    const r = hh.v[i]! - ll.v[i]!;
    return r !== r ? Number.NaN : r === 0 ? 0 : (100 * (x.v[i]! - ll.v[i]!)) / r;
  });
}

const stochPlots = [line("k", COLORS.blue, { title: "%K" }), line("d", COLORS.orange, { title: "%D" }), hline("upper", 80), hline("lower", 20)];

export const stoch = defineStudy({
  id: "stoch", name: "Stochastic", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [int("kLength", 14, 1, 5000), int("kSmooth", 1, 1, 5000), int("dLength", 3, 1, 5000), maInput("sma", "kType"), maInput("sma", "dType")],
  columns: ["k", "d"], plots: stochPlots,
  label: (p) => `${p.kLength}, ${p.kSmooth}, ${p.dLength}`,
  build: (g, p) => {
    const k = ma(g, p.kType, rawStoch(g, g.close, g.high, g.low, p.kLength), p.kSmooth);
    return [k, ma(g, p.dType, k, p.dLength)];
  },
  reference: "TA-Lib STOCH (slow %K = MA of fast %K); defaults are TradingView's 14, 1, 3",
});

export const stochf = defineStudy({
  id: "stochf", name: "Stochastic Fast", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [int("kLength", 5, 1, 5000), int("dLength", 3, 1, 5000), maInput("sma", "dType")],
  columns: ["k", "d"], plots: stochPlots,
  label: (p) => `${p.kLength}, ${p.dLength}`,
  build: (g, p) => {
    const k = rawStoch(g, g.close, g.high, g.low, p.kLength);
    return [k, ma(g, p.dType, k, p.dLength)];
  },
  reference: "TA-Lib STOCHF",
});

export const stochrsi = defineStudy({
  id: "stochrsi", name: "Stochastic RSI", family: "momentum", needs: "value", pane: "new",
  inputs: [int("rsiLength", 14, 1, 5000), int("stochLength", 14, 1, 5000), int("kSmooth", 3, 1, 5000), int("dSmooth", 3, 1, 5000), source()],
  columns: ["raw", "k", "d"],
  plots: [line("k", COLORS.blue, { title: "%K" }), line("d", COLORS.orange, { title: "%D" }), hline("upper", 80), hline("lower", 20)],
  label: (p) => `${p.rsiLength}, ${p.stochLength}, ${p.kSmooth}, ${p.dSmooth}`,
  build: (g, p) => {
    const ch = g.change(g.src(p.source), 1);
    const au = g.rma(g.map(ch, (d) => (d > 0 ? d : d === d ? 0 : Number.NaN)), p.rsiLength);
    const ad = g.rma(g.map(ch, (d) => (d < 0 ? -d : d === d ? 0 : Number.NaN)), p.rsiLength);
    const r = g.map2(au, ad, (u, d) => (u + d === 0 ? 0 : (100 * u) / (u + d)));
    const raw = rawStoch(g, r, r, r, p.stochLength);
    const k = g.sma(raw, p.kSmooth);
    return [raw, k, g.sma(k, p.dSmooth)];
  },
  reference: "TA-Lib STOCHRSI: `raw` = fastk, `k` = fastd with period kSmooth; `d` is TradingView's second smoothing",
});

export const willr = defineStudy({
  id: "willr", name: "Williams %R", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(14)], columns: ["willr"],
  plots: [line("willr", COLORS.purple, { title: "%R" }), hline("upper", -20), hline("lower", -80)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const hh = g.highest(g.high, p.length), ll = g.lowest(g.low, p.length);
    return [g.calc((i) => {
      const r = hh.v[i]! - ll.v[i]!;
      return r !== r || r === 0 ? Number.NaN : (-100 * (hh.v[i]! - g.close.v[i]!)) / r;
    })];
  },
  reference: "TA-Lib WILLR (a flat range is absent here; TA-Lib reports 0)",
});

// ---- CCI, BOP, MFI, ultimate -------------------------------------------------

export const cci = defineStudy({
  id: "cci", name: "Commodity Channel Index", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(20)], columns: ["cci"],
  plots: [line("cci", COLORS.blue), hline("upper", 100), hline("lower", -100)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const tp = g.src("hlc3"), m = g.sma(tp, p.length), n = p.length;
    return [g.calc((i) => {
      const mean = m.v[i]!;
      if (mean !== mean) return Number.NaN;
      let dev = 0;
      for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp.v[j]! - mean);
      dev /= n;
      return dev === 0 ? Number.NaN : (tp.v[i]! - mean) / (0.015 * dev);
    })];
  },
  reference: "TA-Lib CCI (typical price, mean deviation; zero deviation is absent here, TA-Lib reports 0)",
});

export const bop = defineStudy({
  id: "bop", name: "Balance Of Power", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [], columns: ["bop"], plots: [line("bop", COLORS.teal), hline("zero", 0, COLORS.gray, "dotted")],
  build: (g) => [g.calc((i) => {
    const r = g.high.v[i]! - g.low.v[i]!;
    return r > 0 ? (g.close.v[i]! - g.open.v[i]!) / r : 0;
  })],
  reference: "TA-Lib BOP = (close - open) / (high - low), 0 on a flat bar",
});

export const mfi = defineStudy({
  id: "mfi", name: "Money Flow Index", family: "momentum", needs: "ohlcv", pane: "new",
  inputs: [len(14)], columns: ["mfi"],
  plots: [line("mfi", COLORS.purple), hline("upper", 80), hline("lower", 20)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const tp = g.src("hlc3");
    const pos = g.calc((i) => (i === 0 ? Number.NaN : tp.v[i]! > tp.v[i - 1]! ? tp.v[i]! * g.volume.v[i]! : 0));
    const neg = g.calc((i) => (i === 0 ? Number.NaN : tp.v[i]! < tp.v[i - 1]! ? tp.v[i]! * g.volume.v[i]! : 0));
    const sp = g.sum(pos, p.length), sn = g.sum(neg, p.length);
    return [g.map2(sp, sn, (a, b) => (a + b === 0 ? 0 : (100 * a) / (a + b)))];
  },
  reference: "TA-Lib MFI",
});

export const ultosc = defineStudy({
  id: "ultosc", name: "Ultimate Oscillator", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [int("fast", 7, 1, 5000), int("middle", 14, 1, 5000), int("slow", 28, 1, 5000)], columns: ["ultosc"],
  plots: [line("ultosc", COLORS.blue), hline("upper", 70), hline("lower", 30)],
  label: (p) => `${p.fast}, ${p.middle}, ${p.slow}`,
  build: (g, p) => {
    const [a, b, c] = [p.fast, p.middle, p.slow].sort((x: number, y: number) => x - y) as [number, number, number];
    const bp = g.calc((i) => (i === 0 ? Number.NaN : g.close.v[i]! - Math.min(g.low.v[i]!, g.close.v[i - 1]!)));
    const tr = g.calc((i) => (i === 0 ? Number.NaN : Math.max(g.high.v[i]!, g.close.v[i - 1]!) - Math.min(g.low.v[i]!, g.close.v[i - 1]!)));
    const [b1, b2, b3] = [g.sum(bp, a), g.sum(bp, b), g.sum(bp, c)];
    const [t1, t2, t3] = [g.sum(tr, a), g.sum(tr, b), g.sum(tr, c)];
    return [g.calc((i) => {
      const r1 = b1.v[i]! / t1.v[i]!, r2 = b2.v[i]! / t2.v[i]!, r3 = b3.v[i]! / t3.v[i]!;
      return (100 * (4 * r1 + 2 * r2 + r3)) / 7;
    })];
  },
  reference: "TA-Lib ULTOSC (periods sorted ascending, weights 4:2:1)",
});

// ---- Aroon ------------------------------------------------------------------

export const aroon = defineStudy({
  id: "aroon", name: "Aroon", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(14)], columns: ["up", "down"],
  plots: [line("up", COLORS.green, { title: "Aroon Up" }), line("down", COLORS.red, { title: "Aroon Down" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const hb = g.highestBars(g.high, p.length + 1), lb = g.lowestBars(g.low, p.length + 1);
    return [g.map(hb, (k) => (100 * (p.length - k)) / p.length), g.map(lb, (k) => (100 * (p.length - k)) / p.length)];
  },
  reference: "TA-Lib AROON (window of length + 1 bars)",
});

export const aroonosc = defineStudy({
  id: "aroonosc", name: "Aroon Oscillator", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(14)], columns: ["aroonosc"], plots: [line("aroonosc", COLORS.blue), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const hb = g.highestBars(g.high, p.length + 1), lb = g.lowestBars(g.low, p.length + 1);
    return [g.map2(hb, lb, (h, l) => (100 * (l - h)) / p.length)];
  },
  reference: "TA-Lib AROONOSC = Aroon Up - Aroon Down",
});

// ---- directional movement ---------------------------------------------------

/** Wilder's running sum: seeded with the sum of the first p-1 values, then S - S/p + x (TA-Lib's DM/TR smoothing). */
function wilderSum(g: Graph, x: Col, p: number): Node {
  const cnt = g.validRun(x);
  return g.node((s, a, b) => {
    const xv = x.v, c = cnt.v, v = s.v;
    for (let i = a; i < b; i++) {
      const k = c[i]!;
      if (k === 0) { v[i] = Number.NaN; continue; }
      const prev = i > 0 ? v[i - 1]! : Number.NaN;
      if (prev === prev) v[i] = prev - prev / p + xv[i]!;
      else if (k === p - 1) {
        let t = 0;
        for (let j = i - k + 1; j <= i; j++) t += xv[j]!;
        v[i] = t;
      } else v[i] = Number.NaN;
    }
  });
}

function dm(g: Graph, p: number) {
  if (p < 2) throw new RangeError(`directional movement needs length >= 2, got ${p}`);
  const { high, low } = g;
  const plus = g.calc((i) => {
    if (i === 0) return Number.NaN;
    const up = high.v[i]! - high.v[i - 1]!, dn = low.v[i - 1]! - low.v[i]!;
    return up > 0 && up > dn ? up : 0;
  });
  const minus = g.calc((i) => {
    if (i === 0) return Number.NaN;
    const up = high.v[i]! - high.v[i - 1]!, dn = low.v[i - 1]! - low.v[i]!;
    return dn > 0 && dn > up ? dn : 0;
  });
  const sp = wilderSum(g, plus, p), sm = wilderSum(g, minus, p), st = wilderSum(g, g.tr(), p);
  const gate = g.lag(st, 1);
  const di = (s: Node) => g.calc((i) => (gate.v[i]! === gate.v[i]! && st.v[i]! > 0 ? (100 * s.v[i]!) / st.v[i]! : Number.NaN));
  const pdi = di(sp), mdi = di(sm);
  const dx = g.map2(pdi, mdi, (a, b) => (a + b === 0 ? Number.NaN : (100 * Math.abs(a - b)) / (a + b)));
  return { sp, sm, pdi, mdi, dx };
}

const diPlots = [line("adx", COLORS.red, { title: "ADX" }), line("plusDi", COLORS.blue, { title: "+DI" }), line("minusDi", COLORS.orange, { title: "-DI" })];

export const adx = defineStudy({
  id: "adx", name: "Average Directional Index", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(14, 2)], columns: ["adx", "plusDi", "minusDi"], plots: diPlots,
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const d = dm(g, p.length);
    return [g.rma(d.dx, p.length), d.pdi, d.mdi];
  },
  reference: "TA-Lib ADX / PLUS_DI / MINUS_DI (Wilder smoothing seeded as TA-Lib does)",
});

export const adxr = defineStudy({
  id: "adxr", name: "Average Directional Movement Index Rating", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(14, 2)], columns: ["adxr"], plots: [line("adxr", COLORS.red)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const a = g.rma(dm(g, p.length).dx, p.length);
    return [g.map2(a, g.lag(a, p.length - 1), (x, y) => (x + y) / 2)];
  },
  reference: "TA-Lib ADXR = (ADX + ADX[length - 1]) / 2",
});

export const dx = defineStudy({
  id: "dx", name: "Directional Movement Index", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [len(14, 2)], columns: ["dx"], plots: [line("dx", COLORS.purple)],
  label: (p) => `${p.length}`,
  build: (g, p) => [dm(g, p.length).dx],
  reference: "TA-Lib DX",
});

const diStudy = (id: string, name: string, pick: (d: ReturnType<typeof dm>) => Node, color: string) =>
  defineStudy({
    id, name, family: "momentum", needs: "ohlc", pane: "new", inputs: [len(14, 2)], columns: [id.replace("-", "")], plots: [line(id.replace("-", ""), color)],
    label: (p) => `${p.length}`,
    build: (g, p) => [pick(dm(g, p.length))],
    reference: `TA-Lib ${id.replace("-", "_").toUpperCase()}`,
  });

export const plusDi = diStudy("plus-di", "Plus Directional Indicator", (d) => d.pdi, COLORS.blue);
export const minusDi = diStudy("minus-di", "Minus Directional Indicator", (d) => d.mdi, COLORS.orange);
export const plusDm = diStudy("plus-dm", "Plus Directional Movement", (d) => d.sp, COLORS.blue);
export const minusDm = diStudy("minus-dm", "Minus Directional Movement", (d) => d.sm, COLORS.orange);

void band;
void float;
