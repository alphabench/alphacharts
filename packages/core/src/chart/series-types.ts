// Series type registry: the plugin seam for new series kinds.
//
// Built-in types register through the same call third parties use, so the
// contract is exercised by every chart. A type names its data shape (OHLC or
// single value), its default options (from the theme, so unset colours follow
// a theme switch), a WebGL renderer, and how it reports autoscale and the
// value shown on the price axis.

import type { SeriesData, SeriesShape } from "../data/model.js";
import { COL_C, COL_COLOR, COL_O, COL_V } from "../data/model.js";
import { cssColor } from "../render/color.js";
import { Area2D, Bars2D, Candles2D, Histogram2D, Line2D, type SeriesRenderer2D } from "../render/canvas2d.js";
import type { GLContext } from "../render/gl.js";
import {
  AreaRenderer, BarRenderer, CandleRenderer, HistogramRenderer, LineRenderer,
  type AreaStyle, type BarStyle, type CandleStyle, type HistogramStyle, type LineStyle, type SeriesRenderer,
} from "../render/renderers.js";
import type { PriceFormat } from "../scale/format.js";
import type { Theme } from "./theme.js";

/** Options every series has, whatever its type. */
export interface CommonSeriesOptions {
  /** Stable id within the chart (layouts, custom formatters); assigned when empty. */
  id: string;
  /** "right", "left", or any other id for an overlay scale with no axis. */
  priceScaleId: string;
  /** Index of the pane the series is drawn in; a new index adds a pane. */
  pane: number;
  /** How values are written. A price format without minMove takes it from the data. */
  priceFormat: PriceFormat;
  /**
   * This series formats its price axis. Otherwise the axis uses the first
   * non-volume series on the scale.
   */
  scaleFormat: boolean;
  visible: boolean;
  /** Label with the last value on the price axis. */
  lastValueVisible: boolean;
  /** Dashed line at the last value across the pane. */
  priceLineVisible: boolean;
  /** Tag next to the last-value label on the price axis side, inside the pane; only drawn when `lastValueVisible`. Empty shows nothing. */
  title: string;
  /**
   * Adjusts this series' contribution to its price scale's autoscale, after
   * the built-in min/max over the visible bars. `range` is null when the series
   * has nothing visible; return the range to use (null: contribute nothing).
   * Runs every frame: keep it cheap. A function is not saved by `saveState`,
   * so a restored layout has no override until it is set again.
   */
  autoscale?: (range: { low: number; high: number } | null) => { low: number; high: number } | null;
}

/** Built-in types. Plugins extend this interface by declaration merging. */
export interface SeriesOptionsMap {
  candles: CandleStyle;
  bars: BarStyle;
  line: LineStyle;
  area: AreaStyle;
  histogram: HistogramStyle;
}
export type SeriesType = keyof SeriesOptionsMap;

/** Data shape per type; plugins extend this alongside SeriesOptionsMap. */
export interface SeriesShapes {
  candles: "ohlc";
  bars: "ohlc";
  line: "value";
  area: "value";
  histogram: "value";
}
export type SeriesOptions<T extends SeriesType> = CommonSeriesOptions & SeriesOptionsMap[T];

export interface LastValue {
  value: number;
  /** CSS colour of the axis label. */
  color: string;
}

export interface SeriesTypeDef<O> {
  readonly shape: SeriesShape;
  defaults(theme: Theme): O & Partial<CommonSeriesOptions>;
  createRenderer(gl: WebGL2RenderingContext, ctx: GLContext, data: SeriesData): SeriesRenderer<O>;
  /** Canvas2D renderer, used when WebGL2 is unavailable. A type without one cannot draw there. */
  createRenderer2D?(data: SeriesData): SeriesRenderer2D<O>;
  /** [low, high] over indices [lo, hi] into `out`; NaN when nothing is there. */
  autoscale(data: SeriesData, options: O, lo: number, hi: number, out: Float64Array): void;
  /** Value and colour for the axis label at index i. */
  valueAt(data: SeriesData, options: O, i: number): LastValue | undefined;
}

const registry = new Map<string, SeriesTypeDef<unknown>>();

export function registerSeriesType<T extends SeriesType>(type: T, def: SeriesTypeDef<SeriesOptionsMap[T]>): void {
  const prev = registry.get(type);
  // Re-registering the same definition (HMR, a module loaded twice) is fine;
  // a different one under the same name is a conflict.
  if (prev === def) return;
  if (prev) throw new Error(`alphacharts: series type "${type}" is already registered with a different definition`);
  registry.set(type, def as SeriesTypeDef<unknown>);
}

export function seriesType<T extends SeriesType>(type: T): SeriesTypeDef<SeriesOptionsMap[T]> {
  const def = registry.get(type);
  if (!def) throw new Error(`alphacharts: unknown series type "${type}"`);
  return def as SeriesTypeDef<SeriesOptionsMap[T]>;
}

// ---- built-ins --------------------------------------------------------------

const lodRange = (d: SeriesData, _o: unknown, lo: number, hi: number, out: Float64Array) => void d.lod.minMax(lo, hi, out);

function ohlcValue(d: SeriesData, i: number, up: string, down: string): LastValue | undefined {
  if (!d.has(i)) return undefined;
  const c = d.get(i, COL_C);
  return { value: c, color: c >= d.get(i, COL_O) ? up : down };
}

registerSeriesType("candles", {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down, wickUpColor: t.up, wickDownColor: t.down }),
  createRenderer: (gl, ctx, d) => new CandleRenderer(gl, ctx, d),
  createRenderer2D: () => new Candles2D(),
  autoscale: lodRange,
  valueAt: (d, o, i) => ohlcValue(d, i, o.upColor, o.downColor),
});

registerSeriesType("bars", {
  shape: "ohlc",
  defaults: (t) => ({ upColor: t.up, downColor: t.down }),
  createRenderer: (gl, ctx, d) => new BarRenderer(gl, ctx, d),
  createRenderer2D: () => new Bars2D(),
  autoscale: lodRange,
  valueAt: (d, o, i) => ohlcValue(d, i, o.upColor, o.downColor),
});

registerSeriesType("line", {
  shape: "value",
  defaults: (t) => ({ color: t.accent, lineWidth: 2 }),
  createRenderer: (gl, ctx, d) => new LineRenderer(gl, ctx, d),
  createRenderer2D: () => new Line2D(),
  autoscale: lodRange,
  valueAt: (d, o, i) => (d.has(i) ? { value: d.get(i, COL_V), color: o.color } : undefined),
});

registerSeriesType("area", {
  shape: "value",
  defaults: (t) => ({ lineColor: t.accent, topColor: "rgba(41,98,255,0.28)", bottomColor: "rgba(41,98,255,0.02)", lineWidth: 2 }),
  createRenderer: (gl, ctx, d) => new AreaRenderer(gl, ctx, d),
  createRenderer2D: () => new Area2D(),
  autoscale: lodRange,
  valueAt: (d, o, i) => (d.has(i) ? { value: d.get(i, COL_V), color: o.lineColor } : undefined),
});

registerSeriesType("histogram", {
  shape: "value",
  defaults: (t) => ({ color: t.accent, base: 0 }),
  createRenderer: (gl, ctx, d) => new HistogramRenderer(gl, ctx, d),
  createRenderer2D: () => new Histogram2D(),
  autoscale: (d, o, lo, hi, out) => {
    d.lod.minMax(lo, hi, out);
    if (out[0]! === out[0]!) {
      out[0] = Math.min(out[0]!, o.base);
      out[1] = Math.max(out[1]!, o.base);
    }
  },
  valueAt: (d, o, i) => {
    if (!d.has(i)) return undefined;
    const c = d.get(i, COL_COLOR);
    return { value: d.get(i, COL_V), color: c !== 0 ? cssColor(c) : o.color };
  },
});
