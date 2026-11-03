import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { THEME } from "../theme.js";
import type { Adapter, Dataset } from "../types.js";

let chart: IChartApi | undefined;
let candles: ISeriesApi<"Candlestick"> | undefined;

export const adapter: Adapter = {
  id: "lightweight-charts",
  path: "Canvas2D candlestick series, one setData of row objects (the only input form it takes), default options (minBarSpacing 0.5), setVisibleLogicalRange per frame",
  mount(el) {
    chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: THEME.background }, textColor: THEME.text },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      timeScale: { timeVisible: true, borderColor: THEME.border },
      rightPriceScale: { borderColor: THEME.border },
    });
    candles = chart.addSeries(CandlestickSeries, {
      upColor: THEME.up, downColor: THEME.down, borderVisible: false, wickUpColor: THEME.up, wickDownColor: THEME.down,
    });
  },
  // Times are seconds here, as the library requires.
  prepare(d: Dataset) {
    const rows = new Array<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }>(d.n);
    for (let i = 0; i < d.n; i++) rows[i] = { time: (d.time[i]! / 1000) as UTCTimestamp, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]! };
    return rows;
  },
  load(prepared, d, initialBars) {
    candles!.setData(prepared as Parameters<ISeriesApi<"Candlestick">["setData"]>[0]);
    chart!.timeScale().setVisibleLogicalRange({ from: d.n - initialBars, to: d.n - 1 });
  },
  setRange: (from, to) => chart!.timeScale().setVisibleLogicalRange({ from, to }),
  visibleBars() {
    const r = chart!.timeScale().getVisibleLogicalRange();
    return r ? Math.round(r.to - r.from + 1) : 0;
  },
  dispose: () => chart?.remove(),
};
