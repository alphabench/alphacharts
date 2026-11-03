// Footprint chart: a series type ("footprint") plus an overlay for its text.
//
// The series holds the bars' OHLC (from the trades) so the chart's timeline,
// autoscale, axis and crosshair work as for any candle series; the levels live
// in the OrderFlow and are reached through `options.source`. Cells, imbalance
// highlights, POC boxes and the shaded-candle fallback are rectangles built by
// footprint-layout.ts: WebGL2 instanced quads on the GL layer, or Canvas2D fills
// when the chart has no WebGL2. The numbers are printed on the overlay (Canvas2D
// text) only for cells large enough to read them.
//
// Use `attachFootprint(chart, flow, options)`; it creates the series, the
// overlay, and keeps the series in step with the flow.

import { COL_C, COL_H, COL_L, COL_O, parseColor, registerSeriesType, type Chart, type DataChange, type DrawView, type DrawView2D, type PaneView, type PanePrimitive, type PrimitiveHost, type Series, type SeriesData, type SeriesOptions, type SeriesRenderer, type SeriesRenderer2D, type Theme } from "@alphacharts/core";
import { GLContext, GLSL_COMMON } from "@alphacharts/core/internal";
import type { FlowChange, OrderFlow } from "./flow.js";
import {
  analyzeBar, buildRects, cellTexts, effectiveMode, lodFor, minRowCss, RectBatch, rowSpan, validateParams, volumeText,
  type BarAnalysis, type CellMode, type FootprintColors, type FootprintParams, type Lod, type RectView,
} from "./footprint-layout.js";

export interface FootprintStyle extends FootprintParamsInput {
  /** Set by attachFootprint; a footprint series without a source draws nothing. */
  source: FootprintSource | null;
  upColor: string;
  downColor: string;
  buyColor: string;
  sellColor: string;
  neutralColor: string;
  imbalanceBuyColor: string;
  imbalanceSellColor: string;
  pocColor: string;
  unfinishedColor: string;
  textColor: string;
}

/** The tunable part of FootprintParams, as options. */
export interface FootprintParamsInput {
  /** bidAsk: sell × buy volume per price; delta: buy − sell; volume: all volume. */
  mode: CellMode;
  /** Imbalance when the diagonal opposite side is this many times smaller. */
  imbalanceRatio: number;
  /** ... and the dominant side holds at least this much volume. */
  imbalanceMinVolume: number;
  /** Consecutive same-side imbalances that count as stacked (>= 2). */
  stackedImbalances: number;
  showPoc: boolean;
  showUnfinished: boolean;
  /** Below this level height (CSS px) the bar falls back to a shaded candle. */
  minCellHeight: number;
  /** Below this bar width (CSS px) the bar falls back to a shaded candle. */
  minBarWidth: number;
}

declare module "@alphacharts/core" {
  interface SeriesOptionsMap {
    footprint: FootprintStyle;
  }
  interface SeriesShapes {
    footprint: "ohlc";
  }
}

const paramsOf = (o: FootprintParamsInput): FootprintParams => ({
  mode: o.mode, imbalanceRatio: o.imbalanceRatio, imbalanceMinVolume: o.imbalanceMinVolume, stackedImbalances: o.stackedImbalances,
  showPoc: o.showPoc, showUnfinished: o.showUnfinished, minCellHeight: o.minCellHeight, minBarWidth: o.minBarWidth,
});

const colorsOf = (o: FootprintStyle): FootprintColors => ({
  up: parseColor(o.upColor), down: parseColor(o.downColor), buy: parseColor(o.buyColor), sell: parseColor(o.sellColor), neutral: parseColor(o.neutralColor),
  imbalanceBuy: parseColor(o.imbalanceBuyColor), imbalanceSell: parseColor(o.imbalanceSellColor), poc: parseColor(o.pocColor), unfinished: parseColor(o.unfinishedColor),
});

/** Binds a series to its OrderFlow and the chart's timeline; caches per-bar analysis. */
export class FootprintSource {
  private readonly cache = new Map<number, { version: number; key: string; a: BarAnalysis; closed: boolean }>();

  constructor(readonly flow: OrderFlow, private readonly chart: Pick<Chart, "logicalToTime" | "timeToLogical">) {}

  /** Flow bar row at a timeline index, or -1. */
  barAt(index: number): number {
    return this.flow.bars.indexOfStart(this.chart.logicalToTime(index));
  }

  /** Fractional timeline index of a time (extrapolated past the data). */
  logical(time: number): number {
    return this.chart.timeToLogical(time);
  }

  analysis(bar: number, p: FootprintParams): BarAnalysis {
    const bars = this.flow.bars;
    const key = `${p.imbalanceRatio}:${p.imbalanceMinVolume}:${p.stackedImbalances}`;
    const hit = this.cache.get(bar);
    if (hit && hit.key === key && (hit.closed || hit.version === bars.version)) return hit.a;
    const a = analyzeBar(bars, bar, p);
    if (this.cache.size > 2048) this.cache.clear();
    // Closed only if a later bar existed when analysed: then no trade can reach it any more.
    this.cache.set(bar, { version: bars.version, key, a, closed: bar < bars.length - 1 });
    return a;
  }
}

// ---- views ----------------------------------------------------------------------------

interface CoreView {
  readonly data: SeriesData;
  readonly time: { x(i: number): number; spacing: number };
  readonly price: { y(p: number): number; price(y: number): number };
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly lo: number;
  readonly hi: number;
}

function rectView(v: CoreView, source: FootprintSource): RectView {
  const d = v.data, dpr = v.dpr;
  return {
    dpr, width: v.width, height: v.height, spacing: v.time.spacing, lo: v.lo, hi: v.hi,
    xOf: (i) => v.time.x(i) * dpr,
    yOf: (p) => v.price.y(p) * dpr,
    priceAt: (y) => v.price.price(y / dpr),
    barAt: (i) => source.barAt(i),
    open: (i) => d.get(i, COL_O),
    high: (i) => d.get(i, COL_H),
    low: (i) => d.get(i, COL_L),
    close: (i) => d.get(i, COL_C),
    range: (a, b, out) => d.lod.minMax(a, b, out),
  };
}

// ---- WebGL2 ---------------------------------------------------------------------------

const VS = GLSL_COMMON + /* glsl */ `
in vec4 a_rect; in vec4 a_col;
out vec4 v_color;
void main() {
  vec2 cr = corner(gl_VertexID);
  gl_Position = vec4(toClip(vec2(mix(a_rect.x, a_rect.z, cr.x), mix(a_rect.y, a_rect.w, cr.y))), 0.0, 1.0);
  v_color = a_col;
}`;
const FS = /* glsl */ `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o_color;
void main() { o_color = vec4(v_color.rgb * v_color.a, v_color.a); }
`;

class FootprintGL implements SeriesRenderer<FootprintStyle> {
  private readonly prog;
  private readonly vao: WebGLVertexArrayObject;
  private readonly xyBuf: WebGLBuffer;
  private readonly colBuf: WebGLBuffer;
  private readonly batch = new RectBatch();
  /** LOD of the last frame (read by tests). */
  lod: Lod = "plain";

  constructor(private readonly gl: WebGL2RenderingContext, ctx: GLContext) {
    this.prog = ctx.program("orderflow-footprint", VS, FS, [], ["a_rect", "a_col"]);
    this.vao = gl.createVertexArray();
    this.xyBuf = gl.createBuffer();
    this.colBuf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    const a = this.prog.attribs;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.xyBuf);
    gl.enableVertexAttribArray(a.a_rect!);
    gl.vertexAttribPointer(a.a_rect!, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(a.a_rect!, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.enableVertexAttribArray(a.a_col!);
    gl.vertexAttribPointer(a.a_col!, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    gl.vertexAttribDivisor(a.a_col!, 1);
    gl.bindVertexArray(null);
  }

  draw(v: DrawView, o: FootprintStyle): void {
    if (!o.source) return;
    const p = paramsOf(o);
    validateParams(p);
    const src = o.source;
    this.batch.clear();
    this.lod = buildRects(this.batch, rectView(v, src), src.flow, p, colorsOf(o), (bar) => src.analysis(bar, p));
    const n = this.batch.n;
    if (n === 0) return;
    const gl = this.gl;
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.prog.uniforms.u_view!, v.width, v.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.xyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.xy.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    // Packed 0xRRGGBBAA as a little-endian uint reads A,B,G,R: swap to byte order R,G,B,A.
    gl.bufferData(gl.ARRAY_BUFFER, bytesRGBA(this.batch.rgba, n), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
  }

  dataChanged(_c: DataChange): void {}

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.xyBuf);
    this.gl.deleteBuffer(this.colBuf);
  }
}

let bytes = new Uint8Array(0);
function bytesRGBA(c: Uint32Array, n: number): Uint8Array {
  if (bytes.length < n * 4) bytes = new Uint8Array(Math.max(n * 4, bytes.length * 2));
  for (let i = 0; i < n; i++) {
    const v = c[i]!;
    bytes[i * 4] = v >>> 24;
    bytes[i * 4 + 1] = (v >>> 16) & 255;
    bytes[i * 4 + 2] = (v >>> 8) & 255;
    bytes[i * 4 + 3] = v & 255;
  }
  return bytes.subarray(0, n * 4);
}

// ---- Canvas2D fallback ------------------------------------------------------------------

const cssOf = new Map<number, string>();
const css = (c: number): string => {
  let s = cssOf.get(c);
  if (!s) {
    if (cssOf.size > 4096) cssOf.clear();
    s = `rgba(${c >>> 24},${(c >>> 16) & 255},${(c >>> 8) & 255},${((c & 255) / 255).toFixed(3)})`;
    cssOf.set(c, s);
  }
  return s;
};

class Footprint2D implements SeriesRenderer2D<FootprintStyle> {
  private readonly batch = new RectBatch();
  lod: Lod = "plain";

  draw(v: DrawView2D, o: FootprintStyle): void {
    if (!o.source) return;
    const p = paramsOf(o);
    validateParams(p);
    const src = o.source;
    this.batch.clear();
    this.lod = buildRects(this.batch, rectView(v, src), src.flow, p, colorsOf(o), (bar) => src.analysis(bar, p));
    const { xy, rgba, n } = this.batch;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (rgba[i] !== last) {
        last = rgba[i]!;
        v.ctx.fillStyle = css(last);
      }
      v.ctx.fillRect(xy[i * 4]!, xy[i * 4 + 1]!, xy[i * 4 + 2]! - xy[i * 4]!, xy[i * 4 + 3]! - xy[i * 4 + 1]!);
    }
  }
  dataChanged(): void {}
  dispose(): void {}
}

// ---- series type ------------------------------------------------------------------------

export const FOOTPRINT_DEFAULTS = {
  mode: "bidAsk" as CellMode,
  imbalanceRatio: 3,
  imbalanceMinVolume: 1,
  stackedImbalances: 3,
  showPoc: true,
  showUnfinished: true,
  minCellHeight: 10,
  minBarWidth: 40,
};

registerSeriesType("footprint", {
  shape: "ohlc",
  defaults: (t: Theme): FootprintStyle => ({
    source: null,
    ...FOOTPRINT_DEFAULTS,
    upColor: t.up, downColor: t.down, buyColor: t.up, sellColor: t.down, neutralColor: t.accent,
    imbalanceBuyColor: "#00e676", imbalanceSellColor: "#ff1744", pocColor: "#ffc107", unfinishedColor: "#ab47bc", textColor: t.text,
  }),
  createRenderer: (gl, ctx) => new FootprintGL(gl, ctx),
  createRenderer2D: () => new Footprint2D(),
  autoscale: (d, _o, lo, hi, out) => void d.lod.minMax(lo, hi, out),
  valueAt: (d, o, i) => (d.has(i) ? { value: d.get(i, COL_C), color: d.get(i, COL_C) >= d.get(i, COL_O) ? o.upColor : o.downColor } : undefined),
});

// ---- overlay ----------------------------------------------------------------------------

/** Prints the numbers on readable cells, the POC/imbalance legend and the LOD / approximation labels. */
export class FootprintOverlay implements PanePrimitive {
  private host: PrimitiveHost | null = null;
  private readonly widths = new Map<string, number>();
  /** LOD and text count of the last frame (read by tests). */
  last: { lod: Lod; texts: number } = { lod: "plain", texts: 0 };

  constructor(private readonly source: FootprintSource, private readonly options: () => Readonly<SeriesOptions<"footprint">>) {}

  attached(host: PrimitiveHost): void {
    this.host = host;
  }
  detached(): void {
    this.host = null;
  }

  draw(ctx: CanvasRenderingContext2D, view: PaneView): void {
    const o = this.options();
    const src = this.source, flow = src.flow, bars = flow.bars;
    if (!o.visible || bars.length === 0) return;
    const p = paramsOf(o);
    const dpr = view.dpr;
    const rv: RectView = {
      dpr, width: view.width * dpr, height: view.height * dpr, spacing: view.x(view.lo + 1) - view.x(view.lo), lo: view.lo, hi: view.hi,
      xOf: (i) => view.x(i) * dpr, yOf: (pr) => view.y(pr) * dpr, priceAt: (y) => view.price(y / dpr),
      barAt: (i) => src.barAt(i),
      open: () => Number.NaN, high: () => Number.NaN, low: () => Number.NaN, close: () => Number.NaN, range: () => {},
    };
    const rowCss = minRowCss(rv, bars.tickSize);
    const lod = lodFor(rv.spacing, rowCss, p);
    ctx.save();
    ctx.textBaseline = "middle";
    let texts = 0;
    if (lod === "cells") {
      const fontPx = Math.min(11, Math.floor(rowCss) - 2);
      if (fontPx >= 8) {
        const font = `${fontPx}px ${"system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"}`;
        ctx.font = font;
        ctx.fillStyle = o.textColor;
        cellTexts(rv, flow, p, (bar) => src.analysis(bar, p), (t) => {
          const w = (t.x1 - t.x0) / dpr - 4;
          let s = volumeText(t.value, true);
          if (this.width(ctx, font, s, t.bold) > w) s = volumeText(t.value, false);
          if (this.width(ctx, font, s, t.bold) > w) return; // not readable at this size: leave the colour only
          ctx.font = t.bold ? `bold ${font}` : font;
          if (t.side === "bid") {
            ctx.textAlign = "right";
            ctx.fillText(s, t.x1 / dpr - 3, t.yMid / dpr);
          } else if (t.side === "ask") {
            ctx.textAlign = "left";
            ctx.fillText(s, t.x0 / dpr + 3, t.yMid / dpr);
          } else {
            ctx.textAlign = "center";
            ctx.fillText(s, (t.x0 + t.x1) / 2 / dpr, t.yMid / dpr);
          }
          texts++;
        });
        this.footers(ctx, rv, o, p, font);
      }
    }
    // Labels: what the viewer is looking at, never left implicit.
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    let y = view.height - 6;
    const label = (s: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillText(s, 8, y);
      y -= 14;
    };
    if (flow.approximate) {
      label("no buy/sell sides, no delta, no imbalance", "#ffb300");
      label("APPROXIMATE: from bars, not trades; volume spread evenly over each bar's range", "#ffb300");
    }
    if (lod !== "cells") label(lod === "shaded" ? "Zoomed out: candles shaded by volume at price. Zoom in for footprint cells." : "Zoomed out: plain candles. Zoom in for footprint cells.", o.textColor);
    ctx.restore();
    this.last = { lod, texts };
  }

  /** Per bar, under its lowest level: delta, and unknown-side volume when there is any. */
  private footers(ctx: CanvasRenderingContext2D, rv: RectView, o: Readonly<SeriesOptions<"footprint">>, p: FootprintParams, font: string): void {
    const bars = this.source.flow.bars;
    if (this.source.flow.approximate) return;
    ctx.font = font;
    ctx.textAlign = "center";
    const ref = rv.priceAt(rv.height / 2);
    const inverted = rv.yOf(ref + bars.tickSize) > rv.yOf(ref);
    for (let i = rv.lo; i <= rv.hi; i++) {
      const bar = rv.barAt(i);
      if (bar < 0) continue;
      const a = this.source.analysis(bar, p);
      const x = rv.xOf(i) / rv.dpr;
      // Under the bar's lowest level; above it when the scale is inverted (the lowest price is then the highest on screen).
      const [rowTop, rowBottom] = rowSpan(rv, bars, a.kLo);
      let y = (inverted ? rowTop : rowBottom) / rv.dpr + (inverted ? -8 : 8);
      const d = bars.delta(bar);
      if (inverted ? y > 14 : y < rv.height / rv.dpr - 6) {
        ctx.fillStyle = d >= 0 ? o.buyColor : o.sellColor;
        ctx.fillText(`Δ ${d > 0 ? "+" : ""}${volumeText(d, false)}`, x, y);
      }
      y += inverted ? -12 : 12;
      if (bars.unknown[bar]! > 0 && (inverted ? y > 14 : y < rv.height / rv.dpr - 6)) {
        ctx.fillStyle = o.textColor;
        ctx.fillText(`unk ${volumeText(bars.unknown[bar]!, false)}`, x, y);
      }
    }
  }

  private width(ctx: CanvasRenderingContext2D, font: string, s: string, bold: boolean): number {
    const k = `${bold ? "b" : ""}${font}|${s}`;
    let w = this.widths.get(k);
    if (w === undefined) {
      if (this.widths.size > 5000) this.widths.clear();
      ctx.font = bold ? `bold ${font}` : font;
      w = ctx.measureText(s).width;
      this.widths.set(k, w);
    }
    return w;
  }
}

// ---- attach -----------------------------------------------------------------------------

export interface FootprintHandle {
  readonly series: Series<"footprint">;
  readonly source: FootprintSource;
  readonly overlay: FootprintOverlay;
  dispose(): void;
}

export function barsToOhlc(flow: OrderFlow, from = 0, to = flow.bars.length) {
  const b = flow.bars;
  return { time: b.start.slice(from, to), open: b.open.slice(from, to), high: b.high.slice(from, to), low: b.low.slice(from, to), close: b.close.slice(from, to) };
}

/**
 * Keep `series` equal to the flow's bars as OHLC: a live change touching only
 * the newest bar is one `update`, anything else re-sets the series.
 */
export function followBars(flow: OrderFlow, series: { setData(d: ReturnType<typeof barsToOhlc>): void; update(b: { time: number; open: number; high: number; low: number; close: number }): void }): () => void {
  let known = 0;
  const sync = (c?: FlowChange) => {
    const b = flow.bars;
    if (b.length === 0) return;
    if (c && known > 0 && c.firstBar === c.lastBar && c.lastBar === b.length - 1 && (c.appended ? known === b.length - 1 : known === b.length)) {
      const i = c.lastBar;
      series.update({ time: b.start[i]!, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]! });
    } else series.setData(barsToOhlc(flow));
    known = b.length;
  };
  sync();
  return flow.onChange(sync);
}

export function attachFootprint(chart: Chart, flow: OrderFlow, options: Partial<SeriesOptions<"footprint">> = {}): FootprintHandle {
  const source = new FootprintSource(flow, chart);
  const series = chart.addSeries("footprint", { priceFormat: { type: "price", minMove: flow.bars.tickSize }, ...options, source });
  const overlay = new FootprintOverlay(source, () => series.options());
  series.attachPrimitive(overlay);
  const off = followBars(flow, series as never);
  return {
    series, source, overlay,
    dispose() {
      off();
      series.detachPrimitive(overlay);
      chart.removeSeries(series);
    },
  };
}
