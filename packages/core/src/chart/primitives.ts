// Pane primitives: the plugin seam for anything drawn over a pane that is not
// a series — price lines here; drawings and study overlays (M3/M4) next.
//
// A primitive is attached to a series and draws with that series' price
// scale. It draws on the overlay layer in CSS px with the origin at the
// pane's top-left (the context is already transformed for DPR and clipped to
// the pane), may add labels to the price axis, and may claim the pointer. It may
// also draw behind the series (`drawBackground`, on the background layer).

import { cssColor, parseColor } from "../render/color.js";
import { isColorSlot, resolveColor } from "./slots.js";
import type { Theme } from "./theme.js";

export interface PaneView {
  /** Pane size in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Visible timeline indices. */
  readonly lo: number;
  readonly hi: number;
  /** CSS x of a timeline index's centre. */
  x(index: number): number;
  /** CSS y of a price on the series' scale. */
  y(price: number): number;
  index(x: number): number;
  price(y: number): number;
  timeToIndex(time: number): number | undefined;
  indexToTime(index: number): number;
  /**
   * Pane CSS x of a time (UTC ms): fractional between bars, extrapolated past
   * the first and last bar by the recent bar interval (as the plugin API's
   * `timeToX`). NaN while the chart has no data.
   */
  timeToX(time: number): number;
  /** CSS px between the centres of adjacent bars. */
  readonly barSpacing: number;
  formatPrice(price: number): string;
  /** The chart's theme: what a colour slot ("chart-1", "chart-up" …, see `resolveColor`) draws with. */
  readonly theme: Theme;
}

export interface AxisLabel {
  price: number;
  text: string;
  background: string;
  color: string;
}

/** Which canvas layer a primitive wants repainted. */
export type RenderLayer = "background" | "overlay" | "all";

export interface PrimitiveHost {
  /**
   * Ask for a redraw on the next frame: the overlay (default), the background
   * layer (what `drawBackground` paints; it is not repainted by ticks) or both.
   */
  requestRender(layer?: RenderLayer): void;
}

/** A primitive's hit: `id` is reported as `hovered` on crosshair events. */
export interface PrimitiveHit {
  id: string;
  /** CSS cursor to show; absent passes the cursor through. */
  cursor?: string;
}

export interface PanePrimitive {
  attached?(host: PrimitiveHost): void;
  detached?(): void;
  /**
   * Drawn on the background layer after the grid and before the series, so it
   * sits behind the bars. Same coordinates and clip as `draw`. Repainted when
   * the view, scale or layout changes; call `host.requestRender("background")`
   * when its own data changes.
   */
  drawBackground?(ctx: CanvasRenderingContext2D, view: PaneView): void;
  draw?(ctx: CanvasRenderingContext2D, view: PaneView): void;
  axisLabels?(view: PaneView): readonly AxisLabel[];
  /**
   * What is under pane point (x, y): a CSS cursor, a hit with an `id` (reported
   * as `hovered: { kind: "primitive", id }` on crosshair events, with an optional
   * cursor), or null to pass through. The id must not be empty.
   */
  hitTest?(x: number, y: number, view: PaneView): string | PrimitiveHit | null;
}

// ---- price line ---------------------------------------------------------------

export type LineDash = "solid" | "dashed" | "dotted" | "large-dashed" | "sparse-dotted";

export interface PriceLineOptions {
  price: number;
  color: string;
  /** CSS px: 1 or 2 (anything else throws). */
  lineWidth: number;
  lineStyle: LineDash;
  title: string;
  axisLabelVisible: boolean;
  /** Background of the axis label; default: `color`. */
  axisLabelColor?: string;
  /** Text colour of the axis label. */
  labelTextColor: string;
}

export function dashPattern(style: LineDash, width: number): number[] {
  switch (style) {
    case "solid": return [];
    case "dashed": return [4 * width, 3 * width];
    case "dotted": return [width, 2 * width];
    case "large-dashed": return [8 * width, 5 * width];
    case "sparse-dotted": return [width, 6 * width];
  }
}

function checkLine(o: PriceLineOptions): void {
  if (o.lineWidth !== 1 && o.lineWidth !== 2) throw new RangeError(`alphacharts: price line lineWidth must be 1 or 2, got ${o.lineWidth}`);
  if (o.lineStyle !== "solid" && o.lineStyle !== "dashed" && o.lineStyle !== "dotted" && o.lineStyle !== "large-dashed" && o.lineStyle !== "sparse-dotted") {
    throw new RangeError(`alphacharts: unknown price line lineStyle "${String(o.lineStyle)}"`);
  }
  if (o.axisLabelColor !== undefined && !isColorSlot(o.axisLabelColor)) parseColor(o.axisLabelColor);
}

/** Snap a CSS coordinate so a line of `width` CSS px covers whole device pixels. */
export function crisp(v: number, dpr: number, width = 1): number {
  const w = Math.max(1, Math.round(width * dpr));
  return (Math.round(v * dpr) + (w % 2 ? 0.5 : 0)) / dpr;
}

export class PriceLine implements PanePrimitive {
  private host: PrimitiveHost | null = null;
  private opts: PriceLineOptions;

  constructor(options: Partial<PriceLineOptions> & { price: number }) {
    const opts: PriceLineOptions = { color: "muted", lineWidth: 1, lineStyle: "dashed", title: "", axisLabelVisible: true, labelTextColor: "#ffffff", ...options };
    checkLine(opts);
    this.opts = opts;
  }

  options(): Readonly<PriceLineOptions> {
    return this.opts;
  }

  applyOptions(options: Partial<PriceLineOptions>): void {
    const next = { ...this.opts, ...options };
    checkLine(next);
    this.opts = next;
    this.host?.requestRender();
  }

  attached(host: PrimitiveHost): void {
    this.host = host;
  }

  detached(): void {
    this.host = null;
  }

  draw(ctx: CanvasRenderingContext2D, view: PaneView): void {
    const o = this.opts;
    const y = crisp(view.y(o.price), view.dpr, o.lineWidth);
    if (y < -o.lineWidth || y > view.height + o.lineWidth) return;
    const color = resolveColor(o.color, view.theme);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(o.lineWidth * view.dpr)) / view.dpr;
    ctx.setLineDash(dashPattern(o.lineStyle, o.lineWidth));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(view.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (o.title) {
      ctx.fillStyle = color;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "right";
      ctx.fillText(o.title, view.width - 6, y - 2);
    }
  }

  axisLabels(view: PaneView): readonly AxisLabel[] {
    const o = this.opts;
    return o.axisLabelVisible ? [{ price: o.price, text: view.formatPrice(o.price), background: resolveColor(o.axisLabelColor ?? o.color, view.theme), color: resolveColor(o.labelTextColor, view.theme) }] : [];
  }
}

// ---- bar shading ---------------------------------------------------------------

/**
 * A background colour per bar, drawn behind the series of the pane it is attached to (`Series.attachPrimitive`).
 * It takes no part in autoscale (a primitive never does) and costs nothing while no bar is shaded. Colours are
 * keyed by bar time (UTC ms), so they stay with their bars when the timeline is re-indexed; a time with no bar on
 * the chart draws nothing. Runs of equal colour on neighbouring bars are painted as one rectangle.
 */
export class BarShading implements PanePrimitive {
  private host: PrimitiveHost | null = null;
  private times = new Float64Array(0);
  private colors = new Uint32Array(0);
  private n = 0;
  private shown = true;
  private any = false;

  /** Replace every shade: strictly increasing times, packed 0xRRGGBBAA colours (0 = no shade). */
  set(time: Float64Array, color: Uint32Array): void {
    if (time.length !== color.length) throw new RangeError(`BarShading.set: ${color.length} colours for ${time.length} times`);
    this.times = time.slice();
    this.colors = color.slice();
    this.n = time.length;
    this.any = this.colors.some((c) => c !== 0);
    this.host?.requestRender("background");
  }

  /** Shade one bar: replaces the colour at `time` when the bar is known, else appends (a time later than the last). */
  setAt(time: number, color: number): void {
    const n = this.n;
    let i = n;
    if (n > 0 && time <= this.times[n - 1]!) {
      i = lowerBoundTime(this.times, n, time);
      if (this.times[i] !== time) throw new RangeError(`BarShading.setAt: time ${time} is neither the last bar nor a later one`);
    }
    if (i === n) {
      if (n === this.times.length) {
        const cap = Math.max(64, n * 2);
        const t = new Float64Array(cap), c = new Uint32Array(cap);
        t.set(this.times.subarray(0, n));
        c.set(this.colors.subarray(0, n));
        this.times = t;
        this.colors = c;
      }
      this.times[n] = time;
      this.n = n + 1;
    } else if (this.colors[i] === color) return;
    this.colors[i] = color;
    if (color !== 0) this.any = true;
    this.host?.requestRender("background");
  }

  clear(): void {
    this.n = 0;
    this.any = false;
    this.host?.requestRender("background");
  }

  setVisible(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    this.host?.requestRender("background");
  }

  attached(host: PrimitiveHost): void {
    this.host = host;
  }

  detached(): void {
    this.host = null;
  }

  drawBackground(ctx: CanvasRenderingContext2D, view: PaneView): void {
    if (!this.shown || !this.any || this.n === 0) return;
    const times = this.times, colors = this.colors, n = this.n;
    const half = view.barSpacing / 2;
    // first bar whose right edge is inside the pane (timeToX never throws, and grows with time)
    let a = 0, b = n;
    while (a < b) {
      const mid = (a + b) >>> 1;
      if (view.timeToX(times[mid]!) + half < 0) a = mid + 1;
      else b = mid;
    }
    let k = a;
    let runStart = -1, runEnd = -1, runColor = 0;
    const flush = () => {
      if (runColor === 0 || runStart < 0) return;
      ctx.fillStyle = cssColor(runColor);
      ctx.fillRect(runStart, 0, runEnd - runStart, view.height);
    };
    for (; k < n; k++) {
      if (view.timeToX(times[k]!) - half > view.width) break;
      const c = colors[k]!;
      const idx = view.timeToIndex(times[k]!);
      if (idx === undefined) continue;
      const x = view.x(idx);
      // contiguous with the open run when this bar starts where the run ends
      if (c === runColor && c !== 0 && Math.abs(x - half - runEnd) < 0.5) {
        runEnd = x + half;
        continue;
      }
      flush();
      runColor = c;
      runStart = x - half;
      runEnd = x + half;
    }
    flush();
  }
}

function lowerBoundTime(a: Float64Array, n: number, t: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
