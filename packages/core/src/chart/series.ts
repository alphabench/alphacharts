// Public handle for one series on a chart.

import type { ColumnarColors, ColumnarOhlc, ColumnarValue, OhlcBar, SeriesData, ValuePoint } from "../data/model.js";
import { COL_C, COL_H, COL_L, COL_O, COL_V } from "../data/model.js";
import type { SeriesRenderer2D } from "../render/canvas2d.js";
import type { SeriesRenderer } from "../render/renderers.js";
import { parseColor } from "../render/color.js";
import { createFormatter, decimalsOf, type Formatter } from "../scale/format.js";
import { checkMarkers, type SeriesMarker } from "./markers.js";
import type { PanePrimitive } from "./primitives.js";
import { seriesType, type CommonSeriesOptions, type SeriesOptions, type SeriesOptionsMap, type SeriesShapes, type SeriesType, type SeriesTypeDef } from "./series-types.js";
import type { Theme } from "./theme.js";

/** Input accepted by a series, from the shape its type declares. */
export type SeriesInput<T extends SeriesType> = SeriesShapes[T] extends "ohlc" ? readonly OhlcBar[] | ColumnarOhlc : readonly ValuePoint[] | ColumnarValue;
export type SeriesBar<T extends SeriesType> = SeriesShapes[T] extends "ohlc" ? OhlcBar : ValuePoint;

/** Rows sampled from each end when deriving decimals from the data. */
const SAMPLE = 2048;

/** Parse every *Color option now, so a bad value throws at the call site. */
function validateColors(options: object): void {
  const a = (options as { autoscale?: unknown }).autoscale;
  if (a !== undefined && typeof a !== "function") throw new TypeError(`alphacharts: series option autoscale must be a function, got ${typeof a}`);
  for (const [k, v] of Object.entries(options)) if (/color$/i.test(k) && v !== undefined) parseColor(v as string);
}

export const DEFAULT_COMMON: CommonSeriesOptions = {
  id: "",
  priceScaleId: "right",
  pane: 0,
  priceFormat: { type: "price" },
  scaleFormat: false,
  visible: true,
  lastValueVisible: true,
  priceLineVisible: true,
  title: "",
};

/** The chart side of a series: what Series calls back into. */
export interface SeriesHost {
  setData(s: Series<SeriesType>, input: unknown): void;
  prepend(s: Series<SeriesType>, input: unknown): void;
  update(s: Series<SeriesType>, bar: unknown): void;
  setColors(s: Series<SeriesType>, colors: ColumnarColors): void;
  clearColors(s: Series<SeriesType>): void;
  optionsChanged(s: Series<SeriesType>, paneOrScaleMoved: boolean): void;
  markersChanged(s: Series<SeriesType>): void;
  /** Pane-relative y of a price on the series' scale; NaN when the scale has no range yet. */
  priceToY(s: Series<SeriesType>, price: number): number;
  yToPrice(s: Series<SeriesType>, y: number): number;
  attachPrimitive(s: Series<SeriesType>, p: PanePrimitive): void;
  detachPrimitive(s: Series<SeriesType>, p: PanePrimitive): void;
  timeAt(index: number): number;
  indexOf(time: number): number | undefined;
  readonly locale: string | undefined;
}

export class Series<T extends SeriesType> {
  /** @internal */ renderer: SeriesRenderer<SeriesOptionsMap[T]> | null = null;
  /** @internal */ renderer2d: SeriesRenderer2D<SeriesOptionsMap[T]> | null = null;
  /** @internal */ readonly def: SeriesTypeDef<SeriesOptionsMap[T]>;
  /** @internal */ formatter: Formatter;
  /** Decimals seen in the data so far; only grows. */
  private dataDecimals = 0;
  private markerList: SeriesMarker[] = [];
  private user: Partial<SeriesOptions<T>>;
  private effective: SeriesOptions<T>;

  /** @internal */
  constructor(
    readonly type: T,
    /** Columnar bar store (read-only by contract): study packages read OHLC/value columns from it. */ readonly data: SeriesData,
    private readonly host: SeriesHost,
    options: Partial<SeriesOptions<T>>,
    theme: Theme,
  ) {
    this.def = seriesType(type);
    validateColors(options);
    this.user = { ...options };
    this.effective = this.resolve(theme);
    this.formatter = this.makeFormatter();
  }

  options(): Readonly<SeriesOptions<T>> {
    return this.effective;
  }

  applyOptions(options: Partial<SeriesOptions<T>>): void {
    validateColors(options);
    const prev = this.effective;
    this.user = { ...this.user, ...options };
    this.effective = this.resolveFrom(prev);
    if (this.effective.priceFormat !== prev.priceFormat) this.formatter = this.makeFormatter();
    this.host.optionsChanged(this as never, this.effective.pane !== prev.pane || this.effective.priceScaleId !== prev.priceScaleId);
  }

  /** Replace all data. Times are UTC ms, strictly increasing. */
  setData(data: SeriesInput<T>): void {
    this.host.setData(this as never, data);
  }

  /** Older history, all earlier than the first bar. */
  prepend(data: SeriesInput<T>): void {
    this.host.prepend(this as never, data);
  }

  /** Live bar: same time as the last bar replaces it, a later time appends. */
  update(bar: SeriesBar<T>): void {
    this.host.update(this as never, bar);
  }

  /**
   * Colour individual bars of a candle or OHLC-bar series (`colors.color`: packed 0xRRGGBBAA, 0 = the series' own up/down
   * colours), by time; a time with no bar is ignored. Colours belong to (series, time): `update`, `prepend` and `setData`
   * keep the colours of the bars they keep. Writing the colour a bar already has changes and redraws nothing.
   */
  setBarColors(this: Series<"candles" | "bars">, colors: ColumnarColors): void {
    this.host.setColors(this as never, colors);
  }

  /** Remove every bar colour (the colour column too): the series draws in its up/down colours again. */
  clearBarColors(this: Series<"candles" | "bars">): void {
    this.host.clearColors(this as never);
  }

  /** The bar at `time`, or undefined. Values are the exact inputs (Float64). */
  barAt(time: number): SeriesBar<T> | undefined {
    const i = this.host.indexOf(time);
    return i === undefined ? undefined : this.barAtIndex(i);
  }

  /** @internal */
  barAtIndex(i: number): SeriesBar<T> | undefined {
    const d = this.data;
    if (!d.has(i)) return undefined;
    const time = this.host.timeAt(i);
    if (d.shape === "ohlc") {
      return { time, open: d.get(i, COL_O), high: d.get(i, COL_H), low: d.get(i, COL_L), close: d.get(i, COL_C) } as SeriesBar<T>;
    }
    return { time, value: d.get(i, COL_V) } as SeriesBar<T>;
  }

  /** Index range of the series' bars on the chart's timeline. */
  range(): { first: number; last: number } | undefined {
    const first = this.data.firstIndex();
    const last = this.data.lastIndex();
    return first === undefined || last === undefined ? undefined : { first, last };
  }

  /**
   * Replace the series' markers (an empty array clears them). Every marker's
   * `time` must be the time of a bar of this series, else this throws naming
   * the marker and changes nothing; ids must be unique. Markers are not part of
   * `saveState`, like the bar data they annotate.
   */
  setMarkers(markers: readonly SeriesMarker[]): void {
    this.markerList = checkMarkers(markers, (t) => {
      const i = this.host.indexOf(t);
      return i !== undefined && this.data.has(i);
    });
    this.host.markersChanged(this as never);
  }

  /** The current markers, sorted by time. */
  markers(): readonly SeriesMarker[] {
    return this.markerList;
  }

  /**
   * CSS y within the pane of a price on this series' price scale, or NaN while
   * the scale has no range yet (no data, or before the chart's first frame).
   */
  priceToCoordinate(price: number): number {
    return this.host.priceToY(this as never, price);
  }

  /** Inverse of `priceToCoordinate`: the price at pane-relative CSS y; NaN while the scale has no range. */
  coordinateToPrice(y: number): number {
    return this.host.yToPrice(this as never, y);
  }

  formatPrice(p: number): string {
    return this.formatter.format(p);
  }

  attachPrimitive(p: PanePrimitive): void {
    this.host.attachPrimitive(this as never, p);
  }

  detachPrimitive(p: PanePrimitive): void {
    this.host.detachPrimitive(this as never, p);
  }

  /**
   * @internal Widen the derived precision to cover rows [lo, hi). Called by
   * the chart after every data change; samples the ends of large ranges.
   */
  observeData(lo: number, hi: number): void {
    const d = this.data;
    const col = d.shape === "ohlc" ? COL_C : COL_V;
    const cols = d.shape === "ohlc" ? [COL_O, COL_H, COL_L, COL_C] : [col];
    let dec = this.dataDecimals;
    const scan = (a: number, b: number) => {
      for (let i = a; i < b; i++) {
        if (!d.has(i)) continue;
        for (const c of cols) dec = Math.max(dec, decimalsOf(d.get(i, c)));
      }
    };
    if (hi - lo <= SAMPLE * 2) scan(lo, hi);
    else {
      scan(lo, lo + SAMPLE);
      scan(hi - SAMPLE, hi);
    }
    if (dec !== this.dataDecimals) {
      this.dataDecimals = dec;
      this.formatter = this.makeFormatter();
    }
  }

  private makeFormatter(): Formatter {
    return createFormatter(this.effective.priceFormat, 10 ** -this.dataDecimals, this.host.locale);
  }

  /** @internal Re-resolve defaults after a theme change. */
  themeChanged(theme: Theme): void {
    this.effective = this.resolve(theme);
  }

  private resolve(theme: Theme): SeriesOptions<T> {
    return { ...DEFAULT_COMMON, ...this.def.defaults(theme), ...this.user } as SeriesOptions<T>;
  }

  private resolveFrom(prev: SeriesOptions<T>): SeriesOptions<T> {
    return { ...prev, ...this.user } as SeriesOptions<T>;
  }
}
