// Vertical mapping between price and CSS pixels inside a pane.
//
// A scale works in display units: price (linear), log10(price) (log),
// percent change from a base price (percent), or price indexed to 100 at the
// base (indexed). The base is the first visible bar of the scale's main
// series, as traders expect: scrolling re-bases.
//
// Renderers upload a coordinate per value: the price itself, or log10(price)
// for a log scale. y is affine in that coordinate in every mode (inverted
// included), so the GPU transform stays one multiply-add: y = A + B · coord.
//
// With autoScale on, the range follows the visible bars' high/low every frame
// (an O(log n) LOD query per series). Dragging the axis or panning vertically
// turns autoScale off until the axis is double-clicked.

import type { AxisTick } from "./ticks.js";

export type PriceScaleMode = "linear" | "log" | "percent" | "indexed";

export interface PriceScaleOptions {
  /** Fractions of the pane height kept empty above and below the data. */
  marginTop: number;
  marginBottom: number;
  autoScale: boolean;
  mode: PriceScaleMode;
  /** Higher values lower on screen. */
  invert: boolean;
  /** Where the axis is drawn; "none" for overlay scales such as volume. */
  position: "right" | "left" | "none";
  visible: boolean;
  /** Minimum width of the axis in CSS px (the axis is otherwise as wide as its labels need); left and right axes. */
  minWidth?: number;
}

/** Throws on an option value the axis cannot use. */
export function checkPriceScaleOptions(o: Partial<PriceScaleOptions>): void {
  if (o.minWidth !== undefined && !(typeof o.minWidth === "number" && Number.isFinite(o.minWidth) && o.minWidth >= 0)) {
    throw new RangeError(`alphacharts: price scale minWidth must be a non-negative number of CSS px, got ${o.minWidth}`);
  }
}

export const DEFAULT_PRICE_SCALE: PriceScaleOptions = {
  marginTop: 0.1,
  marginBottom: 0.1,
  autoScale: true,
  mode: "linear",
  invert: false,
  position: "right",
  visible: true,
};

export class PriceScale {
  /** Visible range in display units. */
  min = 0;
  max = 1;
  /** Pane height in CSS px. */
  height = 0;
  /** Base price for percent and indexed modes. */
  base = 1;
  /** True once the range has been set from data or restored: before that min/max are placeholders. */
  ranged = false;
  /** @internal Layout of this frame: axis ticks and the axis column (CSS px). */
  ticks: AxisTick[] = [];
  /** @internal */ axisX = 0;
  /** @internal */ axisW = 0;

  constructor(readonly id: string, public options: PriceScaleOptions) {}

  get mode(): PriceScaleMode {
    return this.options.mode;
  }

  /** Values uploaded to the GPU are log10(price) on a log scale. */
  get logCoords(): boolean {
    return this.options.mode === "log";
  }

  private get innerTop(): number {
    return this.height * this.options.marginTop;
  }
  private get innerHeight(): number {
    return Math.max(1, this.height * (1 - this.options.marginTop - this.options.marginBottom));
  }

  /** CSS px per display unit. */
  get pxPerUnit(): number {
    return this.innerHeight / (this.max - this.min);
  }

  /** Price → display units (NaN for a non-positive price on a log scale). */
  display(p: number): number {
    switch (this.options.mode) {
      case "linear": return p;
      case "log": return p > 0 ? Math.log10(p) : Number.NaN;
      case "percent": return (p / this.base - 1) * 100;
      case "indexed": return (p / this.base) * 100;
    }
  }

  /** Display units → price. */
  fromDisplay(v: number): number {
    switch (this.options.mode) {
      case "linear": return v;
      case "log": return 10 ** v;
      case "percent": return (v / 100 + 1) * this.base;
      case "indexed": return (v / 100) * this.base;
    }
  }

  /** The coordinate renderers upload for a price. */
  coord(p: number): number {
    return this.logCoords ? (p > 0 ? Math.log10(p) : Number.NaN) : p;
  }

  /** CSS y of display value v. */
  yOfDisplay(v: number): number {
    return this.options.invert ? this.innerTop + (v - this.min) * this.pxPerUnit : this.innerTop + (this.max - v) * this.pxPerUnit;
  }

  y(price: number): number {
    return this.yOfDisplay(this.display(price));
  }

  displayAt(y: number): number {
    return this.options.invert ? this.min + (y - this.innerTop) / this.pxPerUnit : this.max - (y - this.innerTop) / this.pxPerUnit;
  }

  price(y: number): number {
    return this.fromDisplay(this.displayAt(y));
  }

  /** dy/dcoord in CSS px: signed, affine in every mode (see the header). */
  get pxPerCoord(): number {
    const k = this.pxPerUnit * (this.options.invert ? 1 : -1);
    switch (this.options.mode) {
      case "linear":
      case "log": return k;
      case "percent":
      case "indexed": return (k * 100) / this.base;
    }
  }

  /** CSS y of an uploaded coordinate. */
  yOfCoord(c: number): number {
    return this.yOfDisplay(this.logCoords ? c : this.display(c));
  }

  /** Apply an autoscale result in prices; a flat or empty range still gets a usable span. */
  fit(lo: number, hi: number): void {
    if (!(lo <= hi)) return; // NaN: nothing visible, keep the last range
    let a = this.display(lo), b = this.display(hi);
    if (this.logCoords && !(a === a)) a = b - 1; // non-positive low on a log scale
    if (!(a <= b)) return;
    if (b === a) {
      const pad = a === 0 ? 1 : Math.abs(a) * 0.005;
      a -= pad;
      b += pad;
    }
    this.min = a;
    this.max = b;
    this.ranged = true;
  }

  /** Stretch around the centre; factor > 1 zooms in. Turns autoScale off. */
  scale(factor: number): void {
    const mid = (this.min + this.max) / 2;
    const half = (this.max - this.min) / 2 / factor;
    if (!(half > 0) || !Number.isFinite(half)) return;
    this.min = mid - half;
    this.max = mid + half;
    this.ranged = true;
    this.options = { ...this.options, autoScale: false };
  }

  /** Move by dy CSS px (content follows the pointer). Turns autoScale off. */
  pan(dy: number): void {
    const d = (dy / this.pxPerUnit) * (this.options.invert ? -1 : 1);
    this.min += d;
    this.max += d;
    this.ranged = true;
    this.options = { ...this.options, autoScale: false };
  }
}
