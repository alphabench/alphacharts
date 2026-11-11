// How the crosshair line is stroked: the default (a dashed hairline of one device pixel) unless `lineStyle` or `lineWidth` is given.

import { dashPattern, type LineDash } from "./primitives.js";

const LINE_STYLES: readonly LineDash[] = ["solid", "dashed", "dotted", "large-dashed", "sparse-dotted"];

export interface CrosshairLine {
  /** Dash pattern of the line, in CSS px. */
  lineStyle?: LineDash;
  /** CSS px: 1 or 2. Unset: a hairline of one device pixel. */
  lineWidth?: 1 | 2;
}

export function checkCrosshairLine(o: CrosshairLine): void {
  if (o.lineWidth !== undefined && o.lineWidth !== 1 && o.lineWidth !== 2) throw new RangeError(`alphacharts: crosshair lineWidth must be 1 or 2, got ${String(o.lineWidth)}`);
  if (o.lineStyle !== undefined && !LINE_STYLES.includes(o.lineStyle)) throw new RangeError(`alphacharts: unknown crosshair lineStyle "${String(o.lineStyle)}"`);
}

/** Canvas line width (user units, drawn under a `dpr` transform), dash pattern, and the width the line is snapped for. */
export function crosshairStroke(o: CrosshairLine, dpr: number): { lineWidth: number; dash: number[]; snapWidth: number } {
  const w = o.lineWidth;
  return {
    lineWidth: w === undefined ? 1 / dpr : Math.max(1, Math.round(w * dpr)) / dpr,
    dash: o.lineStyle === undefined ? [4, 4] : dashPattern(o.lineStyle, w ?? 1),
    snapWidth: w ?? 1,
  };
}
