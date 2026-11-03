import { createChart, type Chart, type Series } from "@alphacharts/core";
import type { Adapter, Dataset } from "../types.js";

let chart: Chart | undefined;
let candles: Series<"candles"> | undefined;
const c = (): Chart => chart ?? (() => { throw new Error("alphacharts: not mounted"); })();

export const adapter: Adapter = {
  id: "alphacharts",
  path: "WebGL2 candles series, columnar Float64Array setData (the README's fastest path in), public timeScale.setVisibleLogicalRange per frame",
  mount(el) {
    chart = createChart(el, { theme: "dark", timeZone: "UTC" });
    // renderer "auto" would fall back to Canvas2D without WebGL2; a silent fallback would be benchmarked as WebGL.
    if (chart.renderer !== "webgl") throw new Error(`alphacharts: expected the WebGL surface, got ${chart.renderer}`);
    candles = chart.addSeries("candles", { priceFormat: { type: "price", minMove: 0.05 } });
  },
  prepare: (d: Dataset) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }),
  load(prepared, d, initialBars) {
    candles!.setData(prepared as Parameters<Series<"candles">["setData"]>[0]);
    c().timeScale.setVisibleLogicalRange({ from: d.n - initialBars, to: d.n - 1 });
  },
  setRange: (from, to) => c().timeScale.setVisibleLogicalRange({ from, to }),
  visibleBars() {
    const r = c().timeScale.getVisibleLogicalRange();
    return Math.round(r.to - r.from + 1);
  },
  dispose: () => chart?.remove(),
};
