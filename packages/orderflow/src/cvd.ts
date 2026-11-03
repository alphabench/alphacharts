// Cumulative volume delta (CVD) and per-bar delta, as ordinary core series so
// they take a pane, an axis and the crosshair like any other.
//
// Delta of a bar = buy volume - sell volume; unknown-side volume is excluded
// (see FlowBars). CVD is the running total of delta from the first bar, or from
// the start of each session when the flow was built with resetCvdBySession.
// As candles a bar is open = CVD at the bar's start, close = CVD at its end,
// high/low = the extremes the running total reached inside the bar (exact, from
// the trades). A flow built from bars has no sides, so none of this exists for
// it and every function here throws instead of drawing zeros.

import { parseColor, type Chart, type ColumnarOhlc, type ColumnarValue, type Series } from "@alphacharts/core";
import type { OrderFlow } from "./flow.js";

function requireSides(flow: OrderFlow, what: string): void {
  if (flow.approximate) throw new Error(`orderflow: ${what} needs trades: this flow was built from bars, which carry no buy/sell sides`);
}

export function cvdOhlc(flow: OrderFlow, from = 0, to = flow.bars.length): ColumnarOhlc {
  requireSides(flow, "CVD");
  const b = flow.bars;
  const n = to - from;
  const close = new Float64Array(n);
  for (let i = 0; i < n; i++) close[i] = b.cvdClose(from + i);
  return { time: b.start.slice(from, to), open: b.cvdOpen.slice(from, to), high: b.cvdHigh.slice(from, to), low: b.cvdLow.slice(from, to), close };
}

export function cvdLine(flow: OrderFlow, from = 0, to = flow.bars.length): ColumnarValue {
  const o = cvdOhlc(flow, from, to);
  return { time: o.time, value: o.close };
}

/** Delta per bar as histogram input; colour 0xRRGGBBAA per point (up for delta >= 0). */
export function deltaValues(flow: OrderFlow, up: number, down: number, from = 0, to = flow.bars.length): ColumnarValue {
  requireSides(flow, "delta");
  const b = flow.bars;
  const n = to - from;
  const value = new Float64Array(n), color = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    value[i] = b.delta(from + i);
    color[i] = value[i]! >= 0 ? up : down;
  }
  return { time: b.start.slice(from, to), value, color };
}

export interface CvdHandle {
  readonly series: Series<"candles"> | Series<"line">;
  dispose(): void;
}

export interface CvdOptions {
  pane?: number;
  style?: "candles" | "line";
  title?: string;
}

export function attachCvd(chart: Chart, flow: OrderFlow, o: CvdOptions = {}): CvdHandle {
  requireSides(flow, "CVD");
  const pane = o.pane ?? 1, title = o.title ?? "CVD";
  const fmt = { priceFormat: { type: "volume" as const } };
  if (o.style === "line") {
    const series = chart.addSeries("line", { pane, title, ...fmt });
    const off = follow(flow, series, (i) => ({ time: flow.bars.start[i]!, value: flow.bars.cvdClose(i) }), () => cvdLine(flow));
    return { series, dispose: () => (off(), chart.removeSeries(series)) };
  }
  const series = chart.addSeries("candles", { pane, title, ...fmt });
  const off = follow(flow, series, (i) => { const b = flow.bars; return { time: b.start[i]!, open: b.cvdOpen[i]!, high: b.cvdHigh[i]!, low: b.cvdLow[i]!, close: b.cvdClose(i) }; }, () => cvdOhlc(flow));
  return { series, dispose: () => (off(), chart.removeSeries(series)) };
}

export function attachDelta(chart: Chart, flow: OrderFlow, o: { up: string; down: string; pane?: number; title?: string }): CvdHandle {
  requireSides(flow, "delta");
  const upP = parseColor(o.up), downP = parseColor(o.down);
  const series = chart.addSeries("histogram", { pane: o.pane ?? 2, title: o.title ?? "Delta", color: o.up, priceFormat: { type: "volume" } });
  const off = follow(flow, series, (i) => ({ time: flow.bars.start[i]!, value: flow.bars.delta(i), color: flow.bars.delta(i) >= 0 ? o.up : o.down }), () => deltaValues(flow, upP, downP));
  return { series: series as never, dispose: () => (off(), chart.removeSeries(series)) };
}

/** Keep a series equal to a per-bar record: a change to only the newest bar is one update, else a re-set. */
function follow<B extends { time: number }>(flow: OrderFlow, series: { setData(d: never): void; update(b: B): void }, one: (i: number) => B, all: () => unknown): () => void {
  let known = 0;
  const sync = (c?: { firstBar: number; lastBar: number; appended: boolean }) => {
    const n = flow.bars.length;
    if (n === 0) return;
    if (c && known > 0 && c.firstBar === c.lastBar && c.lastBar === n - 1 && (c.appended ? known === n - 1 : known === n)) series.update(one(n - 1));
    else series.setData(all() as never);
    known = n;
  };
  sync();
  return flow.onChange(sync);
}
