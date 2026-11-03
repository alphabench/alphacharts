// Spec fields that are not about one mark: rejected up front, before anything is
// built, so a bad value fails where the spec is given and not in a frame callback.

import { checkWatermarkOptions, DEFAULT_WATERMARK } from "@alphacharts/core";
import type { AxesSpec, AxisSpec, PlotSpec } from "./spec.js";

const finiteAtLeast0 = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** `spec.padding` as four sides, or undefined when the built-in margins apply. */
export function paddingOf(spec: Pick<PlotSpec, "padding">): Padding | undefined {
  const p = spec.padding;
  if (p === undefined) return undefined;
  if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
  return { top: p.top, right: p.right, bottom: p.bottom, left: p.left };
}

function checkAxis(id: "x" | "y" | "y2", a: AxisSpec | false | undefined): void {
  if (!a) return;
  if (a.tickMarks !== undefined && typeof a.tickMarks !== "boolean") throw new TypeError(`alphacharts: axes.${id}.tickMarks must be true or false, got ${typeof a.tickMarks}`);
  if (a.side !== undefined) {
    if (id === "x") throw new TypeError("alphacharts: axes.x.side: the x axis is at the bottom; side is for y and y2");
    if (a.side !== "left" && a.side !== "right") throw new TypeError(`alphacharts: axes.${id}.side must be "left" or "right", got ${JSON.stringify(a.side)}`);
  }
  if (a.width !== undefined) {
    if (id === "x") throw new TypeError("alphacharts: axes.x.width: width is the gutter of a y axis; the x axis is as tall as its labels");
    if (typeof a.width !== "number" || !(a.width > 0) || !Number.isFinite(a.width)) throw new RangeError(`alphacharts: axes.${id}.width must be a positive number of px, got ${String(a.width)}`);
  }
}

/** The side each y axis is on: y on the right moves y2 to the left unless it says otherwise. */
export function sidesOf(axes: AxesSpec | undefined): { y: "left" | "right"; y2: "left" | "right" } {
  const ys = axes?.y ? axes.y.side : undefined;
  const y2s = axes?.y2 ? axes.y2.side : undefined;
  const y = ys ?? (y2s === "left" ? "right" : "left");
  const y2 = y2s ?? (y === "left" ? "right" : "left");
  return { y, y2 };
}

export function validateSpec(spec: PlotSpec): void {
  checkWatermarkOptions({ ...DEFAULT_WATERMARK, ...spec.watermark });
  const p = spec.padding;
  if (p !== undefined) {
    if (typeof p === "number") {
      if (!finiteAtLeast0(p)) throw new RangeError(`alphacharts: padding must be a number of px >= 0, got ${String(p)}`);
    } else {
      if (p === null || typeof p !== "object") throw new TypeError("alphacharts: padding is a number, or { top, right, bottom, left }");
      for (const k of ["top", "right", "bottom", "left"] as const) if (!finiteAtLeast0(p[k])) throw new RangeError(`alphacharts: padding.${k} must be a number of px >= 0, got ${String(p[k])}`);
    }
  }
  if (spec.decorative !== undefined && typeof spec.decorative !== "boolean") throw new TypeError(`alphacharts: decorative must be true or false, got ${typeof spec.decorative}`);
  for (const id of ["x", "y", "y2"] as const) checkAxis(id, spec.axes?.[id]);
  const sides = sidesOf(spec.axes);
  if (sides.y === sides.y2 && spec.axes?.y !== false && spec.axes?.y2 !== false && (spec.axes?.y?.side !== undefined || spec.axes?.y2?.side !== undefined)) {
    throw new TypeError(`alphacharts: axes.y and axes.y2 are both on the ${sides.y}: one of them needs the other side`);
  }
}
