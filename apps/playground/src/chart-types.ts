// ?ex=chart-types: every chart type from @alphacharts/chart-types on the same
// synthetic market. Time-based types read the bars directly; the event-based
// ones (Renko, Kagi, Point & Figure, range, line break, tick/volume/dollar)
// are built by their transforms and sit on the ordinal axis (their axis shows bar numbers: see store.ts), with the crosshair readout resolving the bar's
// true source time range. ?type=<id> shows one type full size (the visual
// tests snapshot each); without it, a grid of all of them.

import {
  createChart, type Chart, type OhlcBar, type Series, type SeriesType, type Theme,
} from "@alphacharts/core";
import {
  HeikinAshi, Kagi, LineBreak, PointFigure, RangeBars, Renko, TradeBars, ordinalTimeLabel, registerAllChartTypes, type BarStore,
} from "@alphacharts/chart-types";
import { ohlc, trades } from "./synthetic.js";

export interface Cell {
  id: string;
  label: string;
  chart: Chart;
  series: Series<SeriesType>[];
  /** Derived bars behind the chart, when it is event-based. */
  store?: BarStore;
}

declare global {
  interface Window {
    __ct?: Cell[];
  }
}

const fmtTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export function run(app: HTMLElement, theme: Theme, R: { renderer?: "webgl" | "canvas2d" }, params: URLSearchParams): Chart[] {
  registerAllChartTypes();
  const n = Number(params.get("n") ?? 400);
  const d = ohlc(n, 4);
  const bars: OhlcBar[] = Array.from(d.time, (t, i) => ({ time: t, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, }));
  // Event-based types get more input so they have a few hundred bars to show.
  const longBars: OhlcBar[] = (() => {
    const l = ohlc(6000, 11);
    return Array.from(l.time, (t, i) => ({ time: t, open: l.open[i]!, high: l.high[i]!, low: l.low[i]!, close: l.close[i]! }));
  })();
  const tr = trades(30_000, 7);
  const pf = { type: "price" as const, minMove: 0.05 };
  const value = { time: d.time, value: d.close };
  // Around the middle of the closes on screen (the last ~100 bars), so the series crosses it.
  const shownCloses = Array.from(d.close.subarray(Math.max(0, n - 100)));
  const base = Math.round((Math.min(...shownCloses) + Math.max(...shownCloses)) / 2 / 0.05) * 0.05;

  // Event-based charts sit on the ordinal axis: label it with bar numbers, not 1970 dates.
  const ordinal = new Set(["renko", "renko-atr", "kagi", "point-figure", "range", "line-break", "tick", "volume", "dollar"]);
  type Build = (chart: Chart) => { series: Series<SeriesType>[]; store?: BarStore };
  const types: { id: string; label: string; build: Build }[] = [
    { id: "baseline", label: "Baseline", build: (c) => {
      const s = c.addSeries("baseline", { base, priceFormat: pf });
      s.setData(value);
      c.createPriceLine(s, { price: base, color: theme.textMuted, title: "base", lineStyle: "dashed" });
      return { series: [s as never] };
    } },
    { id: "step-line", label: "Step line", build: (c) => {
      const s = c.addSeries("step-line", { priceFormat: pf });
      s.setData(value);
      return { series: [s as never] };
    } },
    { id: "columns", label: "Columns", build: (c) => {
      const s = c.addSeries("columns", { priceFormat: pf });
      s.setData(d);
      return { series: [s as never] };
    } },
    { id: "hi-lo", label: "Hi-Lo", build: (c) => {
      const s = c.addSeries("hi-lo", { priceFormat: pf });
      s.setData(d);
      return { series: [s as never] };
    } },
    { id: "ohlc-dots", label: "OHLC dots", build: (c) => {
      const s = c.addSeries("ohlc-dots", { priceFormat: pf });
      s.setData(d);
      return { series: [s as never] };
    } },
    { id: "line-markers", label: "Line with markers", build: (c) => {
      const s = c.addSeries("line-markers", { priceFormat: pf });
      s.setData(value);
      return { series: [s as never] };
    } },
    { id: "heikin-ashi", label: "Heikin-Ashi", build: (c) => {
      const ha = new HeikinAshi();
      ha.pushAll(bars);
      const s = c.addSeries("candles", { priceFormat: pf });
      s.setData(ha.store.columns());
      return { series: [s as never], store: ha.store };
    } },
    { id: "renko", label: "Renko (box 25)", build: (c) => {
      const t = new Renko({ box: 25 });
      t.pushBars(longBars);
      const s = c.addSeries("bricks", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "renko-atr", label: "Renko (ATR 14)", build: (c) => {
      const t = new Renko({ atrPeriod: 14 });
      t.pushBars(longBars);
      const s = c.addSeries("bricks", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "kagi", label: "Kagi (reversal 40)", build: (c) => {
      const t = new Kagi({ amount: 40 });
      t.pushBars(longBars);
      const thin = c.addSeries("kagi", { lineWidth: 1, priceFormat: pf });
      thin.setData(t.store.columns());
      const thick = c.addSeries("kagi", { lineWidth: 3, connectors: false, lastValueVisible: false, priceLineVisible: false, priceFormat: pf });
      thick.setData(t.thick.columns());
      return { series: [thin as never, thick as never], store: t.store };
    } },
    { id: "point-figure", label: "Point & Figure (box 25, 3)", build: (c) => {
      const t = new PointFigure(25, 3);
      t.pushBars(longBars);
      const s = c.addSeries("point-figure", { boxSize: 25, priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "range", label: "Range bars (15)", build: (c) => {
      const t = new RangeBars(15);
      t.pushTrades(tr);
      const s = c.addSeries("candles", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "line-break", label: "Line break (3)", build: (c) => {
      const t = new LineBreak(3);
      t.pushBars(longBars);
      const s = c.addSeries("bricks", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "tick", label: "Tick bars (150)", build: (c) => {
      const t = new TradeBars("tick", 150);
      t.pushAll(tr);
      const s = c.addSeries("candles", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "volume", label: "Volume bars (15,000)", build: (c) => {
      const t = new TradeBars("volume", 15_000);
      t.pushAll(tr);
      const s = c.addSeries("candles", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
    { id: "dollar", label: "Dollar bars (400M)", build: (c) => {
      const t = new TradeBars("dollar", 400_000_000);
      t.pushAll(tr);
      const s = c.addSeries("candles", { priceFormat: pf });
      s.setData(t.store.columns());
      return { series: [s as never], store: t.store };
    } },
  ];

  const only = params.get("type");
  const shown = only ? types.filter((t) => t.id === only) : types;
  if (only && shown.length === 0) throw new Error(`chart-types: unknown ?type=${only}`);
  const cols = only ? 1 : 4;
  const rows = Math.ceil(shown.length / cols);
  app.innerHTML = `<div class="grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">${shown.map(() => `<div style="position:relative"></div>`).join("")}</div>`;
  const cells = [...app.querySelectorAll<HTMLElement>(".grid > div")];
  const out: Cell[] = [];
  shown.forEach((t, i) => {
    const el = cells[i]!;
    const chart = createChart(el, { theme: { ...theme, fontSize: only ? 11 : 10 }, ...R, ...(ordinal.has(t.id) ? { timeLabel: ordinalTimeLabel } : {}) });
    const built = t.build(chart);
    const label = document.createElement("div");
    label.dataset.ctLabel = t.id;
    label.style.cssText = "position:absolute;left:8px;top:6px;font:11px system-ui,sans-serif;color:var(--muted);pointer-events:none;z-index:2;white-space:pre";
    label.textContent = t.label;
    el.appendChild(label);
    // Event-based charts: the crosshair time is an ordinal, so show the bar's true source time range.
    if (built.store) {
      const store = built.store;
      chart.on("crosshairMove", (e) => {
        const r = e.time === undefined ? undefined : store.sourceRangeAt(e.time);
        label.textContent = r ? `${t.label}  ·  source ${fmtTime(r.fromTime)} → ${fmtTime(r.toTime)} UTC` : t.label;
      });
    }
    out.push({ id: t.id, label: t.label, chart, series: built.series, ...(built.store ? { store: built.store } : {}) });
  });
  window.__ct = out;
  return out.map((c) => c.chart);
}
