// ?ex=plot — @alphacharts/plot: every mark, and the shapes a host app needs.
// All data is generated from fixed seeds so pictures never move.
//   ?ex=plot            every example in a scrolling grid
//   ?ex=plot&only=<id>  one example at 640x360 (the visual and behaviour specs)
//   ?ex=plot&only=perf&n=10000
// window.__plots carries the live plots for bench/tests/plot.spec.ts.

import { createPlot, PLOT_DARK, PLOT_LIGHT, PlotSyncGroup, type Plot, type PlotSpec } from "@alphacharts/plot";
import { rng } from "./synthetic.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

export interface PlotDemo {
  plots: Plot[];
  group: PlotSyncGroup | undefined;
  specs: Record<string, PlotSpec>;
  /** The library, for tests that create plots themselves. */
  api: { createPlot: typeof createPlot; PlotSyncGroup: typeof PlotSyncGroup; replaySpecs: typeof replaySpecs };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

const strikes = Array.from({ length: 21 }, (_, i) => 24000 + i * 100);
const SPOT = 24_960;

function oiMirror(): PlotSpec {
  const r = rng(11);
  const bell = (k: number, c: number, w: number) => Math.exp(-(((k - c) / w) ** 2));
  const call = strikes.map((k) => Math.round((40_000 + 160_000 * bell(k, 25_200, 450) + 12_000 * r()) / 100) * 100);
  const put = strikes.map((k) => Math.round((40_000 + 170_000 * bell(k, 24_700, 450) + 12_000 * r()) / 100) * 100);
  return {
    title: "Open interest by strike",
    scales: { y: { type: "band", reverse: true } },
    axes: { x: { format: "compact-abs", label: "Open interest" }, y: { label: "Strike" } },
    marks: [
      { type: "bar", name: "Put OI", orient: "h", y: strikes.map(String), x: put, mirror: true, color: "#ef5350" },
      { type: "bar", name: "Call OI", orient: "h", y: strikes.map(String), x: call, color: "#26a69a" },
      { type: "rule", y: [SPOT, 24_700], labels: ["Spot 24,960", "Max pain 24,700"], color: "#f57c00" },
    ],
  };
}

function payoff(): PlotSpec {
  const prem = 180, k1 = 24_800, k2 = 25_200;
  const xs = Array.from({ length: 81 }, (_, i) => 24_200 + i * 20);
  // Bull call spread: long k1, short k2, net debit prem.
  const y = xs.map((s) => Math.min(Math.max(s - k1, 0), k2 - k1) - prem);
  return {
    title: "Bull call spread payoff",
    axes: { x: { label: "Expiry price", format: "auto" }, y: { label: "P&L (₹ per unit)" } },
    scales: { x: { type: "linear" } },
    marks: [
      { type: "area", name: "P&L", x: xs, y, y0: 0, split: { above: "#26a69a", below: "#ef5350" }, opacity: 0.3 },
      { type: "rule", x: [k1 + prem, SPOT], labels: ["Breakeven 24,980", "Spot"], color: "#f57c00" },
      { type: "band", x: [24_200, k1], label: "Max loss", color: "#ef5350", opacity: 0.06 },
    ],
  };
}

function flows(): PlotSpec {
  const r = rng(5);
  const n = 30;
  const t = Array.from({ length: n }, (_, i) => T0 + i * DAY);
  const fii = t.map(() => Math.round(gauss(r) * 2400 - 300));
  const dii = t.map(() => Math.round(gauss(r) * 1800 + 500));
  let c = 0;
  const cum = fii.map((v, i) => (c += v + dii[i]!));
  return {
    title: "Institutional flows",
    timeZone: "Asia/Kolkata",
    scales: { x: { type: "time" }, y2: {} },
    axes: { x: { format: "date" }, y: { label: "Daily net (₹ cr)", format: "compact" }, y2: { label: "Cumulative", format: "compact" } },
    marks: [
      { type: "bar", name: "FII", x: t, y: fii, stack: "flows" },
      { type: "bar", name: "DII", x: t, y: dii, stack: "flows" },
      { type: "line", name: "Cumulative", x: t, y: cum, yAxis: "y2", color: "#7b1fa2", curve: "monotone" },
    ],
  };
}

function sectors(): PlotSpec {
  // A tile's second line is its own change, signed with the real minus; the default would be its share of the total.
  const change = (c: number) => `${c < 0 ? "\u2212" : c > 0 ? "+" : ""}${Math.abs(c).toFixed(2)}%`;
  const mk = (name: string, items: [string, number, number][]) => ({ name, children: items.map(([n, v, c]) => ({ name: n, value: v, colorValue: c, detail: change(c) })) });
  return {
    title: "Sector map",
    scales: { color: { type: "diverging", domain: [-3, 3] } },
    marks: [
      {
        type: "treemap", colorBy: "value", name: "Day change %",
        root: {
          name: "Nifty",
          children: [
            mk("Financials", [["HDFCBANK", 140, 0.8], ["ICICIBANK", 100, 1.4], ["SBIN", 60, -0.6], ["KOTAKBANK", 40, 0.2]]),
            mk("IT", [["TCS", 130, -1.9], ["INFY", 80, -2.4], ["WIPRO", 25, -1.1]]),
            mk("Energy", [["RELIANCE", 200, 0.5], ["ONGC", 30, 2.2]]),
            mk("Auto", [["MARUTI", 45, 1.1], ["M&M", 50, 2.6], ["TATAMOTORS", 40, -0.3]]),
            { name: "FMCG", children: [{ name: "ITC", value: 60, colorValue: -0.4, detail: change(-0.4) }, { name: "HUL", value: 55, colorValue: 0.1, detail: change(0.1) }] },
          ],
        },
      },
    ],
  };
}

function correlation(): PlotSpec {
  const names = ["NIFTY", "BANK", "IT", "PHARMA", "AUTO", "FMCG"];
  const r = rng(21);
  const m = names.map(() => names.map(() => 0));
  for (let i = 0; i < names.length; i++) {
    m[i]![i] = 1;
    for (let j = 0; j < i; j++) {
      const v = Math.round((0.75 * r() - 0.2 + (i === 1 && j === 0 ? 0.2 : 0)) * 100) / 100;
      m[i]![j] = m[j]![i] = v;
    }
  }
  const x: string[] = [], y: string[] = [], value: number[] = [];
  names.forEach((a, i) => names.forEach((b, j) => (x.push(b), y.push(a), value.push(m[i]![j]!))));
  return {
    title: "Correlation matrix",
    scales: { y: { type: "band", reverse: true } },
    marks: [{ type: "heatmap", name: "Correlation", x, y, value, labels: true, decimals: 2, colorScale: { type: "diverging", domain: [-1, 1], midpoint: 0 } }],
  };
}

function monthly(): PlotSpec {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const years = ["2022", "2023", "2024", "2025", "2026"];
  const r = rng(33);
  const x: string[] = [], y: string[] = [], value: number[] = [];
  years.forEach((yr) => months.forEach((mo, i) => {
    if (yr === "2026" && i > 9) return;
    x.push(mo);
    y.push(yr);
    value.push(Math.round(gauss(r) * 400) / 100);
  }));
  return {
    title: "Monthly returns (%)",
    scales: { y: { type: "band", reverse: true } },
    marks: [{ type: "heatmap", name: "Return %", x, y, value, labels: true, decimals: 1, colorScale: { type: "diverging" } }],
  };
}

function returnsHistogram(): PlotSpec {
  const r = rng(8);
  const values = Array.from({ length: 800 }, () => Math.round(gauss(r) * 120) / 100 + 0.05);
  return {
    title: "Daily return distribution",
    axes: { x: { label: "Daily return (%)" }, y: { label: "Days" } },
    marks: [
      { type: "histogram", name: "Returns", values, bins: "fd" },
      { type: "rule", x: 0, labels: ["0"], color: "#9598a1" },
    ],
  };
}

function bubbles(): PlotSpec {
  const r = rng(2);
  const n = 28;
  const x = Array.from({ length: n }, () => Math.round(r() * 100) / 10);
  const y = x.map((v) => Math.round((2 + 0.6 * v + gauss(r)) * 10) / 10);
  const size = x.map(() => Math.round(r() * 900 + 100));
  const cv = y.map((v, i) => Math.round((v - 5 + gauss(r)) * 10) / 10 + (i % 3));
  return {
    title: "Valuation vs growth",
    scales: { color: { type: "diverging" } },
    axes: { x: { label: "EPS growth (%)" }, y: { label: "P/E" } },
    marks: [{ type: "scatter", name: "Stocks", x, y, size, colorValue: cv, labels: x.map((_, i) => `STK${i + 1}`) }],
  };
}

// A stock against its peers (P/E x P/B, bubble = market cap): the focus label in a marker-pen chip, every peer a quiet chip,
// labels never overlapping a label or another bubble. The layout is a real, crowded one.
function peerLabels(theme: "light" | "dark"): PlotSpec {
  const t = theme === "dark" ? PLOT_DARK : PLOT_LIGHT;
  const names = ["HDFCBANK", "AXISBANK", "KOTAKBANK", "ICICIBANK", "SBIN", "BANKBARODA", "INDUSINDBK", "CANBK", "PNB", "UNIONBANK", "IDFCFIRSTB"];
  const x = [13.11, 12.82, 15.79, 21.7, 10.01, 10.62, 8.73, 5.45, 6.1, 6.26, 6.69];
  const y = [1.8181, 1.677, 2.5859, 2.431, 1.5279, 1.372, 1.4467, 0.9101, 0.9282, 1.005, 0.7304];
  const cap = [1450, 370, 390, 1050, 760, 95, 80, 85, 120, 100, 55];
  const ink = theme === "dark" ? "#e9eaee" : "#131722";
  const peer = { background: t.background, border: t.grid, color: ink };
  const focus = { background: "#ff5a1f", color: "#0a0a0a", etch: { color: "rgba(0,0,0,0.28)", spacing: 6, width: 1.5 } };
  return {
    title: "HDFCBANK against its peers",
    axes: { x: { label: "P/E" }, y: { label: "P/B" } },
    marks: [
      { type: "scatter", name: "Banks", x, y, size: cap, radius: [4, 22], colors: names.map((_, i) => (i === 0 ? ink : t.palette[0]!)), labels: names },
      { type: "text", x, y, text: names, chips: names.map((_, i) => (i === 0 ? focus : peer)), weights: names.map((_, i) => (i === 0 ? "semibold" : "normal")), anchor: { from: "Banks" }, avoid: { order: [0] } },
    ],
  };
}

function ivSmile(): PlotSpec {
  const ks = Array.from({ length: 17 }, (_, i) => 24_200 + i * 100);
  const iv = ks.map((k) => Math.round((14 + ((k - 24_960) / 400) ** 2 * 3.2 + (k < 24_960 ? 1 : 0)) * 100) / 100);
  const stale = ks.map((_, i) => i % 5 === 3);
  return {
    title: "IV smile (stale strikes hollow)",
    axes: { x: { label: "Strike" }, y: { label: "IV (%)" } },
    marks: [
      { type: "line", name: "Smile", x: ks, y: iv, curve: "monotone", color: "#7a7f8a", width: 1 },
      {
        type: "scatter", name: "Quotes", x: ks, y: iv, size: 4.5, color: "#2962ff",
        hollow: stale, shapes: ks.map((_, i) => (stale[i] ? "diamond" : "circle")), opacities: ks.map((_, i) => (stale[i] ? 0.8 : 0.95)),
        colors: ks.map((k, i) => (stale[i] ? "#f57c00" : k < SPOT ? "#2962ff" : "#089981")),
        states: stale.map((s) => (s ? "stale quote" : "live")), labels: ks.map((k) => `${k} CE`),
      },
      { type: "rule", x: SPOT, labels: ["Spot"], color: "#9598a1" },
    ],
  };
}

function equity(): { equity: PlotSpec; drawdown: PlotSpec } {
  const r = rng(77);
  const n = 260;
  const t = Array.from({ length: n }, (_, i) => T0 + i * DAY);
  let v = 100, peak = 100;
  const eq = t.map(() => (v *= 1 + (0.0007 + gauss(r) * 0.009)));
  const dd = eq.map((e) => (peak = Math.max(peak, e), Math.round(((e / peak - 1) * 100) * 100) / 100));
  const common = { timeZone: "Asia/Kolkata", interactions: { brush: true, zoom: true }, scales: { x: { type: "time" as const } } };
  return {
    equity: { ...common, title: "Equity curve", axes: { y: { label: "Equity (base 100)" }, x: { format: "date" } }, marks: [{ type: "area", name: "Equity", x: t, y: eq, color: "#2962ff", opacity: 0.18 }, { type: "line", name: "Benchmark", x: t, y: eq.map((e, i) => 100 + (e - 100) * 0.6 + Math.sin(i / 20)), color: "#9598a1", width: 1, dash: [4, 3] }] },
    drawdown: { ...common, title: "Underwater", axes: { y: { label: "Drawdown (%)" }, x: { format: "date" } }, marks: [{ type: "area", name: "Drawdown", x: t, y: dd, y0: 0, color: "#ef5350", opacity: 0.3 }] },
  };
}

function shareholding(): PlotSpec {
  const q = ["Dec 24", "Mar 25", "Jun 25", "Sep 25", "Dec 25", "Mar 26"];
  return {
    title: "Shareholding pattern (%)",
    axes: { y: { label: "% of shares" } },
    marks: [
      { type: "bar", name: "Promoter", x: q, y: [50.3, 50.3, 50.1, 49.9, 49.9, 49.8], stack: "s" },
      { type: "bar", name: "FII", x: q, y: [19.2, 18.7, 18.1, 17.5, 17.9, 17.2], stack: "s" },
      { type: "bar", name: "DII", x: q, y: [14.6, 15.4, 16.2, 17.1, 17.4, 18.3], stack: "s" },
      { type: "bar", name: "Public", x: q, y: [15.9, 15.6, 15.6, 15.5, 14.8, 14.7], stack: "s" },
    ],
  };
}

function marks(): PlotSpec {
  const x = Array.from({ length: 24 }, (_, i) => i);
  const r = rng(4);
  const base = x.map((i) => 50 + 12 * Math.sin(i / 3.2) + gauss(r) * 2);
  return {
    title: "Line curves, step, bands and text",
    axes: { x: { label: "t" }, y: { label: "value" } },
    marks: [
      { type: "band", x: [6, 10], label: "event", color: "#7b1fa2", opacity: 0.1 },
      { type: "errorBand", name: "±8", x, lo: base.map((v) => v - 8), hi: base.map((v) => v + 8), opacity: 0.12 },
      { type: "line", name: "linear", x, y: base },
      { type: "line", name: "monotone", x, y: base.map((v) => v + 24), curve: "monotone" },
      { type: "line", name: "step", x, y: base.map((v) => Math.round(v) - 24), curve: "step", points: true },
      { type: "scatter", name: "marks", x: [3, 12, 20], y: [70, 40, 66], size: 5, shapes: ["square", "triangle", "cross"] },
      { type: "text", x: [3, 12, 20], y: [76, 46, 72], text: ["A", "B", "C"] },
      { type: "rule", y: 50, labels: ["50"], color: "#9598a1" },
    ],
  };
}

function groupedLog(): PlotSpec {
  const cats = ["Q1", "Q2", "Q3", "Q4"];
  return {
    title: "Grouped bars on a log axis",
    scales: { y: { type: "log" } },
    axes: { y: { label: "Volume" } },
    marks: [
      { type: "bar", name: "2025", x: cats, y: [120, 900, 4500, 22_000], labels: true },
      { type: "bar", name: "2026", x: cats, y: [300, 1500, 9000, 31_000], labels: true },
    ],
  };
}

function facets(): PlotSpec {
  const r = rng(90);
  const x = Array.from({ length: 30 }, (_, i) => i);
  const walk = (m: number) => {
    let v = 100;
    return x.map(() => (v *= 1 + m + gauss(r) * 0.01));
  };
  return {
    title: "Small multiples",
    facets: {
      columns: 2,
      cells: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCAP"].map((t, i) => ({ title: t, marks: [{ type: "line", name: "Close", x, y: walk(0.001 * (i - 1)) }] })),
    },
    marks: [{ type: "rule", y: 100, color: "#9598a1" }],
    legend: false,
  };
}

/** Daily candles with the volume strip under them: price axis on the right, no tick marks, volume on a hidden y2 and out of the tooltip. */
function candles(): PlotSpec {
  const r = rng(41);
  const n = 48;
  const t = Array.from({ length: n }, (_, i) => T0 + i * DAY);
  const open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = [], vol: number[] = [];
  let px = 24_800;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = Math.round((o + gauss(r) * 90) * 100) / 100;
    open.push(o);
    close.push(c);
    high.push(Math.round((Math.max(o, c) + r() * 60) * 100) / 100);
    low.push(Math.round((Math.min(o, c) - r() * 60) * 100) / 100);
    vol.push(Math.round(8_000 + r() * 6_000));
    px = c;
  }
  return {
    title: "Candles with volume",
    timeZone: "Asia/Kolkata",
    legend: false,
    scales: { x: { type: "time" }, y: { pad: 0.04 }, y2: { domain: [0, 4 * Math.max(...vol)] } },
    axes: { x: { format: "date" }, y: { side: "right", tickMarks: false, width: 64 }, y2: false },
    marks: [
      { type: "bar", name: "Volume", x: t, y: vol, yAxis: "y2", color: "rgba(149,152,161,0.55)", tooltip: false },
      { type: "candle", name: "NIFTY", x: t, open, high, low, close },
    ],
  };
}

/** A list-row sparkline: decorative, 2 px padding, no axes, a gradient fill, a transparent background. */
function sparkline(): PlotSpec {
  const r = rng(52);
  const x = Array.from({ length: 40 }, (_, i) => i);
  let v = 100;
  const y = x.map(() => (v *= 1 + 0.004 + gauss(r) * 0.012));
  return {
    width: 240,
    height: 56,
    decorative: true,
    padding: 2,
    legend: false,
    tooltip: false,
    axes: { x: false, y: false },
    theme: { background: "rgba(0,0,0,0)" },
    marks: [{ type: "area", x, y, color: "#2962ff", opacity: 0.4, gradient: true, strokeColor: "#1b44b3", width: 1.25 }],
  };
}

/** Replay: price with buy (up) and sell (down) fills, the playhead drawn as a rule that stays out of the tooltip. */
function replay(): PlotSpec {
  const r = rng(63);
  const n = 90;
  const t = Array.from({ length: n }, (_, i) => T0 + i * 60_000);
  let v = 24_900;
  const px = t.map(() => (v += gauss(r) * 8));
  const fills = [8, 17, 29, 41, 55, 68].map((i, k) => ({ i, buy: k % 2 === 0 }));
  return {
    title: "Replay fills",
    timeZone: "Asia/Kolkata",
    legend: false,
    scales: { x: { type: "time" } },
    axes: { x: { format: "datetime" }, y: { side: "right" } },
    marks: [
      { type: "line", name: "Price", x: t, y: px, color: "#7a7f8a", width: 1.25 },
      {
        type: "scatter", name: "Fills", x: fills.map((f) => t[f.i]!), y: fills.map((f) => px[f.i]!), size: 6,
        shapes: fills.map((f) => (f.buy ? "triangle" : "triangleDown")), colors: fills.map((f) => (f.buy ? "#089981" : "#f23645")), opacities: fills.map(() => 0.95),
        states: fills.map((f) => (f.buy ? "buy" : "sell")),
      },
      { type: "rule", x: t[52]!, color: "#f57c00", tooltip: false },
    ],
  };
}

/** A parameter sweep: one bar outlined ("yours"), colours by sign, the price gutter a fixed width. */
function sweep(): PlotSpec {
  const params = ["10", "15", "20", "25", "30", "35", "40"];
  const sharpe = [0.4, 0.9, 1.3, 1.1, 0.7, -0.2, -0.6];
  return {
    title: "Sweep: Sharpe by lookback",
    legend: false,
    axes: { x: { label: "Lookback (bars)" }, y: { label: "Sharpe", width: 56, tickMarks: false } },
    marks: [{ type: "bar", name: "Sharpe", x: params, y: sharpe, colors: sharpe.map((v) => (v >= 0 ? "#089981" : "#f23645")), strokes: params.map((p) => (p === "20" ? "#131722" : null)), strokeWidth: 2 }],
  };
}

/** No margin at all, no y axis, categories on a point scale: the first and last x labels would be cut at the chart's edge. */
function tight(): PlotSpec {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const r = rng(71);
  let v = 50;
  return {
    title: "Edge labels stay inside",
    legend: false,
    padding: 0,
    scales: { x: { type: "point", padding: 0 } },
    axes: { y: false, x: { tickMarks: false } },
    marks: [{ type: "line", x: months, y: months.map(() => (v += gauss(r) * 4)), color: "#2962ff" }],
  };
}

function perfSpec(n: number): PlotSpec {
  const r = rng(3);
  const x = new Float64Array(n), y = new Float64Array(n), y2 = new Float64Array(n);
  let v = 100;
  for (let i = 0; i < n; i++) {
    x[i] = i;
    y[i] = v *= 1 + gauss(r) * 0.004;
    y2[i] = v * (1 + gauss(r) * 0.02);
  }
  return {
    title: "10k points",
    interactions: { zoom: true, brush: true },
    marks: [
      { type: "scatter", name: "ticks", x, y: y2, size: 1.5, opacity: 0.35, color: "#9598a1" },
      { type: "line", name: "close", x, y },
    ],
  };
}

/**
 * Two live charts of a replay (price with a volume strip, and a P&L curve), `len` points
 * each: the load of a 10 Hz replay. The same seed gives the same prefix, so successive
 * lengths are successive updates of one stream.
 */
export function replaySpecs(len: number): [PlotSpec, PlotSpec] {
  const r = rng(61);
  const t = new Float64Array(len), px = new Float64Array(len), vol = new Float64Array(len), pnl = new Float64Array(len);
  let v = 24_900, c = 0;
  for (let i = 0; i < len; i++) {
    t[i] = T0 + i * 60_000;
    px[i] = v += gauss(r) * 6;
    vol[i] = Math.round(500 + 400 * r());
    pnl[i] = c += gauss(r) * 40;
  }
  const common = { timeZone: "Asia/Kolkata", scales: { x: { type: "time" as const }, y2: {} } };
  return [
    {
      ...common, title: "Replay price",
      marks: [
        { type: "bar", name: "Volume", x: t, y: vol, yAxis: "y2", color: "#9598a1" },
        { type: "line", name: "Price", x: t, y: px },
        { type: "rule", x: t[len - 1]!, color: "#f57c00" },
      ],
    },
    { ...common, title: "Replay P&L", marks: [{ type: "area", name: "P&L", x: t, y: pnl, color: "#2962ff" }] },
  ];
}

export function demoSpecs(n = 10_000, theme: "light" | "dark" = "light"): Record<string, PlotSpec> {
  const eq = equity();
  return {
    "oi-mirror": oiMirror(), payoff: payoff(), flows: flows(), sectors: sectors(), correlation: correlation(), monthly: monthly(),
    histogram: returnsHistogram(), bubbles: bubbles(), labels: peerLabels(theme), "iv-smile": ivSmile(), equity: eq.equity, drawdown: eq.drawdown,
    shareholding: shareholding(), marks: marks(), "grouped-log": groupedLog(), facets: facets(), candles: candles(), sparkline: sparkline(),
    replay: replay(), sweep: sweep(), tight: tight(), perf: perfSpec(n),
  };
}

export function runPlotDemo(app: HTMLElement, theme: "light" | "dark", params: URLSearchParams): PlotDemo {
  const specs = demoSpecs(Number(params.get("n") ?? 10_000), theme);
  const only = params.get("only");
  app.textContent = "";
  const plots: Plot[] = [];
  let group: PlotSyncGroup | undefined;
  const host = document.createElement("div");
  host.style.cssText = only
    ? "padding:12px;"
    : "display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:12px;padding:12px;overflow:auto;height:100%;box-sizing:border-box;";
  app.appendChild(host);
  const ids = only ? [only] : Object.keys(specs).filter((k) => k !== "perf" && k !== "drawdown");
  for (const id of ids) {
    const spec = specs[id];
    if (!spec) {
      app.textContent = `unknown plot example "${id}"`;
      continue;
    }
    const cell = document.createElement("div");
    cell.dataset.plot = id;
    cell.style.cssText = only ? "width:640px;height:360px;" : "height:320px;border:1px solid var(--line);border-radius:4px;overflow:hidden;";
    host.appendChild(cell);
    if (id === "sparkline") cell.style.cssText = "width:240px;height:56px;background:#e8eefc;";
    // A spec that brings its own theme (transparent background) keeps it.
    plots.push(createPlot(cell, { theme, ...spec }));
    // The synced pair: equity above its drawdown.
    if (id === "equity" && !only) {
      cell.style.height = "200px";
      const dd = document.createElement("div");
      dd.dataset.plot = "drawdown";
      dd.style.cssText = "height:120px;border:1px solid var(--line);border-top:0;overflow:hidden;";
      const wrap = document.createElement("div");
      host.replaceChild(wrap, cell);
      wrap.append(cell, dd);
      const p2 = createPlot(dd, { ...specs.drawdown!, theme });
      plots.push(p2);
      group = new PlotSyncGroup().add(plots[plots.length - 2]!).add(p2);
    }
  }
  if (only === "equity-pair") {
    // Both halves at full size for the sync behaviour test.
    app.textContent = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "padding:12px;display:grid;gap:0;width:640px;";
    const a = document.createElement("div"), b = document.createElement("div");
    a.dataset.plot = "equity";
    b.dataset.plot = "drawdown";
    a.style.height = "240px";
    b.style.height = "140px";
    wrap.append(a, b);
    app.appendChild(wrap);
    plots.length = 0;
    const pa = createPlot(a, { ...specs.equity!, theme }), pb = createPlot(b, { ...specs.drawdown!, theme });
    plots.push(pa, pb);
    group = new PlotSyncGroup().add(pa).add(pb);
  }
  for (const p of plots) p.flush();
  return { plots, group, specs, api: { createPlot, PlotSyncGroup, replaySpecs } };
}
