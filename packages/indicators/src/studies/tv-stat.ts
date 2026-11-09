// Studies whose definitions are published and unambiguous, added to match TradingView's built-in list: Chaikin Volatility,
// Standard Error, Ulcer Index, Stochastic Momentum Index, Trend Strength Index and a relative volume. Each cites the definition
// it implements. Shared deviation (as in tv-osc.ts): `ema` seeds with the simple mean of the first `length` values; Pine's ta.ema
// seeds with the first value, and the two converge geometrically.

import { COLORS, defineStudy, hline, int, line, markers, source } from "../define.js";

const NaN_ = Number.NaN;

export const chaikinVol = defineStudy({
  id: "chaikin-vol", name: "Chaikin Volatility", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [int("length", 10, 1, 5000), int("rocLength", 10, 1, 5000, "ROC length")], columns: ["cv"],
  plots: [line("cv", COLORS.neutral, { title: "CV" }), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}, ${p.rocLength}`,
  build: (g, p) => {
    const e = g.ema(g.sub(g.high, g.low), p.length);
    const n = p.rocLength as number;
    return [g.calc((i) => (i >= n && e.v[i - n] !== 0 ? (100 * (e.v[i]! - e.v[i - n]!)) / e.v[i - n]! : NaN_))];
  },
  reference: "Chaikin Volatility: 100 * (EMA(high - low, length) - EMA(high - low, length)[rocLength]) / EMA(high - low, length)[rocLength]; TradingView defaults 10 and 10.",
});

export const stdError = defineStudy({
  id: "std-error", name: "Standard Error", family: "statistic", needs: "value", pane: "new",
  inputs: [int("length", 21, 3, 5000)], columns: ["se"],
  plots: [line("se", COLORS.orange, { title: "SE" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const n = p.length as number;
    const c = g.close;
    const { slope, intercept } = g.linreg(c, n);
    return [g.calc((i) => {
      const m = slope.v[i]!, b = intercept.v[i]!;
      if (m !== m || b !== b) return NaN_;
      let ss = 0;
      for (let j = 0; j < n; j++) {
        const r = c.v[i - n + 1 + j]! - (b + m * j);
        ss += r * r;
      }
      return Math.sqrt(ss / (n - 2));
    })];
  },
  reference: "Standard error of the least-squares line through the last `length` closes: sqrt(sum of squared residuals / (length - 2)).",
});

export const ulcerIndex = defineStudy({
  id: "ulcer-index", name: "Ulcer Index", family: "volatility", needs: "value", pane: "new",
  inputs: [int("length", 14, 1, 5000)], columns: ["ui"],
  plots: [line("ui", COLORS.orange, { title: "UI" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const c = g.close;
    const hi = g.highest(c, p.length);
    const dd = g.calc((i) => (hi.v[i]! > 0 ? (100 * (c.v[i]! - hi.v[i]!)) / hi.v[i]! : NaN_));
    return [g.map(g.sma(g.map(dd, (x) => x * x), p.length), Math.sqrt)];
  },
  reference: "Ulcer Index (Martin): drawdown = 100 (close - highest close of the last length bars) / that highest close; UI = sqrt(SMA(drawdown^2, length)). Needs positive closes. The first value is on bar 2 * length - 1.",
});

export const smi = defineStudy({
  id: "smi", name: "Stochastic Momentum Index", family: "momentum", needs: "ohlc", pane: "new",
  inputs: [int("lengthK", 10, 1, 5000, "%K length"), int("lengthD", 3, 1, 5000, "%D length"), int("lengthEma", 3, 1, 5000, "EMA length")], columns: ["smi", "signal"],
  plots: [line("smi", COLORS.neutral, { title: "SMI" }), line("signal", COLORS.orange, { title: "EMA" }), hline("upper", 40, COLORS.gray), hline("lower", -40, COLORS.gray)],
  label: (p) => `${p.lengthK}, ${p.lengthD}, ${p.lengthEma}`,
  build: (g, p) => {
    const hh = g.highest(g.high, p.lengthK), ll = g.lowest(g.low, p.lengthK);
    const rel = g.calc((i) => g.close.v[i]! - (hh.v[i]! + ll.v[i]!) / 2);
    const span = g.sub(hh, ll);
    const d1 = g.ema(g.ema(rel, p.lengthD), p.lengthD), d2 = g.ema(g.ema(span, p.lengthD), p.lengthD);
    const v = g.map2(d1, d2, (a, b) => (b === 0 ? NaN_ : (200 * a) / b));
    return [v, g.ema(v, p.lengthEma)];
  },
  reference: "Blau's Stochastic Momentum Index as TradingView implements it: SMI = 200 * EMA(EMA(close - (HH + LL) / 2, D), D) / EMA(EMA(HH - LL, D), D) over lengthK bars; signal = EMA(SMI, lengthEma). Defaults 10, 3, 3.",
});

export const trendStrength = defineStudy({
  id: "trend-strength", name: "Trend Strength Index", family: "statistic", needs: "value", pane: "new",
  inputs: [int("length", 14, 2, 5000)], columns: ["tsi"],
  plots: [line("tsi", COLORS.teal, { title: "TSI" }), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const n = p.length as number, c = g.close;
    const mx = (n - 1) / 2, sxx = (n * (n * n - 1)) / 12; // sum of (j - mean j)^2 over j = 0..n-1
    return [g.calc((i) => {
      if (i < n - 1) return NaN_;
      let sy = 0;
      for (let j = 0; j < n; j++) sy += c.v[i - n + 1 + j]!;
      const my = sy / n;
      let sxy = 0, syy = 0;
      for (let j = 0; j < n; j++) {
        const dy = c.v[i - n + 1 + j]! - my;
        sxy += (j - mx) * dy;
        syy += dy * dy;
      }
      return syy === 0 ? NaN_ : sxy / Math.sqrt(sxx * syy);
    })];
  },
  reference: "Trend Strength Index: the Pearson correlation of the closes of the last `length` bars with their bar position (ta.correlation(close, bar_index, length)); +1 a straight rise, -1 a straight fall. Default 14.",
});

export const rvol = defineStudy({
  id: "rvol", name: "Relative Volume", family: "volume", needs: "ohlcv", pane: "new",
  inputs: [int("length", 20, 1, 5000)], columns: ["rvol"],
  plots: [line("rvol", COLORS.purple, { title: "RVOL" }), hline("one", 1, COLORS.gray, "dotted")],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.div(g.volume, g.sma(g.volume, p.length))],
  reference: "Volume divided by the simple average of the last `length` bars' volume (the bar included). This is the ratio to a plain moving average, not a same-time-of-day comparison.",
});

// ---- Hamming moving average -------------------------------------------------------

/** Hamming window weights w_k = 0.54 - 0.46 cos(2 pi k / (n - 1)), k = 0..n-1, normalised to sum to 1 (n >= 2). */
export function hammingWeights(n: number): Float64Array {
  if (!Number.isInteger(n) || n < 2) throw new RangeError(`hammingWeights: length must be an integer >= 2, got ${n}`);
  const w = new Float64Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) { w[k] = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (n - 1)); sum += w[k]!; }
  for (let k = 0; k < n; k++) w[k]! /= sum;
  return w;
}

export const hammingMa = defineStudy({
  id: "hamming-ma", name: "Hamming Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [int("length", 20, 2, 5000), source()], columns: ["hamming"],
  plots: [line("hamming", COLORS.teal, { title: "Hamming MA" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const n = p.length as number, w = hammingWeights(n), x = g.src(p.source);
    return [g.calc((i) => {
      if (i < n - 1) return NaN_;
      let acc = 0;
      for (let k = 0; k < n; k++) acc += w[k]! * x.v[i - n + 1 + k]!;
      return acc;
    })];
  },
  reference: "A finite-impulse-response average with Hamming window weights 0.54 - 0.46 cos(2 pi k / (length - 1)) over the last `length` values (k = 0 the oldest), normalised to sum to 1. The standard signal-processing window; TradingView does not publish its own definition, so this is not claimed to match a TradingView script bar for bar.",
});

// ---- volatility estimators (annualised, in percent) --------------------------------

const ANNUAL = int("annual", 252, 1, 10_000, "Periods per year");

/** Close-to-close: the sample standard deviation (n - 1) of log returns. */
export const closeToCloseVol = defineStudy({
  id: "vol-close-to-close", name: "Volatility Close-to-Close", family: "volatility", needs: "value", pane: "new",
  inputs: [int("length", 10, 2, 5000), ANNUAL], columns: ["vol"],
  plots: [line("vol", COLORS.neutral, { title: "Vol" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const c = g.close, n = p.length as number, k = 100 * Math.sqrt(p.annual as number);
    const r = g.calc((i) => (i === 0 ? NaN_ : Math.log(c.v[i]! / c.v[i - 1]!)));
    return [g.map(g.stdev(r, n, true), (s) => s * k)];
  },
  reference: "100 * sqrt(annual) * sample standard deviation (divisor length - 1) of ln(close / close[1]) over `length` returns. hist-vol is the population (divisor length) version.",
});

/** Zero-trend close-to-close: the root mean square of log returns (the mean return is not removed). */
export const zeroTrendVol = defineStudy({
  id: "vol-zero-trend", name: "Volatility Zero Trend Close-to-Close", family: "volatility", needs: "value", pane: "new",
  inputs: [int("length", 10, 1, 5000), ANNUAL], columns: ["vol"],
  plots: [line("vol", COLORS.orange, { title: "Vol" })],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const c = g.close, k = 100 * Math.sqrt(p.annual as number);
    const r2 = g.calc((i) => (i === 0 ? NaN_ : Math.log(c.v[i]! / c.v[i - 1]!) ** 2));
    return [g.map(g.sma(r2, p.length), (m) => Math.sqrt(m) * k)];
  },
  reference: "100 * sqrt(annual) * sqrt(mean of ln(close / close[1])^2 over `length` returns): the close-to-close estimator with the mean return taken as zero.",
});

function rangeVol(id: string, name: string, color: string, term: (o: number, h: number, l: number, c: number) => number, reference: string) {
  return defineStudy({
    id, name, family: "volatility", needs: "ohlc", pane: "new",
    inputs: [int("length", 10, 1, 5000), ANNUAL], columns: ["vol"],
    plots: [line("vol", color, { title: "Vol" })],
    label: (p) => `${p.length}`,
    build: (g, p) => {
      const k = 100 * Math.sqrt(p.annual as number);
      const t = g.calc((i) => term(g.open.v[i]!, g.high.v[i]!, g.low.v[i]!, g.close.v[i]!));
      return [g.map(g.sma(t, p.length), (m) => (m >= 0 ? Math.sqrt(m) * k : NaN_))];
    },
    reference,
  });
}

export const parkinsonVol = rangeVol("vol-parkinson", "Parkinson Volatility", COLORS.green, (_o, h, l) => Math.log(h / l) ** 2 / (4 * Math.LN2),
  "100 * sqrt(annual) * sqrt(mean of ln(high / low)^2 / (4 ln 2)) (Parkinson 1980); assumes zero drift and no gaps.");
export const garmanKlassVol = rangeVol("vol-garman-klass", "Garman-Klass Volatility", COLORS.purple, (o, h, l, c) => 0.5 * Math.log(h / l) ** 2 - (2 * Math.LN2 - 1) * Math.log(c / o) ** 2,
  "100 * sqrt(annual) * sqrt(mean of 0.5 ln(high / low)^2 - (2 ln 2 - 1) ln(close / open)^2) (Garman and Klass 1980); assumes zero drift and no gaps.");
export const rogersSatchellVol = rangeVol("vol-rogers-satchell", "Rogers-Satchell Volatility", COLORS.red, (o, h, l, c) => Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o),
  "100 * sqrt(annual) * sqrt(mean of ln(high / close) ln(high / open) + ln(low / close) ln(low / open)) (Rogers and Satchell 1991); allows drift.");


export const volume24h = defineStudy({
  id: "volume-24h", name: "24-hour Volume", family: "volume", needs: "ohlcv", pane: "new",
  inputs: [], columns: ["vol24"],
  plots: [line("vol24", COLORS.neutral, { title: "24h volume" })],
  build: (g) => {
    const DAY = 86_400_000;
    // cumulative volume, then cum[i] - cum[j] where j is the last bar at or before t - 24h (binary search: the window is (t - 24h, t])
    const cum = g.node((s, a, b) => {
      const vol = g.volume.v, v = s.v;
      for (let i = a; i < b; i++) v[i] = (i > 0 ? v[i - 1]! : 0) + vol[i]!;
    });
    return [g.node((s, a, b) => {
      const t = g.time.v, c = cum.v, v = s.v;
      for (let i = a; i < b; i++) {
        let lo = 0, hi = i; // first index whose time is > t[i] - DAY
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (t[mid]! > t[i]! - DAY) hi = mid; else lo = mid + 1;
        }
        v[i] = c[i]! - (lo > 0 ? c[lo - 1]! : 0);
      }
    })];
  },
  reference: "The sum of volume over the bars whose time is within the last 24 hours (time - 24h, time]. Meaningful on a market that trades around the clock; on an exchange with sessions it spans the gap.",
});

// ---- moving-average families ---------------------------------------------------------

const GUPPY_SHORT = [3, 5, 8, 10, 12, 15], GUPPY_LONG = [30, 35, 40, 45, 50, 60];

export const guppy = defineStudy({
  id: "guppy", name: "Guppy Multiple Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [source()],
  columns: [...GUPPY_SHORT.map((n) => `s${n}`), ...GUPPY_LONG.map((n) => `l${n}`)],
  plots: [...GUPPY_SHORT.map((n) => line(`s${n}`, COLORS.neutral, { title: `EMA ${n}`, width: 1 })), ...GUPPY_LONG.map((n) => line(`l${n}`, COLORS.orange, { title: `EMA ${n}`, width: 1 }))],
  build: (g, p) => {
    const x = g.src(p.source);
    return [...GUPPY_SHORT, ...GUPPY_LONG].map((n) => g.ema(x, n));
  },
  reference: "Guppy Multiple Moving Average (Daryl Guppy): two groups of six exponential averages, the short group of 3, 5, 8, 10, 12 and 15 bars and the long group of 30, 35, 40, 45, 50 and 60 bars.",
});

export const maEmaCross = defineStudy({
  id: "ma-ema-cross", name: "MA with EMA Cross", family: "overlap", needs: "value", pane: "overlay",
  inputs: [int("maLength", 9, 1, 5000, "MA length"), int("emaLength", 21, 1, 5000, "EMA length"), source()],
  columns: ["ma", "ema", "crossUp", "crossDown"],
  plots: [
    line("ma", COLORS.neutral, { title: "MA" }), line("ema", COLORS.orange, { title: "EMA" }),
    markers("crossUp", "circle", "value", COLORS.green, { title: "Cross up" }), markers("crossDown", "circle", "value", COLORS.red, { title: "Cross down" }),
  ],
  label: (p) => `${p.maLength}, ${p.emaLength}`,
  build: (g, p) => {
    const x = g.src(p.source), m = g.sma(x, p.maLength), e = g.ema(x, p.emaLength);
    const up = g.calc((i) => (i > 0 && m.v[i]! > e.v[i]! && m.v[i - 1]! <= e.v[i - 1]! ? m.v[i]! : NaN_));
    const dn = g.calc((i) => (i > 0 && m.v[i]! < e.v[i]! && m.v[i - 1]! >= e.v[i - 1]! ? m.v[i]! : NaN_));
    return [m, e, up, dn];
  },
  reference: "A simple moving average and an exponential one of the same source; circles where the simple average crosses over or under the exponential one (ta.crossover / ta.crossunder(ma, ema)).",
});

export const maChannel = defineStudy({
  id: "ma-channel", name: "Moving Average Channel", family: "overlap", needs: "ohlc", pane: "overlay",
  inputs: [int("length", 20, 1, 5000)], columns: ["upper", "basis", "lower"],
  plots: [line("upper", COLORS.neutral, { title: "Upper" }), line("basis", COLORS.orange, { title: "Basis" }), line("lower", COLORS.neutral, { title: "Lower" })],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.sma(g.high, p.length), g.sma(g.close, p.length), g.sma(g.low, p.length)],
  reference: "A channel of simple averages: the upper line is the SMA of the highs, the lower the SMA of the lows, and the basis the SMA of the closes.",
});
