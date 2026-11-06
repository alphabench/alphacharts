// TradingView trend studies: moving averages, bands and channels, Ichimoku,
// Supertrend, Alligator, Fractals and ZigZag. The specification of each study is
// TradingView's built-in definition with its default parameters (Pine v5 `ta.*`
// semantics); each `reference` names the definition implemented.
//
// Two conventions that differ from TA-Lib and matter for exact values:
// - ATR is Wilder's (Pine's `ta.atr` is `ta.rma(ta.tr(true), n)`): the first
//   bar's true range is high - low, so it is seeded one bar earlier than TA-Lib's ATR. `g.atr`.
// - `offset` on a plot is a pure display shift; every column holds the
//   undisplaced value of the bar it was computed on.
//
// ZigZag (algorithm written here; TradingView's ZigZag is a drawing tool with no
// closed-form definition): see the header above `zigzag`.

import { COLORS, band, bool, defineStudy, fillBetween, float, int, line, markers, select, source } from "../define.js";
import type { Col, Graph, Node } from "../engine/graph.js";
import type { PlotDef } from "../types.js";

const NaN_ = Number.NaN;
const len = (def: number, min = 1) => int("length", def, min, 5000);
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/**
 * Least-squares line over the last p bars against x = 0..p-1 (oldest..newest): `value` at the newest bar, `slope`
 * per bar, `intercept` at the oldest. Local because Graph.linreg (x increasing with the divisor of TA-Lib's reversed
 * x) returns a negated slope and a wrong intercept/value for any series that is not flat.
 */
function linregFit(g: Graph, x: Col, p: number): { value: Node; slope: Col; intercept: Col } {
  if (!Number.isInteger(p) || p < 2) throw new RangeError(`linreg: period must be an integer >= 2, got ${p}`);
  const cnt = g.validRun(x);
  const sumX = (p * (p - 1)) / 2, sumXSqr = (p * (p - 1) * (2 * p - 1)) / 6;
  const div = p * sumXSqr - sumX * sumX;
  const slope = g.col(), icpt = g.col();
  const value = g.node((s, a, b) => {
    const xv = x.v, c = cnt.v, sl = slope.v, ic = icpt.v, v = s.v;
    for (let i = a; i < b; i++) {
      if (c[i]! < p) { sl[i] = NaN_; ic[i] = NaN_; v[i] = NaN_; continue; }
      let sy = 0, sxy = 0;
      for (let j = 0; j < p; j++) { const y = xv[i - p + 1 + j]!; sy += y; sxy += j * y; }
      const m = (p * sxy - sumX * sy) / div, bb = (sy - m * sumX) / p;
      sl[i] = m; ic[i] = bb; v[i] = bb + m * (p - 1);
    }
  });
  return { value, slope, intercept: icpt };
}

const maOf = (g: Graph, type: string, x: Col, n: number): Node => (type === "ema" ? g.ema(x, n) : g.sma(x, n));

// ---- moving averages -----------------------------------------------------------

export const smma = defineStudy({
  id: "smma", name: "Smoothed Moving Average", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(7), source()], columns: ["smma"], plots: [line("smma", COLORS.teal)],
  label: (p) => `${p.length}`,
  // Pine's smma: first value = sma(src, n), then (smma[1] * (n - 1) + src) / n, which is Wilder's RMA.
  build: (g, p) => [g.rma(g.src(p.source), p.length)],
  reference: "TradingView Smoothed Moving Average: smma := na(smma[1]) ? ta.sma(src, n) : (smma[1] * (n - 1) + src) / n",
});

export const vwma = defineStudy({
  id: "vwma", name: "Volume Weighted Moving Average", family: "tv", needs: "ohlcv", pane: "overlay",
  inputs: [len(20), source()], columns: ["vwma"], plots: [line("vwma", COLORS.purple)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.div(g.sum(g.mul(g.src(p.source), g.volume), p.length), g.sum(g.volume, p.length))],
  reference: "Pine ta.vwma(src, n) = ta.sma(src * volume, n) / ta.sma(volume, n)",
});

export const hma = defineStudy({
  id: "hma", name: "Hull Moving Average", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(9, 2), source()], columns: ["hma"], plots: [line("hma", COLORS.pink)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const half = Math.floor(p.length / 2), root = Math.round(Math.sqrt(p.length));
    const raw = g.map2(g.wma(x, half), g.wma(x, p.length), (a, b) => 2 * a - b);
    return [g.wma(raw, root)];
  },
  reference: "Pine ta.hma(src, n) = ta.wma(2 * ta.wma(src, n / 2) - ta.wma(src, n), round(sqrt(n))), with n / 2 truncated to an int",
});

export const alma = defineStudy({
  id: "alma", name: "Arnaud Legoux Moving Average", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(9), float("offset", 0.85, 0, 1, 0.05), float("sigma", 6, 0.1, 100, 0.5), source()],
  columns: ["alma"], plots: [line("alma", COLORS.blue)],
  label: (p) => `${p.length}, ${p.offset}, ${p.sigma}`,
  build: (g, p) => {
    const n: number = p.length;
    const m = Math.floor(p.offset * (n - 1)), s = n / p.sigma;
    const w = new Float64Array(n);
    let norm = 0;
    for (let k = 0; k < n; k++) { w[k] = Math.exp(-((k - m) ** 2) / (2 * s * s)); norm += w[k]!; }
    const x = g.src(p.source), cnt = g.validRun(x);
    return [g.node((nd, a, b) => {
      const xv = x.v, c = cnt.v, v = nd.v;
      for (let i = a; i < b; i++) {
        if (c[i]! < n) { v[i] = NaN_; continue; }
        // weight k belongs to the bar n-1-k bars back from the newest: k = n-1 is the newest bar
        let t = 0;
        for (let k = 0; k < n; k++) t += xv[i - n + 1 + k]! * w[k]!;
        v[i] = t / norm;
      }
    })];
  },
  reference: "Pine ta.alma(src, n, offset, sigma): m = floor(offset * (n - 1)), s = n / sigma, w_k = exp(-(k - m)^2 / (2 s^2)), sum(src[n-1-k] * w_k) / sum(w_k)",
});

export const lsma = defineStudy({
  id: "lsma", name: "Least Squares Moving Average", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(25, 2), int("offset", 0, -5000, 5000), source()], columns: ["lsma"], plots: [line("lsma", COLORS.orange)],
  label: (p) => `${p.length}, ${p.offset}`,
  build: (g, p) => {
    const r = linregFit(g, g.src(p.source), p.length);
    // Pine ta.linreg(src, n, offset) = intercept + slope * (n - 1 - offset)
    return [g.map2(r.value, r.slope, (v, s) => v - p.offset * s)];
  },
  reference: "TradingView Least Squares Moving Average = Pine ta.linreg(src, n, offset); offset 0 equals TA-Lib LINEARREG",
});

export const mcginley = defineStudy({
  id: "mcginley", name: "McGinley Dynamic", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(14), source()], columns: ["mcginley"], plots: [line("mcginley", COLORS.green)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const n: number = p.length;
    const x = g.src(p.source), e = g.ema(x, n);
    return [g.node((nd, a, b) => {
      const xv = x.v, ev = e.v, v = nd.v;
      for (let i = a; i < b; i++) {
        const prev = i > 0 ? v[i - 1]! : NaN_;
        v[i] = prev !== prev ? ev[i]! : prev + (xv[i]! - prev) / (n * Math.pow(xv[i]! / prev, 4));
      }
    })];
  },
  reference: "TradingView McGinley Dynamic: mg := na(mg[1]) ? ta.ema(src, n) : mg[1] + (src - mg[1]) / (n * (src / mg[1])^4)",
});

const RIBBON_COLORS = [COLORS.blue, COLORS.teal, COLORS.green, COLORS.lime, COLORS.yellow, COLORS.orange, COLORS.red, COLORS.pink];
const RIBBON_COLS = RIBBON_COLORS.map((_, k) => `ma${k + 1}`);

export const maRibbon = defineStudy({
  id: "ma-ribbon", name: "Moving Average Ribbon", family: "tv", needs: "value", pane: "overlay",
  inputs: [int("first", 20, 1, 5000, "first"), int("step", 5, 1, 1000, "step"), source()],
  columns: RIBBON_COLS,
  plots: RIBBON_COLS.map((c, k) => line(c, RIBBON_COLORS[k]!, { title: `MA ${k + 1}`, width: 1 })),
  label: (p) => `${p.first}, ${p.step}`,
  build: (g, p) => {
    const last: number = p.first + 7 * p.step;
    if (last > 5000) throw new RangeError(`ma-ribbon: the 8th period ${last} exceeds 5000`);
    const x = g.src(p.source);
    return RIBBON_COLS.map((_, k) => g.sma(x, p.first + k * p.step));
  },
  reference: "Moving Average Ribbon: eight simple moving averages of periods first, first + step, ... first + 7 * step (default 20..55 step 5)",
});

export const maCross = defineStudy({
  id: "ma-cross", name: "Moving Average Cross", family: "tv", needs: "value", pane: "overlay",
  inputs: [select("type", "sma", ["sma", "ema"]), int("fast", 9, 1, 5000), int("slow", 21, 1, 5000), source()],
  columns: ["fast", "slow", "crossUp", "crossDown"],
  plots: [
    line("fast", COLORS.blue, { title: "Fast MA" }),
    line("slow", COLORS.orange, { title: "Slow MA" }),
    markers("crossUp", "circle", "value", COLORS.green, { title: "Cross up" }),
    markers("crossDown", "circle", "value", COLORS.red, { title: "Cross down" }),
  ],
  label: (p) => `${p.type}, ${p.fast}, ${p.slow}`,
  build: (g, p) => {
    const x = g.src(p.source), f = maOf(g, p.type, x, p.fast), s = maOf(g, p.type, x, p.slow);
    // marker value = the fast average on the bar where ta.crossover / ta.crossunder is true
    const up = g.calc((i) => (i > 0 && f.v[i]! > s.v[i]! && f.v[i - 1]! <= s.v[i - 1]! ? f.v[i]! : NaN_));
    const dn = g.calc((i) => (i > 0 && f.v[i]! < s.v[i]! && f.v[i - 1]! >= s.v[i - 1]! ? f.v[i]! : NaN_));
    return [f, s, up, dn];
  },
  reference: "TradingView Moving Average Cross: two moving averages, circles where ta.crossover / ta.crossunder(fast, slow) is true",
});

// ---- bands and channels ---------------------------------------------------------

export const envelopes = defineStudy({
  id: "envelopes", name: "Moving Average Envelopes", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(20), float("percent", 10, 0, 100, 0.5), select("basis", "sma", ["sma", "ema"]), source()],
  columns: ["basis", "upper", "lower"],
  plots: [line("basis", COLORS.orange, { title: "Basis" }), band("band", "upper", "lower", COLORS.blue, rgba(COLORS.blue, 0.08), "Envelope")],
  label: (p) => `${p.length}, ${p.percent}, ${p.basis}`,
  build: (g, p) => {
    const m = maOf(g, p.basis, g.src(p.source), p.length);
    const k: number = p.percent / 100;
    return [m, g.map(m, (v) => v * (1 + k)), g.map(m, (v) => v * (1 - k))];
  },
  reference: "TradingView Envelope: basis = sma|ema(src, n), upper = basis * (1 + percent / 100), lower = basis * (1 - percent / 100)",
});

export const keltner = defineStudy({
  id: "keltner", name: "Keltner Channels", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [len(20), float("mult", 2, 0, 100, 0.25), int("atrLength", 10, 1, 5000), bool("useEma", true), source()],
  columns: ["basis", "upper", "lower"],
  plots: [line("basis", COLORS.blue, { title: "Basis" }), band("band", "upper", "lower", COLORS.blue, rgba(COLORS.blue, 0.08), "Channel")],
  label: (p) => `${p.length}, ${p.mult}, ${p.atrLength}`,
  build: (g, p) => {
    const x = g.src(p.source);
    const m = p.useEma ? g.ema(x, p.length) : g.sma(x, p.length);
    const r = g.map(g.atr(p.atrLength), (v) => v * p.mult);
    return [m, g.add(m, r), g.sub(m, r)];
  },
  reference: "TradingView Keltner Channels (ATR band style): basis = ema|sma(src, n), bands = basis +- mult * ta.atr(atrLength)",
});

function channel(g: Graph, n: number): { upper: Node; lower: Node; mid: Node } {
  const upper = g.highest(g.high, n), lower = g.lowest(g.low, n);
  return { upper, lower, mid: g.map2(upper, lower, (a, b) => (a + b) / 2) };
}

export const donchian = defineStudy({
  id: "donchian", name: "Donchian Channels", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [len(20)], columns: ["upper", "lower", "basis"],
  plots: [band("band", "upper", "lower", COLORS.blue, rgba(COLORS.blue, 0.08), "Channel"), line("basis", COLORS.orange, { title: "Basis" })],
  label: (p) => `${p.length}`,
  build: (g, p) => { const c = channel(g, p.length); return [c.upper, c.lower, c.mid]; },
  reference: "TradingView Donchian Channels: upper = ta.highest(high, n), lower = ta.lowest(low, n), basis = (upper + lower) / 2; equals TA-Lib MAX(high), MIN(low), MIDPRICE",
});

export const priceChannel = defineStudy({
  id: "price-channel", name: "Price Channel", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [len(20)], columns: ["upper", "lower", "center"],
  plots: [line("upper", COLORS.green, { title: "Highest high" }), line("lower", COLORS.red, { title: "Lowest low" }), line("center", COLORS.gray, { title: "Center", style: "dashed" })],
  label: (p) => `${p.length}`,
  build: (g, p) => { const c = channel(g, p.length); return [c.upper, c.lower, c.mid]; },
  reference: "Price Channel: highest high and lowest low of the last n bars with their midline; equals TA-Lib MAX(high), MIN(low), MIDPRICE",
});

export const chandeKrollStop = defineStudy({
  id: "chande-kroll-stop", name: "Chande Kroll Stop", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [int("p", 10, 1, 5000), float("x", 1, 0, 100, 0.25), int("q", 9, 1, 5000)],
  columns: ["stopShort", "stopLong"],
  plots: [line("stopShort", COLORS.red, { title: "Stop short" }), line("stopLong", COLORS.green, { title: "Stop long" })],
  label: (p) => `${p.p}, ${p.x}, ${p.q}`,
  build: (g, p) => {
    const a = g.map(g.atr(p.p), (v) => v * p.x);
    const firstHigh = g.sub(g.highest(g.high, p.p), a), firstLow = g.add(g.lowest(g.low, p.p), a);
    return [g.highest(firstHigh, p.q), g.lowest(firstLow, p.q)];
  },
  reference: "TradingView Chande Kroll Stop: first_high = ta.highest(high, p) - x * ta.atr(p); first_low = ta.lowest(low, p) + x * ta.atr(p); stop_short = ta.highest(first_high, q); stop_long = ta.lowest(first_low, q)",
});

export const linregChannel = defineStudy({
  id: "linreg-channel", name: "Linear Regression Channel", family: "tv", needs: "value", pane: "overlay",
  inputs: [len(100, 2), float("upperDev", 2, 0, 100, 0.25), float("lowerDev", 2, 0, 100, 0.25), source()],
  columns: ["base", "upper", "lower"],
  plots: [line("base", COLORS.orange, { title: "Base" }), band("band", "upper", "lower", COLORS.blue, rgba(COLORS.blue, 0.08), "Channel")],
  label: (p) => `${p.length}, ${p.upperDev}, ${p.lowerDev}`,
  build: (g, p) => {
    const n: number = p.length;
    const x = g.src(p.source), r = linregFit(g, x, n);
    // population standard deviation of the residuals y_j - (intercept + slope * j) over the window
    const dev = g.node((s, a, b) => {
      const xv = x.v, sl = r.slope.v, ib = r.intercept.v, v = s.v;
      for (let i = a; i < b; i++) {
        const m = sl[i]!, c0 = ib[i]!;
        if (m !== m) { v[i] = NaN_; continue; }
        let t = 0;
        for (let j = 0; j < n; j++) { const e = xv[i - n + 1 + j]! - (c0 + m * j); t += e * e; }
        v[i] = Math.sqrt(t / n);
      }
    });
    return [r.value, g.map2(r.value, dev, (v, d) => v + p.upperDev * d), g.map2(r.value, dev, (v, d) => v - p.lowerDev * d)];
  },
  reference: "TradingView Linear Regression Channel: base = linear regression value at the newest bar over n bars (Pine ta.linreg(src, n, 0)), bands = base +- deviation * population stdev of the residuals. TradingView draws the tool as one anchored segment between two chosen bars; this study is the rolling per-bar form (each bar's own n-bar fit, newest point), not the anchored line.",
});

export const median = defineStudy({
  id: "median", name: "Median", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [len(3), int("atrLength", 14, 1, 5000), float("mult", 2, 0, 100, 0.25), source("hl2")],
  columns: ["median", "upper", "lower"],
  plots: [line("median", COLORS.blue, { title: "Median" }), band("band", "upper", "lower", COLORS.gray, rgba(COLORS.gray, 0.08), "ATR band")],
  label: (p) => `${p.length}, ${p.atrLength}, ${p.mult}`,
  build: (g, p) => {
    const n: number = p.length;
    const x = g.src(p.source), cnt = g.validRun(x);
    const med = g.node((s, a, b) => {
      const xv = x.v, c = cnt.v, v = s.v, w = new Float64Array(n);
      for (let i = a; i < b; i++) {
        if (c[i]! < n) { v[i] = NaN_; continue; }
        for (let j = 0; j < n; j++) w[j] = xv[i - n + 1 + j]!;
        w.sort();
        // even n: mean of the two middle values
        v[i] = n % 2 === 1 ? w[(n - 1) / 2]! : (w[n / 2 - 1]! + w[n / 2]!) / 2;
      }
    });
    const r = g.map(g.atr(p.atrLength), (v) => v * p.mult);
    return [med, g.add(med, r), g.sub(med, r)];
  },
  reference: "TradingView Median: rolling median of src (hl2) over n bars with an ATR band, median +- mult * ta.atr(atrLength). The band construction follows the task's definition; an even n takes the mean of the two middle values.",
});

// ---- Ichimoku -------------------------------------------------------------------

/** The Ichimoku displacement (TradingView's input default); plots shift by displacement - 1. */
const DISPLACEMENT = 26;

export const ichimoku = defineStudy({
  id: "ichimoku", name: "Ichimoku Cloud", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [int("conversion", 9, 1, 5000), int("base", 26, 1, 5000), int("spanB", 52, 1, 5000)],
  columns: ["conversion", "base", "spanA", "spanB", "lagging"],
  plots: [
    line("conversion", COLORS.blue, { title: "Conversion line" }),
    line("base", COLORS.red, { title: "Base line" }),
    fillBetween("cloud", "spanA", "spanB", COLORS.green, "Cloud"),
    line("spanA", COLORS.green, { title: "Leading span A", offset: DISPLACEMENT - 1 }),
    line("spanB", COLORS.orange, { title: "Leading span B", offset: DISPLACEMENT - 1 }),
    line("lagging", COLORS.purple, { title: "Lagging span", offset: -(DISPLACEMENT - 1) }),
  ],
  label: (p) => `${p.conversion}, ${p.base}, ${p.spanB}, ${DISPLACEMENT}`,
  build: (g, p) => {
    const conv = channel(g, p.conversion).mid, base = channel(g, p.base).mid;
    const a = g.map2(conv, base, (x, y) => (x + y) / 2);
    return [conv, base, a, channel(g, p.spanB).mid, g.map(g.close, (x) => x)];
  },
  reference: "TradingView Ichimoku Cloud: donchian(n) = (ta.highest(high, n) + ta.lowest(low, n)) / 2; conversion = donchian(9), base = donchian(26), span A = (conversion + base) / 2, span B = donchian(52), lagging = close; leading spans plotted with offset displacement - 1 = 25, the lagging span with -25 (TradingView's own plot offsets for displacement 26). Columns hold the undisplaced values.",
});

// ---- Supertrend -----------------------------------------------------------------

export const supertrend = defineStudy({
  id: "supertrend", name: "Supertrend", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [int("atrLength", 10, 1, 5000), float("factor", 3, 0.1, 100, 0.1)],
  columns: ["up", "down", "direction"],
  plots: [line("up", COLORS.green, { title: "Up trend" }), line("down", COLORS.red, { title: "Down trend" })],
  label: (p) => `${p.factor}, ${p.atrLength}`,
  build: (g, p) => {
    const { high, low, close } = g;
    const atr = g.atr(p.atrLength);
    const lb = g.col(), ub = g.col(), dr = g.col(), st = g.col();
    const main = g.node((s, a, b) => {
      const h = high.v, l = low.v, c = close.v, at = atr.v, lo = lb.v, up = ub.v, d = dr.v, t = st.v;
      for (let i = a; i < b; i++) {
        const r = at[i]!;
        if (r !== r) { lo[i] = NaN_; up[i] = NaN_; d[i] = NaN_; t[i] = NaN_; s.v[i] = NaN_; continue; }
        const mid = (h[i]! + l[i]!) / 2;
        let lower = mid - p.factor * r, upper = mid + p.factor * r;
        const first = i === 0 || lo[i - 1]! !== lo[i - 1]!;
        if (!first) {
          const pl = lo[i - 1]!, pu = up[i - 1]!, pc = c[i - 1]!;
          lower = lower > pl || pc < pl ? lower : pl;
          upper = upper < pu || pc > pu ? upper : pu;
        }
        let dir: number;
        // Pine: na(atr[1]) -> 1; prev supertrend was the upper band -> down unless close breaks it
        if (first) dir = 1;
        else if (t[i - 1]! === up[i - 1]!) dir = c[i]! > upper ? -1 : 1;
        else dir = c[i]! < lower ? 1 : -1;
        lo[i] = lower; up[i] = upper; d[i] = dir;
        t[i] = dir === -1 ? lower : upper;
        s.v[i] = dir;
      }
    });
    return [g.calc((i) => (dr.v[i] === -1 ? st.v[i]! : NaN_)), g.calc((i) => (dr.v[i] === 1 ? st.v[i]! : NaN_)), main];
  },
  reference: "Pine ta.supertrend(factor, atrPeriod): bands hl2 +- factor * ta.atr; direction is Pine's: -1 = uptrend (line below price, column `up`), 1 = downtrend (line above price, column `down`)",
});

// ---- Alligator ------------------------------------------------------------------

export const alligator = defineStudy({
  id: "alligator", name: "Williams Alligator", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [int("jawLength", 13, 1, 5000), int("teethLength", 8, 1, 5000), int("lipsLength", 5, 1, 5000), source("hl2")],
  columns: ["jaw", "teeth", "lips"],
  plots: [
    line("jaw", COLORS.blue, { title: "Jaw", offset: 8 }),
    line("teeth", COLORS.red, { title: "Teeth", offset: 5 }),
    line("lips", COLORS.green, { title: "Lips", offset: 3 }),
  ],
  label: (p) => `${p.jawLength}, ${p.teethLength}, ${p.lipsLength}`,
  build: (g, p) => { const x = g.src(p.source); return [g.rma(x, p.jawLength), g.rma(x, p.teethLength), g.rma(x, p.lipsLength)]; },
  reference: "TradingView Williams Alligator: jaw = smma(hl2, 13) shifted 8 bars, teeth = smma(hl2, 8) shifted 5, lips = smma(hl2, 5) shifted 3 (the shifts are fixed plot offsets, not inputs)",
});

// ---- Fractals -------------------------------------------------------------------

/** Williams fractals look n bars to each side. The plot offsets (-2) are static, so n is fixed. */
const FRACTAL_N = 2;
/** Equal highs/lows tolerated on the left side of the extreme before the strictly beyond bar. */
const FRACTAL_TIES = 4;

function fractal(g: Graph, x: Col, isHigh: boolean): Node {
  const n = FRACTAL_N;
  return g.node((s, a, b) => {
    const xv = x.v, v = s.v;
    for (let i = a; i < b; i++) {
      v[i] = NaN_;
      const c = i - n;
      if (c < 0) continue;
      const e = xv[c]!;
      const beyond = (y: number) => (isHigh ? y < e : y > e);
      let ok = true;
      for (let j = 1; j <= n && ok; j++) ok = beyond(xv[c + j]!);
      if (!ok) continue;
      let t = 0;
      while (t <= FRACTAL_TIES && c - 1 - t >= 0 && xv[c - 1 - t]! === e) t++;
      const k = c - 1 - t;
      if (t <= FRACTAL_TIES && k >= 0 && beyond(xv[k]!)) v[i] = e;
    }
  });
}

export const fractals = defineStudy({
  id: "fractals", name: "Williams Fractals", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [], columns: ["up", "down"],
  plots: [
    markers("up", "triangleUp", "above", COLORS.green, { title: "Up fractal", offset: -FRACTAL_N }),
    markers("down", "triangleDown", "below", COLORS.red, { title: "Down fractal", offset: -FRACTAL_N }),
  ],
  // A fractal at bar c needs bars c+1..c+n, so it is known at bar c+n: the columns hold the fractal's price at that
  // CONFIRMATION bar and the plots shift the marker back by n onto the fractal's own bar.
  build: (g) => [fractal(g, g.high, true), fractal(g, g.low, false)],
  reference: "TradingView Williams Fractals (n = 2): high[n] strictly above the n bars after it, and above the bars before it allowing up to four tied equal highs followed by a strictly lower one; mirrored for lows. Confirmed n bars late.",
});

// ---- ZigZag ---------------------------------------------------------------------
//
// Not a closed-form TradingView study, so the algorithm is defined here and is
// causal (a bar only ever uses bars up to itself):
// - The first pivot appears once price has moved `deviation` % off the running
//   low (a low pivot) or the running high (a high pivot) seen since bar 0.
// - After a low pivot the leg runs up: its running extreme is the highest high.
//   The extreme becomes a high pivot when a later bar's low is `deviation` %
//   below it (the extreme was not exceeded on that bar). Mirrored after a high.
// - depth: a pivot is confirmed no sooner than `depth` bars after the previous
//   pivot's bar, which keeps legs from being confirmed on the bar after the last
//   pivot. (It delays a confirmation, it never changes the pivot found.)
// - `price` holds the pivot's price at the bar where it is CONFIRMED and `back`
//   the number of bars from there to the pivot bar (the chart draws the pivot at
//   confirmation bar - back). Pivots alternate high/low by construction.
// - The unconfirmed running extreme of the current leg is the last point of the
//   line: columns `live` (its price) and `liveBack` (bars back from this bar)
//   carry it on every bar. It can still move or be abandoned, so it is not in
//   `price`, which is final; a renderer joins the last pivot to it.

export const zigzag = defineStudy({
  id: "zigzag", name: "ZigZag", family: "tv", needs: "ohlc", pane: "overlay",
  inputs: [float("deviation", 5, 0.01, 100, 0.5), int("depth", 10, 1, 5000)],
  columns: ["price", "back", "live", "liveBack"],
  plots: [{ kind: "zigzag", key: "zigzag", title: "ZigZag", price: "price", back: "back", color: COLORS.blue, width: 2 } satisfies PlotDef],
  label: (p) => `${p.deviation}, ${p.depth}`,
  build: (g, p) => {
    const { high, low } = g;
    const d: number = p.deviation / 100, depth: number = p.depth;
    // state per bar: dir 0 = no pivot yet, 1 = leg up (looking for a high), -1 = leg down
    const dir = g.col(), exP = g.col(), exI = g.col(), pvI = g.col(), hP = g.col(), hI = g.col(), lP = g.col(), lI = g.col();
    const back = g.col(), live = g.col(), liveBack = g.col();
    const price = g.node((s, a, b) => {
      const H = high.v, L = low.v, v = s.v;
      for (let i = a; i < b; i++) {
        let dr = 0, eP = NaN_, eI = NaN_, pI = NaN_, hp = H[i]!, hi = i, lp = L[i]!, li = i;
        if (i > 0) { dr = dir.v[i - 1]!; eP = exP.v[i - 1]!; eI = exI.v[i - 1]!; pI = pvI.v[i - 1]!; hp = hP.v[i - 1]!; hi = hI.v[i - 1]!; lp = lP.v[i - 1]!; li = lI.v[i - 1]!; }
        let out = NaN_, ob = NaN_;
        if (dr === 0) {
          if (H[i]! > hp) { hp = H[i]!; hi = i; }
          if (L[i]! < lp) { lp = L[i]!; li = i; }
          if (hi > li && hp >= lp * (1 + d)) { out = lp; ob = i - li; pI = li; dr = 1; eP = hp; eI = hi; }
          else if (li > hi && lp <= hp * (1 - d)) { out = hp; ob = i - hi; pI = hi; dr = -1; eP = lp; eI = li; }
        } else if (dr === 1) {
          if (H[i]! > eP) { eP = H[i]!; eI = i; }
          else if (L[i]! <= eP * (1 - d) && i - pI >= depth) { out = eP; ob = i - eI; pI = eI; dr = -1; eP = L[i]!; eI = i; }
        } else {
          if (L[i]! < eP) { eP = L[i]!; eI = i; }
          else if (H[i]! >= eP * (1 + d) && i - pI >= depth) { out = eP; ob = i - eI; pI = eI; dr = 1; eP = H[i]!; eI = i; }
        }
        dir.v[i] = dr; exP.v[i] = eP; exI.v[i] = eI; pvI.v[i] = pI;
        hP.v[i] = hp; hI.v[i] = hi; lP.v[i] = lp; lI.v[i] = li;
        v[i] = out; back.v[i] = ob;
        live.v[i] = dr === 0 ? NaN_ : eP;
        liveBack.v[i] = dr === 0 ? NaN_ : i - eI;
      }
    });
    return [price, g.alias(back), g.alias(live), g.alias(liveBack)];
  },
  reference: "ZigZag as defined in this file's header: percentage-reversal pivots on high/low with a minimum spacing in bars, confirmed causally",
});
