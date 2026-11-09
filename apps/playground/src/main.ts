// Playground: one example per route (?ex=…). Each example sets
// window.__charts and window.__ready for the Playwright benches.

import { connectDatafeed, createChart, Dashboard, DARK, LIGHT, NSE, SyncGroup, type Chart, type Datafeed, type OhlcBar } from "@alphacharts/core";
import { attachCvd, attachDelta, attachFootprint, attachTpo, attachVolumeProfile, daySessions, FootprintSource, followBars, OrderFlow } from "@alphacharts/orderflow";
import { AlertsPlugin, linePrice } from "@alphacharts/alerts";
import { allTools, DrawingsPlugin } from "@alphacharts/drawings";
import { ohlc, rng, rsi, sma, volume } from "./synthetic.js";
import { TradeTape } from "./trades.js";
import { addStudy, createRunner, installStudies, runStudy, type Study } from "@alphacharts/indicators";
import { ALL_STUDIES, registerAllStudies } from "@alphacharts/indicators/all";

declare global {
  interface Window {
    __charts: Chart[];
    /** plot example: the live plots and the demo (specs, sync group). */
    __plots?: import("@alphacharts/plot").Plot[];
    __plotDemo?: import("./plot-demo.js").PlotDemo;
    __ready: boolean;
    __data: ReturnType<typeof ohlc>;
    __tick?: (n: number) => void;
    /** The order-flow example: the flow, a way to stream trades, and what was measured. */
    __of?: { flow: OrderFlow; push(n: number): void; tape: TradeTape; footprint: ReturnType<typeof attachFootprint>; build: { trades: number; ms: number } };
    __studies?: Study[];
    /** indicators example: max |live - batch| over every study column, for the behaviour test. */
    __verify?: () => number;
    __timing?: Record<string, number>;
    __save?: () => unknown;
    __restore?: (state: unknown) => void;
    /** blank example: the core module, for tests that create and remove charts themselves. */
    __ac?: { createChart: typeof createChart; ohlc: typeof ohlc; DrawingsPlugin: typeof DrawingsPlugin; allTools: typeof allTools; AlertsPlugin: typeof AlertsPlugin; linePrice: typeof linePrice };
  }
}

const params = new URLSearchParams(location.search);
const ex = params.get("ex") ?? "basic";
const n = Number(params.get("n") ?? 0);
const themeName = params.get("theme") === "light" ? "light" : "dark";
const theme = themeName === "light" ? LIGHT : DARK;
// ?renderer=webgl|shared|canvas2d forces a surface; default auto.
const R = params.get("renderer") ? { renderer: params.get("renderer") as "webgl" | "canvas2d" } : {};
document.documentElement.dataset.theme = themeName;
const app = document.getElementById("app")!;
const nav = document.getElementById("nav")!;

const EXAMPLES: Record<string, string> = {
  basic: "Candles + volume",
  big: "10M bars",
  panes: "Multi-pane",
  types: "Series types",
  scales: "Scale modes",
  sessions: "Sessions",
  synced: "16 synced",
  live: "Live 100 Hz",
  feed: "Datafeed paging",
  i18n: "Locales (?locale=hi-IN|ar)",
  indicators: "Indicators",
  lwc: "lightweight-charts (baseline)",
  orderflow: "Order flow",
  "chart-types": "Chart types",
  drawings: "Drawings",
  alerts: "Alerts",
  script: "Scripts",
  ui: "Chart app",
  integration: "Integration",
  plot: "Plot",
};
for (const [k, label] of Object.entries(EXAMPLES)) {
  const a = document.createElement("a");
  a.href = `?ex=${k}${themeName === "light" ? "&theme=light" : ""}`;
  a.textContent = label;
  if (k === ex) a.setAttribute("aria-current", "page");
  nav.appendChild(a);
}
const themeLink = document.createElement("a");
themeLink.href = `?ex=${ex}${themeName === "light" ? "" : "&theme=light"}`;
themeLink.textContent = themeName === "light" ? "Dark" : "Light";
nav.appendChild(themeLink);
const stat = document.createElement("span");
stat.className = "stat";
nav.appendChild(stat);


// The indicators example: 5 overlays and 5 oscillator panes.
const STUDY_LIST: [string, Record<string, number | string | boolean>][] = [
  ["sma", { length: 20 }],
  ["ema", { length: 50 }],
  ["bbands", { length: 20 }],
  ["supertrend", {}],
  ["sar", {}],
  ["rsi", { length: 14 }],
  ["macd", {}],
  ["stoch", {}],
  ["atr", { length: 14 }],
  ["obv", {}],
];

/** A fresh batch run of a study over the bars the source series holds now. */
function batchOf(s: Study, c: import("@alphacharts/core").Series<"candles">, v: import("@alphacharts/core").Series<"histogram">, chart: Chart): (col: string) => Float64Array {
  const sd = c.data.store, vd = v.data;
  const n = [...Array(sd.length).keys()].filter((k) => c.data.has(sd.first + k)).length;
  const cols = { time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n), low: new Float64Array(n), close: new Float64Array(n), volume: new Float64Array(n) };
  let k = 0;
  for (let i = sd.first; i < sd.end; i++) {
    if (!c.data.has(i)) continue;
    cols.time[k] = chart.logicalToTime(i);
    cols.open[k] = c.data.get(i, 0); cols.high[k] = c.data.get(i, 1); cols.low[k] = c.data.get(i, 2); cols.close[k] = c.data.get(i, 3);
    cols.volume[k] = vd.get(i, 0);
    k++;
  }
  const out = runStudy(s.def, s.inputs() as never, cols);
  return (name) => out[s.def.columns.indexOf(name)]!;
}

const packed = (css: string) => {
  const h = css.replace("#", "");
  return ((parseInt(h, 16) << 8) | 0x80) >>> 0;
};

function candlesWithVolume(el: HTMLElement, d: ReturnType<typeof ohlc>) {
  const chart = createChart(el, { theme, ...R });
  const c = chart.addSeries("candles", { title: "SYNTH", priceFormat: { type: "price", minMove: 0.05 } });
  c.setData(d);
  const v = chart.addSeries("histogram", { priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "volume" } });
  chart.priceScale("vol").applyOptions({ marginTop: 0.8, marginBottom: 0 });
  v.setData(volume(d, packed(theme.up), packed(theme.down)));
  return { chart, c, v };
}

function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const r = fn();
  stat.textContent = `${label} ${(performance.now() - t0).toFixed(0)} ms`;
  return r;
}

async function run(): Promise<void> {
  switch (ex) {
    case "basic": {
      const d = ohlc(n || 100_000, 1);
      window.__data = d;
      const { chart, c } = timed(`${d.time.length.toLocaleString()} bars, setData`, () => candlesWithVolume(app, d));
      chart.createPriceLine(c, { price: d.close[d.close.length - 1]! * 1.01, color: theme.accent, title: "target", lineStyle: "dashed" });
      window.__charts = [chart];
      break;
    }
    case "blank": {
      window.__ac = { createChart, ohlc, DrawingsPlugin, allTools, AlertsPlugin, linePrice };
      window.__charts = [];
      break;
    }
    case "big": {
      const count = n || 10_000_000;
      const d = ohlc(count, 2);
      window.__data = d;
      const chart = createChart(app, { theme, ...R });
      const c = chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } });
      timed(`${count.toLocaleString()} bars, setData`, () => c.setData(d));
      window.__charts = [chart];
      break;
    }
    case "panes": {
      const d = ohlc(n || 200_000, 3);
      window.__data = d;
      const chart = createChart(app, { theme, ...R });
      const c = chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } });
      c.setData(d);
      chart.addSeries("line", { color: "chart-2", lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, priceFormat: { type: "price", minMove: 0.05 } }).setData(sma(d, 50));
      chart.addSeries("line", { color: "chart-3", lineWidth: 1.5, priceFormat: { type: "price", minMove: 0.01 }, pane: 1, title: "RSI 14" }).setData(rsi(d));
      chart.addSeries("histogram", { pane: 2, priceFormat: { type: "volume" }, priceLineVisible: false }).setData(volume(d, packed(theme.up), packed(theme.down)));
      window.__charts = [chart];
      break;
    }
    case "types": {
      app.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr"><div></div><div></div><div></div><div></div></div>`;
      const cells = [...app.querySelectorAll<HTMLElement>(".grid > div")];
      const d = ohlc(n || 5_000, 4);
      window.__data = d;
      const charts: Chart[] = [];
      const a = createChart(cells[0]!, { theme, ...R });
      a.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } }).setData(d);
      const b = createChart(cells[1]!, { theme, ...R });
      b.addSeries("bars", { priceFormat: { type: "price", minMove: 0.05 } }).setData(d);
      const c = createChart(cells[2]!, { theme, ...R });
      c.addSeries("line", { priceFormat: { type: "price", minMove: 0.05 } }).setData({ time: d.time, value: d.close });
      const e = createChart(cells[3]!, { theme, ...R });
      e.addSeries("area", { priceFormat: { type: "price", minMove: 0.05 } }).setData({ time: d.time, value: d.close });
      charts.push(a, b, c, e);
      window.__charts = charts;
      break;
    }
    case "scales": {
      // Log, percent, indexed, inverted; and two axes on the right.
      app.innerHTML = `<div class="grid" style="grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr"><div></div><div></div><div></div><div></div></div>`;
      const cells = [...app.querySelectorAll<HTMLElement>(".grid > div")];
      const d = ohlc(n || 20_000, 7, undefined, 3_600_000, 40);
      window.__data = d;
      const pf = { type: "price" as const, minMove: 0.01 };
      const mk = (cell: HTMLElement, mode: "log" | "percent" | "indexed" | "linear", invert = false) => {
        const chart = createChart(cell, { theme, ...R, rightPriceScale: { mode, invert } });
        chart.addSeries("candles", { priceFormat: pf, title: `${mode}${invert ? " inverted" : ""}` }).setData(d);
        chart.timeScale.fitContent();
        return chart;
      };
      const a = mk(cells[0]!, "log"), b = mk(cells[1]!, "percent"), c = mk(cells[2]!, "linear", true);
      const e = createChart(cells[3]!, { theme, ...R });
      e.addSeries("candles", { priceFormat: pf }).setData(d);
      e.addSeries("line", { priceScaleId: "second", color: "chart-2", priceFormat: { type: "price", minMove: 0.01 } }).setData(rsi(d));
      e.priceScale("second").applyOptions({ position: "right", marginTop: 0.1, marginBottom: 0.1 });
      e.addSeries("line", { priceScaleId: "idx", color: "chart-3", priceFormat: pf }).setData({ time: d.time, value: d.close });
      e.priceScale("idx").applyOptions({ position: "left", mode: "indexed" });
      window.__charts = [a, b, c, e];
      break;
    }
    case "sessions": {
      // NSE minute bars 09:00–15:29 IST (09:00–09:15 is the pre-open), shaded
      // outside regular hours, with a 5-minute bar-close countdown.
      const raw = ohlc(n || 30_000, 8, undefined, 60_000, 24_000);
      const keep: number[] = [];
      for (let i = 0; i < raw.time.length; i++) {
        const local = new Date(raw.time[i]! + 330 * 60_000);
        const min = local.getUTCHours() * 60 + local.getUTCMinutes(), wd = local.getUTCDay();
        if (wd >= 1 && wd <= 5 && min >= 540 && min < 930) keep.push(i);
      }
      const pick = (a: Float64Array) => Float64Array.from(keep, (i) => a[i]!);
      const d = { time: pick(raw.time), open: pick(raw.open), high: pick(raw.high), low: pick(raw.low), close: pick(raw.close), volume: pick(raw.volume) };
      window.__data = d;
      const chart = createChart(app, { theme, ...R, timeZone: "Asia/Kolkata", sessions: NSE(), resolution: "5m" });
      chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 }, title: "NSE" }).setData(d);
      window.__charts = [chart];
      break;
    }
    case "synced": {
      const k = Number(params.get("k") ?? 16);
      const cols = Math.ceil(Math.sqrt(k));
      const rows = Math.ceil(k / cols);
      app.innerHTML = `<div class="grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">${"<div></div>".repeat(k)}</div>`;
      const cells = [...app.querySelectorAll<HTMLElement>(".grid > div")];
      const group = new SyncGroup();
      // ?dash=1: one Dashboard (shared canvases) instead of 16 standalone charts.
      const dash = params.get("dash") === "1" ? new Dashboard(app.querySelector<HTMLElement>(".grid")!, R) : null;
      const charts = cells.map((cell, i) => {
        // ?mixed=1: every other chart has 5-minute bars, so sync must match by time.
        const step = params.get("mixed") === "1" && i % 2 === 1 ? 300_000 : 60_000;
        const d = ohlc(n || 100_000, 10 + i, undefined, step, 100 + i * 37);
        const opts = { theme: { ...theme, fontSize: 10 }, ...R };
        const chart = dash ? dash.addChart(cell, opts) : createChart(cell, opts);
        chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } }).setData(d);
        group.add(chart);
        return chart;
      });
      window.__charts = charts;
      break;
    }
    case "live": {
      const d = ohlc(n || 100_000, 5);
      window.__data = d;
      const { chart, c, v } = candlesWithVolume(app, d);
      let last: OhlcBar = { time: d.time[d.time.length - 1]!, open: d.open[d.open.length - 1]!, high: d.high[d.high.length - 1]!, low: d.low[d.low.length - 1]!, close: d.close[d.close.length - 1]! };
      let vol = d.volume[d.volume.length - 1]!;
      let ticks = 0;
      const tick = () => {
        ticks++;
        const p = Math.max(0.05, last.close + (Math.random() - 0.5) * last.close * 0.0004);
        // A new minute bar every 600 ticks (6 s at 100 Hz) so appends are exercised.
        if (ticks % 600 === 0) {
          last = { time: last.time + 60_000, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p };
          vol = 0;
        } else {
          last = { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p };
        }
        vol += Math.round(Math.random() * 50);
        c.update(last);
        v.update({ time: last.time, value: vol, color: last.close >= last.open ? theme.up : theme.down });
      };
      window.__tick = (k: number) => {
        for (let i = 0; i < k; i++) tick();
      };
      if (params.get("auto") !== "0") setInterval(tick, 10);
      window.__charts = [chart];
      break;
    }
    case "indicators": {
      // ~10 studies over candles + volume. ?n= bars, ?studies= how many of the list, ?live=1 ticks at 100 Hz,
      // ?worker=1 computes the batch in a Web Worker.
      const d = ohlc(n || 2_000, 21);
      window.__data = d;
      const count = Math.min(Number(params.get("studies") ?? 10), STUDY_LIST.length);
      const { chart, c: c0, v: v0 } = candlesWithVolume(app, d);
      let c = c0, v = v0; // rebound after a layout restore
      const timing: Record<string, number> = {};
      const runner = params.get("worker") === "1" ? createRunner(new Set(ALL_STUDIES.map((s) => s.id)), () => new Worker(new URL("../../../packages/indicators/src/worker.ts", import.meta.url), { type: "module" }) as never) : undefined;
      registerAllStudies();
      installStudies(chart, runner ? { runner } : {});
      const t0 = performance.now();
      const studies = STUDY_LIST.slice(0, count).map(([id, inputs]) => addStudy(chart, c, id, inputs, { volume: v, ...(runner && { runner }) }));
      await Promise.all(studies.map((s) => s.ready()));
      timing.batchMs = performance.now() - t0;
      stat.textContent = `${d.time.length.toLocaleString()} bars, ${count} studies: ${timing.batchMs.toFixed(0)} ms`;
      let last = { time: d.time[d.time.length - 1]!, open: d.open.at(-1)!, high: d.high.at(-1)!, low: d.low.at(-1)!, close: d.close.at(-1)! };
      let vol = d.volume.at(-1)!;
      const r = rng(777);
      let ticks = 0;
      const tick = () => {
        ticks++;
        const p = Math.max(0.05, last.close + (r() - 0.5) * last.close * 0.0004);
        if (ticks % 50 === 0) {
          last = { time: last.time + 60_000, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p };
          vol = 0;
        } else last = { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p };
        vol += Math.round(r() * 50);
        c.update(last);
        v.update({ time: last.time, value: vol, color: last.close >= last.open ? theme.up : theme.down });
      };
      window.__tick = (k: number) => {
        const t = performance.now();
        for (let i = 0; i < k; i++) tick();
        timing.perTickMs = (performance.now() - t) / k;
      };
      window.__timing = timing;
      window.__studies = studies;
      window.__verify = () => {
        // Recompute every study from the source series' bars with a fresh batch run.
        let worst = 0;
        for (const s of window.__studies!) {
          const fresh = batchOf(s, c, v, chart);
          s.def.columns.forEach((name) => {
            const a = s.column(name), b = fresh(name);
            if (a.length !== b.length) worst = Infinity;
            for (let i = 0; i < a.length; i++) {
              if (a[i] !== a[i] && b[i] !== b[i]) continue;
              worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
            }
          });
        }
        return worst;
      };
      window.__save = () => chart.saveState();
      window.__restore = (state) => {
        chart.restoreState(state, { data: (ss) => (ss.id.startsWith("study:") ? undefined : ss.type === "histogram" ? volume(d, packed(theme.up), packed(theme.down)) : d) });
        const all = chart.series();
        c = all.find((x) => x.type === "candles") as typeof c;
        v = all.find((x) => x.type === "histogram" && !x.options().id.startsWith("study:")) as typeof v;
        window.__studies = chart.plugin<import("@alphacharts/indicators").StudiesPlugin>("alphacharts.studies")!.list();
      };
      if (params.get("live") === "1") setInterval(tick, 10);
      window.__charts = [chart];
      break;
    }
    case "feed": {
      // An async feed over a pre-generated history: pages of 2,000 bars,
      // 150 ms latency, a live bar every 250 ms.
      const all = ohlc(n || 500_000, 6);
      const feed: Datafeed = {
        async getBars(req, signal) {
          await new Promise((r) => setTimeout(r, 150));
          if (signal.aborted) throw new DOMException("aborted", "AbortError");
          let hi = all.time.length;
          while (hi > 0 && all.time[hi - 1]! > req.to) hi--;
          const lo = Math.max(0, hi - req.countBack);
          const sl = (a: Float64Array) => a.slice(lo, hi);
          return { bars: { time: sl(all.time), open: sl(all.open), high: sl(all.high), low: sl(all.low), close: sl(all.close) }, noMoreData: lo === 0 };
        },
        subscribeBars(_s, _r, onBar) {
          let bar: OhlcBar = { time: all.time[all.time.length - 1]!, open: all.open[all.open.length - 1]!, high: all.high[all.high.length - 1]!, low: all.low[all.low.length - 1]!, close: all.close[all.close.length - 1]! };
          const id = setInterval(() => {
            const p = bar.close * (1 + (Math.random() - 0.5) * 0.001);
            bar = { ...bar, close: p, high: Math.max(bar.high, p), low: Math.min(bar.low, p) };
            onBar(bar);
          }, 250);
          return () => clearInterval(id);
        },
      };
      const chart = createChart(app, { theme, ...R });
      const s = chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } });
      const ctl = connectDatafeed(chart, s, feed, { symbol: "SYNTH", resolution: "1", to: all.time[all.time.length - 1]!, onError: (e) => console.error("datafeed", e) });
      setInterval(() => (stat.textContent = `${(s.range() ? s.range()!.last - s.range()!.first + 1 : 0).toLocaleString()} bars loaded${ctl.loading ? ", loading…" : ""}${ctl.noMoreData ? ", all history" : ""}`), 200);
      window.__charts = [chart];
      break;
    }
    case "ui": {
      const m = await import("./ui-demo.js");
      await m.run(app, params);
      break;
    }
    case "i18n": {
      const { runI18nExample } = await import("./i18n-example.js");
      await runI18nExample(app, params.get("locale") ?? "en", { theme, R, n: n || 3000 });
      break;
    }
    case "chart-types": {
      const { run: runChartTypes } = await import("./chart-types.js");
      window.__charts = runChartTypes(app, theme, R, params);
      break;
    }
    case "lwc": {
      // Baseline for the benches: the same data through lightweight-charts.
      const { createChart: lwcCreate, CandlestickSeries } = await import("lightweight-charts");
      const d = ohlc(n || 100_000, 2);
      window.__data = d;
      const chart = lwcCreate(app, { autoSize: true, layout: { background: { color: theme.background }, textColor: theme.text } });
      const s = chart.addSeries(CandlestickSeries);
      const rows = new Array(d.time.length);
      for (let i = 0; i < rows.length; i++) rows[i] = { time: (d.time[i]! / 1000) as never, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]! };
      timed(`${rows.length.toLocaleString()} bars, setData`, () => s.setData(rows));
      (window as unknown as { __lwc: unknown }).__lwc = chart;
      window.__charts = [];
      break;
    }
    case "orderflow": {
      // Synthetic tape (dev only): footprint + session volume profile + CVD +
      // delta on top, TPO below. ?trades=N sets the history, ?live=1 streams.
      const total = Number(params.get("trades") ?? 40_000);
      const tick = 5;
      const flow = new OrderFlow({ tickSize: tick, periodMs: 300_000, sessions: daySessions("Asia/Kolkata", (9 * 60 + 15) * 60_000), resetCvdBySession: true });
      const tape = new TradeTape(tick, Date.UTC(2026, 9, 12), 24_000, 42);
      const t0 = performance.now();
      const trades = tape.take(total);
      const tGen = performance.now();
      flow.addMany(trades);
      const tAgg = performance.now();
      stat.textContent = `${total.toLocaleString()} trades, ${flow.bars.length} bars, aggregate ${(tAgg - tGen).toFixed(0)} ms`;
      void t0;
      // ?approx=1: pretend only bars exist (OHLC + volume): the labelled approximation.
      const approx = params.get("approx") === "1";
      const shown = approx
        ? OrderFlow.fromBars(Array.from({ length: flow.bars.length }, (_, i) => ({ time: flow.bars.start[i]!, open: flow.bars.open[i]!, high: flow.bars.high[i]!, low: flow.bars.low[i]!, close: flow.bars.close[i]!, volume: flow.bars.volume(i) })), { tickSize: tick, periodMs: 300_000, sessions: daySessions("Asia/Kolkata", (9 * 60 + 15) * 60_000) })
        : flow;
      app.style.display = "grid";
      app.style.gridTemplateColumns = "3fr 2fr";
      app.style.gap = "1px";
      const top = document.createElement("div"), bottom = document.createElement("div");
      for (const d of [top, bottom]) {
        d.style.minHeight = "0";
        d.style.position = "relative";
        app.appendChild(d);
      }
      const chart = createChart(top, { theme, timeZone: "Asia/Kolkata", ...R });
      const fp = attachFootprint(chart, shown);
      attachVolumeProfile(chart, fp.series, fp.source, { mode: "session", widthFraction: 0.25, maxWidthPx: 90 });
      if (!approx) {
        attachCvd(chart, flow, { pane: 1 });
        attachDelta(chart, flow, { up: theme.up, down: theme.down, pane: 2 });
        chart.setPaneStretch(0, 6);
        chart.setPaneStretch(1, 1.3);
        chart.setPaneStretch(2, 0.9);
      }
      const tpoChart = createChart(bottom, { theme, timeZone: "Asia/Kolkata", ...R });
      const candles = tpoChart.addSeries("candles", { priceFormat: { type: "price", minMove: tick } });
      followBars(shown, candles as never);
      attachTpo(candles as never, new FootprintSource(shown, tpoChart), {});
      const last = () => flow.bars.length - 1;
      const showTail = () => {
        const L = flow.bars.start[last()]!;
        chart.timeScale.setVisibleLogicalRange({ from: chart.timeToLogical(L) - 6, to: chart.timeToLogical(L) + 1.5 });
        // The TPO chart shows the newest session.
        let first = last();
        while (first > 0 && flow.bars.session[first - 1] === flow.bars.session[last()]) first--;
        tpoChart.timeScale.setVisibleLogicalRange({ from: tpoChart.timeToLogical(flow.bars.start[first]!) - 2.5, to: tpoChart.timeToLogical(L) + 4 });
      };
      showTail();
      const push = (k: number) => flow.addMany(tape.take(k));
      if (params.get("live") === "1") setInterval(() => push(20), 50);
      window.__of = { flow: shown, push, tape, footprint: fp, build: { trades: total, ms: tAgg - tGen } };
      window.__charts = [chart, tpoChart];
      break;
    }
    case "drawings": {
      const { runDrawings } = await import("./drawings-demo.js");
      const extra: Record<string, unknown> = {};
      window.__charts = [runDrawings(app, theme, params, extra)];
      Object.assign(window, extra);
      break;
    }
    case "alerts": {
      const { runAlerts } = await import("./alerts-demo.js");
      const extra: Record<string, unknown> = {};
      window.__charts = [runAlerts(app, theme, params, extra)];
      Object.assign(window, extra);
      break;
    }
    case "script": {
      const { runScriptDemo } = await import("./script-demo.js");
      const extra: Record<string, unknown> = {};
      window.__charts = [runScriptDemo(app, theme, params, extra, stat)];
      Object.assign(window, extra);
      break;
    }
    case "integration": {
      const { runIntegrationDemo } = await import("./integration-demo.js");
      const extra: Record<string, unknown> = {};
      window.__charts = [runIntegrationDemo(app, theme, extra)];
      Object.assign(window, extra);
      break;
    }
    case "plot": {
      const { runPlotDemo } = await import("./plot-demo.js");
      const demo = runPlotDemo(app, themeName, params);
      window.__charts = [];
      window.__plots = demo.plots;
      window.__plotDemo = demo;
      break;
    }
    default:
      app.textContent = `unknown example "${ex}"`;
  }
  // Ready means laid out and painted: WebKit can take a moment to give a
  // flex child its height, and a screenshot of a 0-px chart is a blank page.
  const settle = () => {
    const sized = (window.__charts ?? []).every((c) => c.element.clientWidth > 0 && c.element.clientHeight > 0);
    if (sized) requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
    else requestAnimationFrame(settle);
  };
  settle();
}

void run();
