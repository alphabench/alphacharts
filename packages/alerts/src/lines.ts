// The price of a drawing's line at a bar, from its anchors alone: what both a
// chart and a backend can compute.
//
// Positions along the time axis use `logical(time)`: identity by default
// (the line is straight in time), or a bar-sequence position (the line is
// straight in bar index, which is how it looks on a chart that skips
// non-trading time). Pass the same function on both sides.

import type { DrawingGeometry } from "./types.js";

export type Logical = (time: number) => number;
const identity: Logical = (t) => t;

/** Lines each supported tool exposes. */
export const DRAWING_LINES: Readonly<Record<string, readonly string[]>> = {
  trendLine: ["main"],
  ray: ["main"],
  extendedLine: ["main"],
  infoLine: ["main"],
  horizontalLine: ["main"],
  horizontalRay: ["main"],
  parallelChannel: ["base", "offset", "middle"],
};

export function checkGeometry(g: DrawingGeometry, line: string): void {
  const lines = DRAWING_LINES[g.tool];
  if (!lines) throw new Error(`alerts: drawing tool "${g.tool}" has no alertable line (supported: ${Object.keys(DRAWING_LINES).join(", ")})`);
  if (!lines.includes(line)) throw new Error(`alerts: ${g.tool} has no line "${line}" (has: ${lines.join(", ")})`);
  const need = g.tool === "horizontalLine" || g.tool === "horizontalRay" ? 1 : g.tool === "parallelChannel" ? 3 : 2;
  if (g.anchors.length !== need) throw new RangeError(`alerts: ${g.tool} "${g.id}" needs ${need} anchors, got ${g.anchors.length}`);
  if (need >= 2 && g.anchors[0]!.time === g.anchors[1]!.time) throw new RangeError(`alerts: ${g.tool} "${g.id}" has its first two anchors at the same time (a vertical line has no price at a bar)`);
  for (const a of g.anchors) if (!Number.isFinite(a.time) || !Number.isFinite(a.price)) throw new TypeError(`alerts: drawing "${g.id}" has a non-finite anchor`);
  if (g.scale !== undefined && g.scale !== "log") throw new RangeError(`alerts: drawing "${g.id}" has scale "${String(g.scale)}"; only "log" (or none) is meaningful`);
  if (g.scale === "log") {
    for (const a of g.anchors) if (!(a.price > 0)) throw new RangeError(`alerts: drawing "${g.id}" is on a log scale and has a non-positive anchor price ${a.price}`);
  }
}

/** Price coordinate in which the drawing is straight: price, or ln(price) on a log scale. */
const coord = (g: DrawingGeometry, price: number): number => (g.scale === "log" ? Math.log(price) : price);
const uncoord = (g: DrawingGeometry, c: number): number => (g.scale === "log" ? Math.exp(c) : c);

/** The line through two anchors at `t`, in the drawing's price coordinate. */
function through(g: DrawingGeometry, p0: { time: number; price: number }, p1: { time: number; price: number }, t: number, lg: Logical): number {
  const x0 = lg(p0.time), x1 = lg(p1.time);
  if (x0 === x1) throw new RangeError("alerts: a line needs anchors at different times");
  const c0 = coord(g, p0.price), c1 = coord(g, p1.price);
  return c0 + ((c1 - c0) * (lg(t) - x0)) / (x1 - x0);
}

/**
 * Price of `line` of the drawing at `time`, or undefined where the line does
 * not exist (outside a segment, before a ray's start, left of a horizontal ray).
 */
export function linePrice(g: DrawingGeometry, line: string, time: number, logical: Logical = identity): number | undefined {
  checkGeometry(g, line);
  const a = g.anchors;
  const x = logical(time);
  switch (g.tool) {
    case "horizontalLine":
      return a[0]!.price;
    case "horizontalRay":
      return x >= logical(a[0]!.time) ? a[0]!.price : undefined;
    case "trendLine":
    case "infoLine": {
      const x0 = logical(a[0]!.time), x1 = logical(a[1]!.time);
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      const left = g.extendLeft ? -Infinity : lo, right = g.extendRight ? Infinity : hi;
      // extendLeft/Right are in screen terms: left = earlier in time.
      return x >= left && x <= right ? uncoord(g, through(g, a[0]!, a[1]!, time, logical)) : undefined;
    }
    case "extendedLine":
      return uncoord(g, through(g, a[0]!, a[1]!, time, logical));
    case "ray": {
      const x0 = logical(a[0]!.time), x1 = logical(a[1]!.time);
      return (x - x0) * (x1 - x0) >= 0 ? uncoord(g, through(g, a[0]!, a[1]!, time, logical)) : undefined;
    }
    case "parallelChannel": {
      // The channel's offset is constant in the drawing's coordinate (pixels), so in ln(price) on a log scale.
      const base = through(g, a[0]!, a[1]!, time, logical);
      const off = coord(g, a[2]!.price) - through(g, a[0]!, a[1]!, a[2]!.time, logical);
      const lo = Math.min(logical(a[0]!.time), logical(a[1]!.time)), hi = Math.max(logical(a[0]!.time), logical(a[1]!.time));
      const left = g.extendLeft ? -Infinity : lo, right = g.extendRight ? Infinity : hi;
      if (x < left || x > right) return undefined;
      return uncoord(g, line === "base" ? base : line === "offset" ? base + off : base + off / 2);
    }
  }
  throw new Error(`alerts: unhandled tool ${g.tool}`);
}
