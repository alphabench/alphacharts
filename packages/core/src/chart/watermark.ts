// The α mark (configurable: `visible`, `opacity`) at the bottom-left of the main pane, above the time
// axis. Drawn on the overlay layer inside the pane's clip, so a chart in a
// Dashboard carries its own inside its cell. The glyph has a halo in the chart
// background so it stays legible over candles and volume.

import type { Theme } from "./theme.js";

export interface WatermarkOptions {
  visible: boolean;
  /** 0 to 1. */
  opacity: number;
}

export const DEFAULT_WATERMARK: WatermarkOptions = { visible: true, opacity: 1 };

export function checkWatermarkOptions(o: WatermarkOptions): void {
  if (typeof o.visible !== "boolean") throw new TypeError(`alphacharts: watermark.visible must be a boolean, got ${String(o.visible)}`);
  if (!(o.opacity >= 0 && o.opacity <= 1)) throw new RangeError(`alphacharts: watermark.opacity must be between 0 and 1, got ${String(o.opacity)}`);
}

// The lowercase α, y down, in its own 400 box. GLYPH_X/Y/H are the path's tight bounding box (x 109.956 to 290.052,
// y 115.880 to 295.791), so HEIGHT is the drawn height of the ink.
const GLYPH_PATH =
  "m239.84 120.88h31.498l-19.084 85.787q-5.5604 24.458-7.5968 30.016 7.4117 34.093 21.493 34.093 16.676 0 17.232-22.975h6.6701q-0.5282 21.493-7.9671 34.834-7.2262 13.155-19.084 13.155-9.8203 0-14.637-7.9673-4.8147-7.9673-10.376-32.61-19.27 40.578-62.997 40.578-29.831 0-47.433-23.161-17.602-23.346-17.602-66.702 0-42.616 19.27-66.332 19.269-23.716 46.321-23.716 19.084 0 31.313 13.526 12.229 13.526 21.679 44.098zm-16.305 72.632q-8.7082-29.831-19.455-46.507-10.746-16.861-25.755-16.861-33.907 0-33.907 79.302 0 75.226 32.425 75.226 28.163 0 41.689-66.332z";
const GLYPH_X = 109.956, GLYPH_Y = 115.88, GLYPH_H = 179.911;

const HEIGHT = 20;
const INSET_X = 12;
const INSET_Y = 10;
const HALO = 3.5;
/** Below these the mark would crowd the series, so it is not drawn. */
const MIN_PANE_W = 160;
const MIN_PANE_H = 120;

let glyph: Path2D | undefined;

/** Draws into a context whose origin is the pane's top-left, in CSS px. */
export function drawWatermark(ctx: CanvasRenderingContext2D, paneW: number, paneH: number, th: Theme, o: WatermarkOptions): void {
  if (!o.visible || o.opacity === 0 || paneW < MIN_PANE_W || paneH < MIN_PANE_H) return;
  glyph ??= new Path2D(GLYPH_PATH);
  const sc = HEIGHT / GLYPH_H;
  ctx.save();
  ctx.globalAlpha = o.opacity;
  ctx.translate(INSET_X, paneH - INSET_Y - HEIGHT);
  ctx.scale(sc, sc);
  ctx.translate(-GLYPH_X, -GLYPH_Y);
  ctx.lineJoin = "round";
  ctx.lineWidth = HALO / sc;
  ctx.strokeStyle = th.background;
  ctx.stroke(glyph);
  ctx.fillStyle = th.text;
  ctx.fill(glyph);
  ctx.restore();
}
