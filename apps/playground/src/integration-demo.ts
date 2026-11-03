// ?ex=integration — what a host application needs of the core: series
// markers with ids, a background primitive with hit ids, every price line
// style, the series title tag, grid / crosshair-label / minWidth / timeFormat
// options, an autoscale override and the coordinate helpers.
// window.__fe carries the pieces for bench/tests/integration.spec.ts.

import { createChart, type Chart, type PanePrimitive, type PaneView, type PrimitiveHost, type PriceLine, type Series, type SeriesMarker, type Theme } from "@alphacharts/core";
import { ohlc } from "./synthetic.js";

const N = 240;
const STEP = 5 * 60_000;
/** Fixed end so the picture does not move with the clock. */
const END = Date.UTC(2026, 9, 20, 9, 55);

/** A price band behind the candles and a shaded time span; both answer hit tests with ids. */
class BandPrimitive implements PanePrimitive {
  view: PaneView | null = null;
  host: PrimitiveHost | null = null;
  /** How many times the background layer painted this primitive. */
  bgDraws = 0;
  constructor(readonly low: number, readonly high: number, readonly t0: number, readonly t1: number) {}
  attached(host: PrimitiveHost): void {
    this.host = host;
  }
  drawBackground(ctx: CanvasRenderingContext2D, view: PaneView): void {
    this.view = view;
    this.bgDraws++;
    const y1 = view.y(this.high), y2 = view.y(this.low);
    ctx.fillStyle = "rgba(41,98,255,0.14)";
    ctx.fillRect(0, y1, view.width, y2 - y1);
    const x1 = view.timeToX(this.t0), x2 = view.timeToX(this.t1);
    ctx.fillStyle = "rgba(247,166,0,0.12)";
    ctx.fillRect(x1, 0, x2 - x1, view.height);
  }
  hitTest(x: number, y: number, view: PaneView): { id: string; cursor?: string } | null {
    const y1 = view.y(this.high), y2 = view.y(this.low);
    if (y >= y1 && y <= y2) return { id: "band", cursor: "ns-resize" };
    const x1 = view.timeToX(this.t0), x2 = view.timeToX(this.t1);
    if (x >= x1 && x <= x2) return { id: "span" };
    return null;
  }
}

export interface IntegrationDemo {
  chart: Chart;
  candles: Series<"candles">;
  band: BandPrimitive;
  lines: PriceLine[];
  farPrice: number;
  events: { type: string; hovered?: { kind: string; id: string } }[];
  lastClose: number;
  bars: ReturnType<typeof ohlc>;
  createChart: typeof createChart;
}

export function runIntegrationDemo(app: HTMLElement, theme: Theme, extra: Record<string, unknown>): Chart {
  const d = ohlc(N, 21, END, STEP, 1000);
  const chart = createChart(app, {
    theme,
    timeZone: "Asia/Kolkata",
    locale: "en-GB",
    grid: { vertLines: false, horzLines: true },
    crosshair: { priceLabel: false },
    timeFormat: { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    rightPriceScale: { minWidth: 96 },
  });
  const hi = Math.max(...d.high), lo = Math.min(...d.low);
  const range = hi - lo;
  const farPrice = Math.round(hi + range * 2.2);
  const candles = chart.addSeries("candles", {
    title: "SYNTH",
    priceFormat: { type: "price", minMove: 0.05 },
    // The far target must stay on screen whatever the bars do.
    autoscale: (r) => ({ low: Math.min(r?.low ?? farPrice, farPrice), high: Math.max(r?.high ?? farPrice, farPrice) }),
  });
  candles.setData(d);
  const lastClose = d.close[N - 1]!;
  chart.timeScale.setVisibleLogicalRange({ from: N - 80, to: N + 6 });

  const mid = (hi + lo) / 2;
  const band = new BandPrimitive(mid - range * 0.25, mid + range * 0.25, d.time[N - 60]!, d.time[N - 45]!);
  candles.attachPrimitive(band);

  const styles = ["solid", "dashed", "dotted", "large-dashed", "sparse-dotted"] as const;
  const lines = styles.map((lineStyle, i) =>
    chart.createPriceLine(candles, {
      price: hi + range * (0.3 + i * 0.35),
      lineStyle,
      lineWidth: i % 2 ? 2 : 1,
      color: ["#f7a600", "#ab47bc", "#26c6da", "#ef5350", "#66bb6a"][i]!,
      title: lineStyle,
      ...(i === 1 ? { axisLabelColor: "#1b5e20", labelTextColor: "#ffffff" } : {}),
    }),
  );
  lines.push(chart.createPriceLine(candles, { price: farPrice, color: "#2962ff", lineStyle: "large-dashed", lineWidth: 2, title: "far target" }));

  // Markers: on bars of the series; two on one bar stack; one has no id.
  const at = (k: number) => d.time[N - k]!;
  const markers: SeriesMarker[] = [
    { time: at(30), position: "belowBar", shape: "arrowUp", color: "#26a69a", text: "Buy", id: "m-buy" },
    { time: at(20), position: "aboveBar", shape: "arrowDown", color: "#ef5350", text: "Sell", id: "m-sell" },
    { time: at(12), position: "aboveBar", shape: "circle", color: "#f7a600", id: "m-stack-1" },
    { time: at(12), position: "aboveBar", shape: "circle", color: "#ab47bc", text: "2nd", id: "m-stack-2", size: 1.3 },
    { time: at(12), position: "belowBar", shape: "arrowUp", color: "#26c6da" },
  ];
  candles.setMarkers(markers);

  const events: IntegrationDemo["events"] = [];
  for (const type of ["crosshairMove", "click", "dblclick"] as const) {
    chart.on(type, (e) => events.push({ type, ...(e.hovered ? { hovered: e.hovered } : {}) }));
  }
  const fe: IntegrationDemo = { chart, candles, band, lines, farPrice, events, lastClose, bars: d, createChart };
  extra.__fe = fe;
  return chart;
}
