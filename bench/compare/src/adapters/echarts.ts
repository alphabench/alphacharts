import { CandlestickChart } from "echarts/charts";
import { DataZoomInsideComponent, GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { THEME } from "../theme.js";
import type { Adapter, Dataset } from "../types.js";

// The tree-shaken import ECharts documents for apps: only what this chart uses.
echarts.use([CandlestickChart, DataZoomInsideComponent, GridComponent, CanvasRenderer]);

function make(id: string, progressive: boolean): Adapter {
  let chart: echarts.ECharts | undefined;
  let t0 = 0;
  let step = 0;
  let waiting: (() => void) | undefined;
  const time = (i: number) => t0 + i * step;
  return {
    id,
    path: progressive
      ? "Canvas renderer, candlestick on a time axis with large mode (large: true, largeThreshold 600) and its default progressive rendering, inside dataZoom (filterMode filter), animation off; the view is moved with dispatchAction dataZoom"
      : "As echarts, with progressive rendering off (progressive: 0): every frame is drawn in full before it counts",
    mount(el) {
      chart = echarts.init(el, null, { renderer: "canvas" });
      chart.on("finished", () => {
        waiting?.();
        waiting = undefined;
      });
    },
    // [time, open, close, lowest, highest]: the documented candlestick row, with time as x.
    prepare(d: Dataset) {
      const rows = new Array<number[]>(d.n);
      for (let i = 0; i < d.n; i++) rows[i] = [d.time[i]!, d.open[i]!, d.close[i]!, d.low[i]!, d.high[i]!];
      return rows;
    },
    settled: () => new Promise<void>((res) => { waiting = res; }),
    load(prepared, d, initialBars) {
      t0 = d.time[0]!;
      step = d.stepMs;
      chart!.setOption({
        animation: false,
        useUTC: true,
        backgroundColor: THEME.background,
        textStyle: { color: THEME.text },
        grid: { left: 8, right: 64, top: 8, bottom: 28 },
        xAxis: { type: "time", axisLine: { lineStyle: { color: THEME.border } }, splitLine: { show: true, lineStyle: { color: THEME.grid } } },
        yAxis: { scale: true, position: "right", axisLine: { show: true, lineStyle: { color: THEME.border } }, splitLine: { lineStyle: { color: THEME.grid } } },
        dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "filter", startValue: time(d.n - initialBars), endValue: time(d.n - 1) }],
        series: [{
          type: "candlestick",
          large: true,
          largeThreshold: 600,
          ...(progressive ? {} : { progressive: 0 }),
          itemStyle: { color: THEME.up, color0: THEME.down, borderColor: THEME.up, borderColor0: THEME.down },
          data: prepared as number[][],
        }],
      });
    },
    setRange: (from, to) => chart!.dispatchAction({ type: "dataZoom", startValue: time(from), endValue: time(to) }),
    visibleBars() {
      const z = (chart!.getOption() as { dataZoom?: { startValue?: number; endValue?: number }[] }).dataZoom?.[0];
      return z?.startValue != null && z.endValue != null ? Math.round((z.endValue - z.startValue) / step) + 1 : 0;
    },
    dispose: () => chart?.dispose(),
  };
}

export const adapter = make("echarts", true);
export const adapterSync = make("echarts-sync", false);
