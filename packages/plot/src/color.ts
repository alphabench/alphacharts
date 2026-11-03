// Colour scales over the core's colour parser.

import { cssColor, parseColor } from "@alphacharts/core";
import type { PlotTheme } from "./theme.js";
import type { ColorScaleSpec } from "./spec.js";

type RGB = readonly [number, number, number];

function rgbOf(css: string): RGB {
  const c = parseColor(css);
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
}

function mix(a: RGB, b: RGB, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  return cssColor((((Math.round(a[0] + (b[0] - a[0]) * k) << 24) | (Math.round(a[1] + (b[1] - a[1]) * k) << 16) | (Math.round(a[2] + (b[2] - a[2]) * k) << 8) | 255) >>> 0));
}

export interface ColorScale {
  readonly kind: "sequential" | "diverging";
  readonly domain: readonly [number, number];
  /** Value for a legend gradient stop 0..1. */
  valueAt(t: number): number;
  /** The colour of a value (NaN gets the theme's muted grey: a missing value is shown as missing). */
  map(v: number): string;
}

class Sequential implements ColorScale {
  readonly kind = "sequential";
  private readonly stops: RGB[];
  constructor(range: readonly string[], readonly domain: readonly [number, number]) {
    this.stops = range.map(rgbOf);
  }
  valueAt(t: number): number {
    return this.domain[0] + t * (this.domain[1] - this.domain[0]);
  }
  map(v: number): string {
    const [d0, d1] = this.domain;
    const t = d1 === d0 ? 0.5 : Math.max(0, Math.min(1, (v - d0) / (d1 - d0))) * (this.stops.length - 1);
    const i = Math.min(this.stops.length - 2, Math.floor(t));
    return mix(this.stops[i]!, this.stops[i + 1]!, t - i);
  }
}

class Diverging implements ColorScale {
  readonly kind = "diverging";
  private readonly stops: [RGB, RGB, RGB];
  constructor(range: readonly [string, string, string], readonly domain: readonly [number, number], readonly mid: number) {
    this.stops = [rgbOf(range[0]), rgbOf(range[1]), rgbOf(range[2])];
  }
  valueAt(t: number): number {
    return this.domain[0] + t * (this.domain[1] - this.domain[0]);
  }
  map(v: number): string {
    const [d0, d1] = this.domain, m = this.mid;
    if (v < m && d0 < m) return mix(this.stops[0], this.stops[1], (v - d0) / (m - d0));
    if (v > m && d1 > m) return mix(this.stops[1], this.stops[2], (v - m) / (d1 - m));
    return mix(this.stops[1], this.stops[1], 0);
  }
}

/** A scale for `spec`, with `extent` (the data's min and max) filling a domain the spec leaves out. */
export function makeColorScale(spec: ColorScaleSpec | undefined, theme: PlotTheme, extent: readonly [number, number]): ColorScale {
  const inner = makeInner(spec, theme, extent);
  const missing = cssColor(parseColor(theme.border));
  return {
    kind: inner.kind, domain: inner.domain,
    valueAt: (t) => inner.valueAt(t),
    map: (v) => (v === v ? inner.map(v) : missing),
  };
}

function makeInner(spec: ColorScaleSpec | undefined, theme: PlotTheme, extent: readonly [number, number]): ColorScale {
  if (spec?.type === "diverging") {
    const mid = spec.midpoint ?? 0;
    let dom: [number, number];
    if (spec.domain) dom = [spec.domain[0], spec.domain[1]];
    else {
      const symmetric = spec.symmetric ?? true;
      const e = Math.max(Math.abs(extent[0] - mid), Math.abs(extent[1] - mid));
      dom = symmetric ? [mid - e, mid + e] : [Math.min(extent[0], mid), Math.max(extent[1], mid)];
    }
    return new Diverging(spec.range ?? theme.diverging, dom, mid);
  }
  const range = spec?.range ?? theme.sequential;
  if (range.length < 2) throw new RangeError("a sequential colour scale needs at least two colours");
  return new Sequential(range, spec?.domain ? [spec.domain[0], spec.domain[1]] : [extent[0], extent[1]]);
}

/** Black or white text, whichever reads on `bg` (relative luminance, WCAG). */
export function textOn(bg: string): string {
  const [r, g, b] = rgbOf(bg).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#000000" : "#ffffff";
}

/** `css` at the given opacity, as an rgba() string. */
export function withAlpha(css: string, alpha: number): string {
  const [r, g, b] = rgbOf(css);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
