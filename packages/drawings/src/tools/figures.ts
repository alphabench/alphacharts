// Figures: rectangle, rotated rectangle, ellipse, circle, triangle, arc,
// curve, double curve, polyline, path, brush, highlighter.

import { circumcircle, controlThrough, dist, quadPoints, type Pt } from "../geometry.js";
import type { Shape, ToolDef } from "../types.js";
import { A, finiteAnchors, head, line, mid, needDistinctTimes, poly, px, pxs, text, tool } from "./util.js";

const FILL = "rgba(41,98,255,0.15)";

/** Style text centred in a box when the drawing has any. */
function inner(textValue: string, p: Pt): Shape[] {
  return textValue ? [text(p.x, p.y, textValue, { align: "center", base: "middle", hit: false })] : [];
}

export const rectangle = tool({
  id: "rectangle", label: "Rectangle", family: "shapes", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { fill: FILL } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    return [poly([p0, { x: p1.x, y: p0.y }, p1, { x: p0.x, y: p1.y }], { close: true, fill: d.style.fill }), ...inner(d.style.text, mid(p0, p1))];
  },
});

/** Corners of the rectangle with edge a→b and perpendicular extent through c. */
export function rotatedRectCorners(a: Pt, b: Pt, c: Pt): [Pt, Pt, Pt, Pt] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) throw new RangeError("rotated rectangle: its first two anchors coincide");
  const nx = -dy / len, ny = dx / len;
  const w = (c.x - a.x) * nx + (c.y - a.y) * ny;
  return [a, b, { x: b.x + nx * w, y: b.y + ny * w }, { x: a.x + nx * w, y: a.y + ny * w }];
}

export const rotatedRectangle = tool({
  id: "rotatedRectangle", label: "Rotated rectangle", family: "shapes", gesture: "clicks", anchors: 3,
  defaults: () => ({ style: { fill: FILL } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b, cc] = pxs(c, d) as [Pt, Pt, Pt];
    const q = rotatedRectCorners(a, b, cc);
    return [poly(q, { close: true, fill: d.style.fill }), ...inner(d.style.text, mid(q[0], q[2]))];
  },
});

export const ellipse = tool({
  id: "ellipse", label: "Ellipse", family: "shapes", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { fill: FILL } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const m = mid(p0, p1);
    return [{ k: "ellipse", cx: m.x, cy: m.y, rx: Math.abs(p1.x - p0.x) / 2, ry: Math.abs(p1.y - p0.y) / 2, fill: d.style.fill }, ...inner(d.style.text, m)];
  },
});

export const circle = tool({
  id: "circle", label: "Circle", family: "shapes", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { fill: FILL } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const r = dist(p0.x, p0.y, p1.x, p1.y);
    return [{ k: "ellipse", cx: p0.x, cy: p0.y, rx: r, ry: r, fill: d.style.fill }, line(p0, p1, { dash: "dotted", width: 1, hit: false }), ...inner(d.style.text, p0)];
  },
});

export const triangle = tool({
  id: "triangle", label: "Triangle", family: "shapes", gesture: "clicks", anchors: 3,
  defaults: () => ({ style: { fill: FILL } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const ps = pxs(c, d);
    return [poly(ps, { close: true, fill: d.style.fill })];
  },
});

/** Arc from a to b through m on their circumcircle: [cx, cy, r, from, to] in radians, or null when collinear. */
export function arcThrough(a: Pt, b: Pt, m: Pt): { cx: number; cy: number; r: number; a0: number; a1: number } | null {
  const cc = circumcircle(a, b, m);
  if (!cc) return null;
  const ang = (p: Pt) => Math.atan2(p.y - cc.cy, p.x - cc.cx);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t0 = ang(a);
  const dEnd = norm(ang(b) - t0), dMid = norm(ang(m) - t0);
  // Increasing angle reaches m before b; otherwise sweep the other way round.
  return { ...cc, a0: t0, a1: dMid < dEnd ? t0 + dEnd : t0 - (2 * Math.PI - dEnd) };
}

export const arc = tool({
  id: "arc", label: "Arc", family: "shapes", gesture: "clicks", anchors: 3,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b, m] = pxs(c, d) as [Pt, Pt, Pt];
    const g = arcThrough(a, b, m);
    return g ? [{ k: "arc", cx: g.cx, cy: g.cy, r: g.r, a0: g.a0, a1: g.a1, fill: d.style.fill }] : [line(a, b)];
  },
});

export const curve = tool({
  id: "curve", label: "Curve", family: "shapes", gesture: "clicks", anchors: 3,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b, m] = pxs(c, d) as [Pt, Pt, Pt];
    return [{ k: "poly", pts: quadPoints(a, controlThrough(a, m, b), b) }];
  },
});

export const doubleCurve = tool({
  id: "doubleCurve", label: "Double curve", family: "shapes", gesture: "clicks", anchors: 4,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    // Two quadratics joined at the midpoint of start and end; each passes through its bend anchor.
    const [a, b, m1, m2] = pxs(c, d) as [Pt, Pt, Pt, Pt];
    const j = mid(a, b);
    return [{ k: "poly", pts: [...quadPoints(a, controlThrough(a, m1, j), j), ...quadPoints(j, controlThrough(j, m2, b), b)] }];
  },
});

export const polyline = tool({
  id: "polyline", label: "Polyline", family: "shapes", gesture: "clicks", anchors: 2, variable: true,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const ps = pxs(c, d);
    return [poly(ps, { close: d.style.fill !== null, fill: d.style.fill })];
  },
});

export const path = tool({
  id: "path", label: "Path", family: "shapes", gesture: "clicks", anchors: 2, variable: true,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const ps = pxs(c, d);
    return [poly(ps), head(ps[ps.length - 2]!, ps[ps.length - 1]!, 6 + d.style.width * 2, d.style.color)];
  },
});

export const brush = tool({
  id: "brush", label: "Brush", family: "shapes", gesture: "freehand", anchors: 2, variable: true, noHandles: true,
  defaults: () => ({ style: { width: 2 } }),
  validate: finiteAnchors,
  shapes: (d, c) => [poly(pxs(c, d))],
});

export const highlighter = tool({
  id: "highlighter", label: "Highlighter", family: "shapes", gesture: "freehand", anchors: 2, variable: true, noHandles: true,
  defaults: () => ({ style: { width: 14, color: "rgba(255,235,59,0.4)" } }),
  validate: finiteAnchors,
  shapes: (d, c) => [poly(pxs(c, d))],
});

export const figureTools: ToolDef[] = [rectangle, rotatedRectangle, ellipse, circle, triangle, arc, curve, doubleCurve, polyline, path, brush, highlighter];
export { A, needDistinctTimes, px };
