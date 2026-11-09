// Chart plugins: the seam for drawing tools, studies, alerts and anything
// else that lives on a chart rather than on one series.
//
// A plugin is installed once per chart and receives:
// - data and view changes,
// - pointer and key events first; returning true consumes the event, so a
//   drawing tool can capture a drag that would otherwise pan the chart,
// - a per-pane draw call on the overlay layer (CSS px, pane origin, clipped),
// - toJSON/fromJSON for layout persistence.
//
// Positions that must survive data changes are kept as time + price, never as
// a timeline index: indices move when another series adds interior times.
// PluginApi converts both ways and extrapolates time past the last bar using
// the recent bar interval, so a drawing can extend into the future.

import type { DataChange } from "../data/model.js";
import type { Theme } from "./theme.js";

export interface PluginPointer {
  type: "down" | "move" | "up" | "click" | "dblclick" | "leave";
  /** Pane index and pane-relative CSS px. */
  pane: number;
  x: number;
  y: number;
  /** Time under the pointer (UTC ms), extrapolated beyond the data. */
  time: number;
  /** Price under the pointer on the pane's main scale. */
  price: number;
  pointerType: string;
  buttons: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface PluginPaneView {
  readonly pane: number;
  /** Pane size in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  timeToX(time: number): number;
  xToTime(x: number): number;
  /** Price ↔ y on the pane's scale `scaleId` (default: its main scale). */
  priceToY(price: number, scaleId?: string): number;
  yToPrice(y: number, scaleId?: string): number;
  formatPrice(price: number, scaleId?: string): string;
  /**
   * Mode of the pane's price scale `scaleId` (default: its main scale). Straight
   * in pixels is straight in price on linear, percent and indexed scales (their
   * y is affine in price) but not on a log scale. Optional so existing
   * implementers keep compiling; a view without it is read as linear.
   */
  priceScaleMode?(scaleId?: string): "linear" | "log" | "percent" | "indexed";
}

export interface PluginApi {
  /** Redraw the overlay (cheap) or everything. */
  requestRender(all?: boolean): void;
  readonly paneCount: number;
  paneView(pane: number): PluginPaneView;
  /** Bar time at or before `time`, if any: for snapping to bars. */
  barTimeAtOrBefore(time: number): number | undefined;
  /** Cursor while the pointer is over the chart; null restores the default. */
  setCursor(css: string | null): void;
  /** The chart's current theme: what colour slots ("chart-1", "chart-up" …, see `resolveColor`) draw with. */
  readonly theme: Theme;
}

export interface ChartPlugin {
  /** Unique per chart; also the key of its state in layout JSON. */
  readonly id: string;
  install(api: PluginApi): void;
  uninstall?(): void;
  dataChanged?(change: DataChange): void;
  viewChanged?(): void;
  /** Return true to consume the event (the chart will not pan, zoom or move its crosshair). */
  pointer?(e: PluginPointer): boolean | void;
  key?(e: KeyboardEvent): boolean | void;
  /** Overlay drawing for one pane: CSS px, origin at the pane's top-left, clipped. */
  drawPane?(ctx: CanvasRenderingContext2D, view: PluginPaneView): void;
  /** CSS cursor at a pane point when idle, or null. */
  cursor?(pane: number, x: number, y: number): string | null;
  toJSON?(): unknown;
  /** Apply a saved state. Called by `restoreState` after the layout's series exist. */
  fromJSON?(state: unknown): void;
  /**
   * Throw if `fromJSON(state)` would throw, changing nothing. `restoreState`
   * calls it on every plugin state before it replaces the first series, so a
   * layout one plugin cannot take is refused whole instead of half applied.
   * `ctx.seriesIds` are the ids of the series the layout will create.
   */
  validateState?(state: unknown, ctx: { seriesIds: readonly string[] }): void;
}
