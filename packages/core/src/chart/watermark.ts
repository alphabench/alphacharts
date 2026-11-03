// The brand α mark (configurable: `visible`, `opacity`) at the bottom-left of the main pane, above the time
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

// α from the brand's alphabench_logo.svg (y up, 1024 box); GLYPH_BOX is the
// cropped viewBox the brand's inline logo uses.
const GLYPH_PATH =
  "M4405 7778 c-217 -11 -387 -42 -589 -109 -702 -233 -1309 -862 -1563 -1619 -85 -253 -124 -451 -148 -755 -18 -227 -18 -329 0 -531 30 -337 82 -568 190 -849 144 -372 337 -670 614 -945 354 -351 734 -551 1231 -649 209 -41 591 -41 800 0 267 52 453 119 660 237 306 175 558 411 729 685 33 51 48 67 66 67 18 0 25 -8 35 -47 70 -268 197 -492 353 -624 102 -85 277 -168 452 -214 151 -40 248 -49 500 -49 254 0 342 9 450 47 l40 14 3 417 c1 288 -1 416 -8 416 -6 0 -23 -6 -38 -14 -15 -7 -70 -28 -122 -46 -80 -28 -113 -34 -213 -38 -212 -8 -343 32 -454 141 -86 83 -139 201 -174 382 -18 96 -19 169 -19 2012 l0 1913 -415 0 -415 0 0 -380 c0 -447 4 -436 -100 -288 -134 191 -398 428 -606 544 -27 15 -63 35 -80 44 -44 26 -208 95 -289 123 -280 97 -554 132 -890 115z m485 -789 c412 -60 800 -291 1064 -634 189 -244 314 -515 371 -800 38 -191 40 -223 40 -520 0 -297 -3 -332 -41 -520 -137 -681 -658 -1252 -1279 -1402 -243 -58 -527 -58 -770 0 -586 141 -1091 664 -1254 1297 -58 227 -74 368 -74 630 0 478 97 835 320 1179 243 375 598 635 1012 741 169 44 425 56 611 29z";
const GLYPH_X = 200, GLYPH_Y = 240, GLYPH_H = 560;

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
  ctx.translate(0, 1024);
  ctx.scale(0.1, -0.1);
  ctx.lineJoin = "round";
  ctx.lineWidth = HALO / (sc * 0.1);
  ctx.strokeStyle = th.background;
  ctx.stroke(glyph);
  ctx.fillStyle = th.text;
  ctx.fill(glyph);
  ctx.restore();
}
