// @alphacharts/core public API.

import { Chart, type ChartOptionsInput } from "./chart/chart.js";

export { Chart } from "./chart/chart.js";
export { Dashboard } from "./chart/dashboard.js";
export { LAYOUT_VERSION, LocalStorageStore, MemoryStore, migrate } from "./chart/layout.js";
export type { ChartState, CustomOption, LayoutStore, PaneState, ScaleState, SeriesState } from "./chart/layout.js";
export type { DashboardOptions } from "./chart/dashboard.js";
export type { ChartEvents, ChartOptions, Region, ChartOptionsInput, CrosshairEvent, CrosshairOptions, GridOptions, HoveredObject, InteractionOptions, VisibleRangeEvent } from "./chart/chart.js";
export { Series } from "./chart/series.js";
export type { ChartPlugin, PluginApi, PluginPaneView, PluginPointer } from "./chart/plugin.js";
export type { SeriesBar, SeriesInput } from "./chart/series.js";
export { registerSeriesType } from "./chart/series-types.js";
export type { CommonSeriesOptions, LastValue, SeriesOptions, SeriesOptionsMap, SeriesType, SeriesTypeDef } from "./chart/series-types.js";
export { BarShading, PriceLine, crisp, dashPattern } from "./chart/primitives.js";
export type { SeriesMarker, MarkerPosition, MarkerShape } from "./chart/markers.js";
export type { AxisLabel, LineDash, PanePrimitive, PaneView, PriceLineOptions, PrimitiveHit, PrimitiveHost, RenderLayer } from "./chart/primitives.js";
export { DARK, HIGH_CONTRAST, LIGHT, systemTheme } from "./chart/theme.js";
export { CHART_MESSAGES, defaultMessages } from "./chart/messages.js";
export type { ChartMessageKey, ChartMessages, ChartMessageValues } from "./chart/messages.js";
export { DEFAULT_KEYMAP } from "./chart/chart.js";
export { checkWatermarkOptions, DEFAULT_WATERMARK, drawWatermark } from "./chart/watermark.js";
export type { WatermarkOptions } from "./chart/watermark.js";
export type { KeyAction } from "./chart/chart.js";
export { ALWAYS_OPEN, NSE, Sessions, US_EQUITY, weekdays } from "./data/session.js";
export type { SessionSpec, SessionState, Window } from "./data/session.js";
export { parseResolution, Resampler } from "./data/resample.js";
export type { Resolution, ResolutionUnit, ResampledBar } from "./data/resample.js";
export type { Theme } from "./chart/theme.js";
export { SyncGroup } from "./interaction/sync.js";
export type { SyncOptions } from "./interaction/sync.js";
export { connectDatafeed } from "./feed/datafeed.js";
export type { BarsRequest, BarsResponse, Datafeed, FeedController, FeedOptions, Trade, TradesRequest } from "./feed/datafeed.js";
export type { ColumnarColors, ColumnarOhlc, ColumnarValue, OhlcBar, ValuePoint } from "./data/model.js";
export type { PriceScaleOptions } from "./scale/price-scale.js";
export type { TimeScaleOptions } from "./scale/time-scale.js";
export type { TimeLabel } from "./scale/ticks.js";
export type { DataChange, SeriesData, SeriesShape } from "./data/model.js";
export { COL_BAR_COLOR, COL_C, COL_COLOR, COL_H, COL_L, COL_O, COL_V } from "./data/model.js";
export { LOD_BASE, LOD_C, LOD_COLOR, LOD_H, LOD_L, LOD_O } from "./data/lod.js";
export { parseColor, rgba, cssColor } from "./render/color.js";
export { barWidths } from "./render/renderers.js";
export type { CandleStyle, BarStyle, LineStyle, AreaStyle, HistogramStyle } from "./render/renderers.js";
export type { DrawView2D, SeriesRenderer2D } from "./render/canvas2d.js";
export type { SeriesShapes } from "./chart/series-types.js";
export type { PriceFormat, Formatter } from "./scale/format.js";
// Scale utilities the plot package (and hosts) build on: nice ticks, number formats, calendar time zones.
export { niceStep, niceTicks, PriceFormatter } from "./scale/ticks.js";
export { createFormatter, decimalsOf, isIndianLocale } from "./scale/format.js";
export { civilFromLocal, DAY_MS, localFromCivil, TimeZone } from "./data/tz.js";
export type { CivilTime } from "./data/tz.js";
export type { PriceScaleMode } from "./scale/price-scale.js";
export type { DrawView, SeriesRenderer } from "./render/renderers.js";

/** One-liner: `const chart = createChart(el, { theme: "light" })`. */
export function createChart(container: HTMLElement, options?: ChartOptionsInput): Chart {
  return new Chart(container, options);
}
