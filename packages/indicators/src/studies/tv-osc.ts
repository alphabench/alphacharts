// TradingView built-in oscillators. Each study cites the TradingView/Pine v5
// definition it implements. Shared deviation: `ema` and `rma` seed with the
// simple mean of the first `length` values (the engine's, TA-Lib's seeding);
// Pine's ta.ema seeds with the first value. The two differ only in the first
// bars and converge geometrically ((1 - alpha)^bars).

import { COLORS, bool, defineStudy, hist, hline, int, line, select, source } from "../define.js";
import type { Col, Graph, Node } from "../engine/graph.js";

const NaN_ = Number.NaN;

// ---- local helpers (all state in columns) -----------------------------------

/** Pine ta.roc: 100 * (x - x[n]) / x[n]. */
function roc(g: Graph, x: Col, n: number): Node {
  return g.node((s, a, b) => {
    const xv = x.v, v = s.v;
    for (let i = a; i < b; i++) {
      const p = i >= n ? xv[i - n]! : NaN_;
      v[i] = p === 0 ? NaN_ : (100 * (xv[i]! - p)) / p;
    }
  });
}

/** Pine ta.rsi from up/down Wilder means: down == 0 -> 100, up == 0 -> 0. */
function rsiOf(g: Graph, x: Col, n: number): Node {
  const ch = g.change(x, 1);
  const up = g.map(ch, (d) => (d > 0 ? d : d === d ? 0 : NaN_));
  const dn = g.map(ch, (d) => (d < 0 ? -d : d === d ? 0 : NaN_));
  const au = g.rma(up, n), ad = g.rma(dn, n);
  return g.map2(au, ad, (u, d) => (u !== u || d !== d ? NaN_ : d === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / d)));
}

/** ema(ema(x, a), b): TradingView's double_smooth(x, long = a, short = b). */
function doubleEma(g: Graph, x: Col, a: number, b: number): Node {
  return g.ema(g.ema(x, a), b);
}

/** Pine ta.swma: (x + 2 x[1] + 2 x[2] + x[3]) / 6. */
function swma(g: Graph, x: Col): Node {
  return g.calc((i) => (i >= 3 ? (x.v[i]! + 2 * x.v[i - 1]! + 2 * x.v[i - 2]! + x.v[i - 3]!) / 6 : NaN_));
}

/** Pine ta.tr(true): the first bar's true range is high - low. */
function trFirstBar(g: Graph): Node {
  const { high, low, close } = g;
  return g.calc((i) => {
    const h = high.v[i]!, l = low.v[i]!;
    if (i === 0) return h - l;
    const pc = close.v[i - 1]!;
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  });
}

/** Positive part where `x` rose, negative where it did not (for coloured histograms): up / down columns. */
function risingFalling(g: Graph, x: Col): { up: Node; down: Node } {
  const d = g.change(x, 1);
  return { up: g.map2(x, d, (v, c) => (c > 0 ? v : NaN_)), down: g.map2(x, d, (v, c) => (c <= 0 ? v : NaN_)) };
}

/** 100 * (x - lowest) / (highest - lowest) over n bars, carrying the last value over a flat range (Pine fixnan). */
function stochOf(g: Graph, x: Col, n: number): Node {
  const hi = g.highest(x, n), lo = g.lowest(x, n);
  return g.node((s, a, b) => {
    const xv = x.v, h = hi.v, l = lo.v, v = s.v;
    for (let i = a; i < b; i++) {
      const h1 = h[i]!, l1 = l[i]!;
      if (h1 !== h1 || l1 !== l1) { v[i] = NaN_; continue; }
      v[i] = h1 > l1 ? (100 * (xv[i]! - l1)) / (h1 - l1) : i > 0 ? v[i - 1]! : NaN_;
    }
  });
}

// ---- Fisher Transform -------------------------------------------------------

export const fisher = defineStudy({
  id: "fisher", name: "Fisher Transform", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 9, 1, 5000)], columns: ["fisher", "trigger"],
  plots: [line("fisher", COLORS.neutral), line("trigger", COLORS.orange), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src("hl2");
    const hi = g.highest(x, p.length), lo = g.lowest(x, p.length);
    // value = clamp(0.66 (pos - 0.5) + 0.67 nz(value[1]), +-0.999); a flat window leaves it absent (Pine: division by zero is na)
    const value = g.node((s, a, b) => {
      const xv = x.v, h = hi.v, l = lo.v, v = s.v;
      for (let i = a; i < b; i++) {
        const h1 = h[i]!, l1 = l[i]!;
        if (!(h1 > l1)) { v[i] = NaN_; continue; }
        const prev = i > 0 && v[i - 1]! === v[i - 1]! ? v[i - 1]! : 0;
        const r = 0.66 * ((xv[i]! - l1) / (h1 - l1) - 0.5) + 0.67 * prev;
        v[i] = r > 0.99 ? 0.999 : r < -0.99 ? -0.999 : r;
      }
    });
    const fish = g.node((s, a, b) => {
      const val = value.v, v = s.v;
      for (let i = a; i < b; i++) {
        const q = val[i]!;
        if (q !== q) { v[i] = NaN_; continue; }
        const prev = i > 0 && v[i - 1]! === v[i - 1]! ? v[i - 1]! : 0;
        v[i] = 0.5 * Math.log((1 + q) / (1 - q)) + 0.5 * prev;
      }
    });
    return [fish, g.lag(fish, 1)];
  },
  reference: "TradingView 'Fisher Transform' (Pine v5): value = round(0.66 ((hl2 - lowest) / (highest - lowest) - 0.5) + 0.67 nz(value[1])), fish = 0.5 ln((1 + value) / (1 - value)) + 0.5 nz(fish[1]); trigger = fish[1]",
});

// ---- Know Sure Thing --------------------------------------------------------

export const kst = defineStudy({
  id: "kst", name: "Know Sure Thing", family: "tv", needs: "value", pane: "new",
  inputs: [
    int("roc1", 10, 1, 5000), int("roc2", 15, 1, 5000), int("roc3", 20, 1, 5000), int("roc4", 30, 1, 5000),
    int("sma1", 10, 1, 5000), int("sma2", 10, 1, 5000), int("sma3", 10, 1, 5000), int("sma4", 15, 1, 5000),
    int("signal", 9, 1, 5000), source(),
  ],
  columns: ["kst", "signal"],
  plots: [line("kst", COLORS.green), line("signal", COLORS.red), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.roc1} ${p.roc2} ${p.roc3} ${p.roc4} ${p.sma1} ${p.sma2} ${p.sma3} ${p.sma4} ${p.signal}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const parts = [1, 2, 3, 4].map((k) => g.sma(roc(g, x, p[`roc${k}`]), p[`sma${k}`]));
    const k = g.calc((i) => parts[0]!.v[i]! + 2 * parts[1]!.v[i]! + 3 * parts[2]!.v[i]! + 4 * parts[3]!.v[i]!);
    return [k, g.sma(k, p.signal)];
  },
  reference: "TradingView 'Know Sure Thing': kst = sma(roc(c,10),10) + 2 sma(roc(c,15),10) + 3 sma(roc(c,20),10) + 4 sma(roc(c,30),15); signal = sma(kst, 9)",
});

// ---- True Strength Index ----------------------------------------------------

export const tsi = defineStudy({
  id: "tsi", name: "True Strength Index", family: "tv", needs: "value", pane: "new",
  inputs: [int("long", 25, 1, 5000), int("short", 13, 1, 5000), int("signal", 13, 1, 5000), source()],
  columns: ["tsi", "signal"],
  plots: [line("tsi", COLORS.neutral), line("signal", COLORS.orange), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.long} ${p.short} ${p.signal}`,
  build: (g, p) => {
    const pc = g.change(g.src(p.source), 1);
    const num = doubleEma(g, pc, p.long, p.short);
    const den = doubleEma(g, g.abs(pc), p.long, p.short);
    const t = g.mul(g.div(num, den), 100);
    return [t, g.ema(t, p.signal)];
  },
  reference: "TradingView 'True Strength Index' (Pine v5): 100 ema(ema(change(src), long), short) / ema(ema(abs(change(src)), long), short); signal = ema(tsi, 13)",
});

// ---- Vortex Indicator -------------------------------------------------------

export const vortex = defineStudy({
  id: "vortex", name: "Vortex Indicator", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 2, 5000)], columns: ["viPlus", "viMinus"],
  plots: [line("viPlus", COLORS.neutral, { title: "VI+" }), line("viMinus", COLORS.orange, { title: "VI-" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const { high, low } = g;
    const vmp = g.calc((i) => (i >= 1 ? Math.abs(high.v[i]! - low.v[i - 1]!) : NaN_));
    const vmm = g.calc((i) => (i >= 1 ? Math.abs(low.v[i]! - high.v[i - 1]!) : NaN_));
    const str = g.sum(trFirstBar(g), p.length);
    return [g.div(g.sum(vmp, p.length), str), g.div(g.sum(vmm, p.length), str)];
  },
  reference: "TradingView 'Vortex Indicator' (Pine v5): VI+ = sum(|high - low[1]|, n) / sum(atr(1), n); VI- = sum(|low - high[1]|, n) / sum(atr(1), n)",
});

// ---- Coppock Curve ----------------------------------------------------------

export const coppock = defineStudy({
  id: "coppock", name: "Coppock Curve", family: "tv", needs: "value", pane: "new",
  inputs: [int("length", 10, 1, 5000, "WMA length"), int("longRoc", 14, 1, 5000, "Long ROC length"), int("shortRoc", 11, 1, 5000, "Short ROC length"), source()],
  columns: ["coppock"],
  plots: [line("coppock", COLORS.neutral), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length} ${p.longRoc} ${p.shortRoc}`,
  build: (g, p) => {
    const x = g.src(p.source);
    return [g.wma(g.add(roc(g, x, p.longRoc), roc(g, x, p.shortRoc)), p.length)];
  },
  reference: "TradingView 'Coppock Curve' (Pine v5): wma(roc(src, 14) + roc(src, 11), 10)",
});

// ---- Connors RSI ------------------------------------------------------------

export const connorsRsi = defineStudy({
  id: "connors-rsi", name: "Connors RSI", family: "tv", needs: "value", pane: "new",
  inputs: [int("rsiLength", 3, 1, 5000), int("updownLength", 2, 1, 5000), int("rocLength", 100, 1, 5000), source()],
  columns: ["crsi"],
  plots: [line("crsi", COLORS.neutral), hline("upper", 70), hline("lower", 30), hline("middle", 50, COLORS.gray, "dotted")],
  label: (p) => `${p.rsiLength} ${p.updownLength} ${p.rocLength}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const rsi = rsiOf(g, x, p.rsiLength);
    // streak length: +1, +2.. while rising, -1, -2.. while falling, 0 when unchanged (the first bar has no streak)
    const ud = g.node((s, a, b) => {
      const xv = x.v, v = s.v;
      for (let i = a; i < b; i++) {
        if (i === 0 || xv[i]! !== xv[i]! || xv[i - 1]! !== xv[i - 1]!) { v[i] = NaN_; continue; }
        const prev = v[i - 1]! === v[i - 1]! ? v[i - 1]! : 0;
        const c = xv[i]!, q = xv[i - 1]!;
        v[i] = c === q ? 0 : c > q ? (prev <= 0 ? 1 : prev + 1) : prev >= 0 ? -1 : prev - 1;
      }
    });
    const udRsi = rsiOf(g, ud, p.updownLength);
    // Pine ta.percentrank(roc(src, 1), n): share of the previous n values <= the current one
    const r1 = roc(g, x, 1);
    const cnt = g.validRun(r1);
    const rank = g.node((s, a, b) => {
      const rv = r1.v, c = cnt.v, v = s.v;
      for (let i = a; i < b; i++) {
        if (c[i]! < p.rocLength + 1) { v[i] = NaN_; continue; }
        let k = 0;
        for (let j = 1; j <= p.rocLength; j++) if (rv[i - j]! <= rv[i]!) k++;
        v[i] = (100 * k) / p.rocLength;
      }
    });
    return [g.calc((i) => (rsi.v[i]! + udRsi.v[i]! + rank.v[i]!) / 3)];
  },
  reference: "TradingView 'Connors RSI' (Pine v5): avg(rsi(src, 3), rsi(updown streak, 2), percentrank(roc(src, 1), 100)); the first bar has no streak (absent)",
});

// ---- Choppiness Index -------------------------------------------------------

export const choppiness = defineStudy({
  id: "choppiness", name: "Choppiness Index", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 2, 5000)], columns: ["chop"],
  plots: [line("chop", COLORS.neutral), hline("upper", 61.8, COLORS.gray, "dashed"), hline("lower", 38.2, COLORS.gray, "dashed")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const atrSum = g.sum(trFirstBar(g), p.length);
    const range = g.sub(g.highest(g.high, p.length), g.lowest(g.low, p.length));
    const ratio = g.div(atrSum, range);
    const k = 100 / Math.log10(p.length);
    return [g.map(ratio, (r) => (r > 0 ? k * Math.log10(r) : NaN_))];
  },
  reference: "TradingView 'Choppiness Index' (Pine v5): 100 log10(sum(atr(1), n) / (highest(high, n) - lowest(low, n))) / log10(n)",
});

// ---- Relative Vigor Index ---------------------------------------------------

export const rviVigor = defineStudy({
  id: "rvi-vigor", name: "Relative Vigor Index", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 10, 1, 5000)], columns: ["rvi", "signal"],
  plots: [line("rvi", COLORS.green), line("signal", COLORS.red)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const num = g.sma(swma(g, g.sub(g.close, g.open)), p.length);
    const den = g.sma(swma(g, g.sub(g.high, g.low)), p.length);
    const rvi = g.div(num, den);
    return [rvi, swma(g, rvi)];
  },
  reference: "TradingView 'Relative Vigor Index' (Pine v5): rvi = sma(swma(close - open), n) / sma(swma(high - low), n); signal = swma(rvi)",
});

// ---- Relative Volatility Index ----------------------------------------------

export const rviVolatility = defineStudy({
  id: "rvi-volatility", name: "Relative Volatility Index", family: "tv", needs: "value", pane: "new",
  inputs: [int("length", 10, 2, 5000, "StdDev length"), int("smoothing", 14, 1, 5000), select("ma", "ema", ["ema", "rma"], "Smoothing"), source()],
  columns: ["rvi"],
  plots: [line("rvi", COLORS.purple), hline("upper", 80), hline("lower", 20), hline("middle", 50, COLORS.gray, "dotted")],
  label: (p) => `${p.length} ${p.smoothing}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const sd = g.stdev(x, p.length), ch = g.change(x, 1);
    // both legs are absent until the stdev exists, so their smoothing starts on the same bar
    const upIn = g.map2(ch, sd, (c, s) => (c !== c || s !== s ? NaN_ : c <= 0 ? 0 : s));
    const dnIn = g.map2(ch, sd, (c, s) => (c !== c || s !== s ? NaN_ : c > 0 ? 0 : s));
    const sm = (c: Col) => (p.ma === "rma" ? g.rma(c, p.smoothing) : g.ema(c, p.smoothing));
    const up = sm(upIn), dn = sm(dnIn);
    return [g.mul(g.div(up, g.add(up, dn)), 100)];
  },
  reference: "TradingView 'Relative Volatility Index' (Pine v5): upper = ema(change(src) <= 0 ? 0 : stdev(src, 10), 14), lower = ema(change(src) > 0 ? 0 : stdev, 14), rvi = 100 upper / (upper + lower); ma 'rma' gives Dorsey's Wilder form",
});

// ---- SMI Ergodic ------------------------------------------------------------

export const smiErgodic = defineStudy({
  id: "smi-ergodic", name: "SMI Ergodic Indicator/Oscillator", family: "tv", needs: "value", pane: "new",
  inputs: [int("longLength", 5, 1, 5000), int("shortLength", 20, 1, 5000), int("signal", 5, 1, 5000), source()],
  columns: ["erg", "signal", "osc"],
  plots: [hist("osc", COLORS.gray, COLORS.gray, { title: "Oscillator" }), line("erg", COLORS.neutral, { title: "SMI Ergodic" }), line("signal", COLORS.orange), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.longLength} ${p.shortLength} ${p.signal}`,
  build: (g, p) => {
    const pc = g.change(g.src(p.source), 1);
    const erg = g.mul(g.div(doubleEma(g, pc, p.longLength, p.shortLength), doubleEma(g, g.abs(pc), p.longLength, p.shortLength)), 100);
    const sig = g.ema(erg, p.signal);
    return [erg, sig, g.sub(erg, sig)];
  },
  reference: "TradingView 'SMI Ergodic Indicator/Oscillator' (Pine v5): erg = 100 ema(ema(change, long 5), short 20) / ema(ema(abs(change), 5), 20); signal = ema(erg, 5); oscillator = erg - signal",
});

// ---- Spearman rank correlation against time ---------------------------------

export const rankCorr = defineStudy({
  id: "rank-corr", name: "Rank Correlation vs Time", family: "tv", needs: "value", pane: "new",
  inputs: [int("length", 14, 2, 500), source()], columns: ["rho"],
  plots: [line("rho", COLORS.teal), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const cnt = g.validRun(x);
    const n: number = p.length;
    const m = (n + 1) / 2;
    const syy = (n * (n * n - 1)) / 12; // sum of squared deviations of the time ranks 1..n
    const rho = g.node((s, a, b) => {
      const xv = x.v, c = cnt.v, v = s.v;
      for (let i = a; i < b; i++) {
        if (c[i]! < n) { v[i] = NaN_; continue; }
        const o = i - n + 1;
        let sxy = 0, sxx = 0;
        for (let j = 0; j < n; j++) {
          const y = xv[o + j]!;
          let less = 0, eq = 0;
          for (let k = 0; k < n; k++) {
            const z = xv[o + k]!;
            if (z < y) less++;
            else if (z === y && k !== j) eq++;
          }
          const r = 1 + less + eq / 2; // tied values share the mean of their ranks
          sxy += (r - m) * (j + 1 - m);
          sxx += (r - m) * (r - m);
        }
        const den = Math.sqrt(sxx * syy);
        v[i] = den > 0 ? Math.max(-1, Math.min(1, sxy / den)) : NaN_;
      }
    });
    return [rho];
  },
  reference: "Spearman's rho of the source against the bar index over a rolling window (not a TradingView built-in): Pearson correlation of the ranks, tied source values take the mean rank; a window of all equal values is absent",
});

// ---- Elder Ray (Bull Bear Power) --------------------------------------------

export const bullBearPower = defineStudy({
  id: "bull-bear-power", name: "Bull Bear Power", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 13, 1, 5000), source()], columns: ["bull", "bear"],
  plots: [hist("bull", COLORS.green, COLORS.green, { title: "Bull Power" }), hist("bear", COLORS.red, COLORS.red, { title: "Bear Power" }), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const e = g.ema(g.src(p.source), p.length);
    return [g.sub(g.high, e), g.sub(g.low, e)];
  },
  reference: "Elder Ray (TradingView 'Bull Bear Power'): bull = high - ema(close, 13), bear = low - ema(close, 13)",
});

// ---- Awesome and Accelerator ------------------------------------------------

function aoOf(g: Graph, fast: number, slow: number): Node {
  const m = g.src("hl2");
  return g.sub(g.sma(m, fast), g.sma(m, slow));
}

export const awesome = defineStudy({
  id: "awesome", name: "Awesome Oscillator", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("fast", 5, 1, 5000), int("slow", 34, 2, 5000)], columns: ["ao", "up", "down"],
  plots: [hist("up", COLORS.green, undefined, { title: "AO rising" }), hist("down", COLORS.red, undefined, { title: "AO falling" })],
  label: () => "",
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`awesome: fast (${p.fast}) must be below slow (${p.slow})`);
    const ao = aoOf(g, p.fast, p.slow);
    const { up, down } = risingFalling(g, ao);
    return [ao, up, down];
  },
  reference: "TradingView 'Awesome Oscillator': sma(hl2, 5) - sma(hl2, 34); bar green when above the previous bar's value, red otherwise",
});

export const accelerator = defineStudy({
  id: "accelerator", name: "Accelerator Oscillator", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("fast", 5, 1, 5000), int("slow", 34, 2, 5000), int("signal", 5, 1, 5000)], columns: ["ac", "up", "down"],
  plots: [hist("up", COLORS.green, undefined, { title: "AC rising" }), hist("down", COLORS.red, undefined, { title: "AC falling" })],
  label: () => "",
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`accelerator: fast (${p.fast}) must be below slow (${p.slow})`);
    const ao = aoOf(g, p.fast, p.slow);
    const ac = g.sub(ao, g.sma(ao, p.signal));
    const { up, down } = risingFalling(g, ac);
    return [ac, up, down];
  },
  reference: "Bill Williams / TradingView 'Accelerator Oscillator': AO - sma(AO, 5); bar green when above the previous bar's value, red otherwise",
});

// ---- Mass Index -------------------------------------------------------------

export const massIndex = defineStudy({
  id: "mass-index", name: "Mass Index", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("length", 10, 1, 5000, "Sum length"), int("emaLength", 9, 1, 5000)], columns: ["mi"],
  plots: [line("mi", COLORS.neutral)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const e1 = g.ema(g.sub(g.high, g.low), p.emaLength);
    const e2 = g.ema(e1, p.emaLength);
    return [g.sum(g.div(e1, e2), p.length)];
  },
  reference: "TradingView 'Mass Index' (Pine v5): sum(ema(high - low, 9) / ema(ema(high - low, 9), 9), length), length 10 (Dorsey's 25 via the input)",
});

// ---- Detrended Price Oscillator ---------------------------------------------

export const dpo = defineStudy({
  id: "dpo", name: "Detrended Price Oscillator", family: "tv", needs: "value", pane: "new",
  inputs: [int("length", 21, 1, 5000), bool("centered", false), source()], columns: ["dpo"],
  plots: [line("dpo", COLORS.teal), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const back = Math.floor(p.length / 2) + 1;
    const ma = g.sma(x, p.length);
    const out = p.centered
      ? g.calc((i) => (i >= back ? x.v[i - back]! - ma.v[i]! : NaN_))
      : g.calc((i) => (i >= back ? x.v[i]! - ma.v[i - back]! : NaN_));
    return [out];
  },
  reference: "TradingView 'Detrended Price Oscillator' (Pine v5): barsback = floor(n/2) + 1; dpo = src - sma(src, n)[barsback]; centered: src[barsback] - sma(src, n), which TradingView draws shifted back by barsback bars (here the value stays on the bar that computes it)",
});

// ---- Schaff Trend Cycle -----------------------------------------------------

export const schaffTc = defineStudy({
  id: "schaff-tc", name: "Schaff Trend Cycle", family: "tv", needs: "value", pane: "new",
  inputs: [int("fast", 23, 1, 5000), int("slow", 50, 2, 5000), int("cycle", 10, 2, 5000), int("d1", 3, 1, 5000), int("d2", 3, 1, 5000), source()], columns: ["stc"],
  plots: [line("stc", COLORS.neutral), hline("upper", 75), hline("lower", 25)],
  label: (p) => `${p.fast} ${p.slow} ${p.cycle}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const macd = g.sub(g.ema(x, p.fast), g.ema(x, p.slow));
    const d = g.ema(stochOf(g, macd, p.cycle), p.d1);
    const stc = g.ema(stochOf(g, d, p.cycle), p.d2);
    return [g.map(stc, (v) => (v > 100 ? 100 : v < 0 ? 0 : v))];
  },
  reference: "TradingView 'Schaff Trend Cycle' (reproduced from the published script, not fetched): macd = ema(src,23) - ema(src,50); k = stoch(macd,10); d = ema(k,3); kd = stoch(d,10); stc = clamp(ema(kd,3), 0, 100); a flat range carries the last stoch (fixnan) and warm-up stays absent instead of nz-ed to 0",
});

// ---- TradingView Stochastic -------------------------------------------------

export const stochTv = defineStudy({
  id: "stoch-tv", name: "Stochastic", family: "tv", needs: "ohlc", pane: "new",
  inputs: [int("kLength", 14, 1, 5000, "%K length"), int("kSmooth", 1, 1, 5000, "%K smoothing"), int("dLength", 3, 1, 5000, "%D smoothing")], columns: ["k", "d"],
  plots: [line("k", COLORS.neutral, { title: "%K" }), line("d", COLORS.orange, { title: "%D" }), hline("upper", 80), hline("lower", 20), hline("middle", 50, COLORS.gray, "dotted")],
  label: (p) => `${p.kLength} ${p.kSmooth} ${p.dLength}`,
  build: (g, p) => {
    const hh = g.highest(g.high, p.kLength), ll = g.lowest(g.low, p.kLength);
    const raw = g.mul(g.div(g.sub(g.close, ll), g.sub(hh, ll)), 100);
    const k = g.sma(raw, p.kSmooth);
    return [k, g.sma(k, p.dLength)];
  },
  reference: "TradingView 'Stochastic' (Pine v5): k = sma(stoch(close, high, low, 14), 1), d = sma(k, 3); TA-Lib STOCH with fastk 14 / slowk sma 1 / slowd sma 3 (TA-Lib gives 0 on a flat range, here it is absent)",
});
