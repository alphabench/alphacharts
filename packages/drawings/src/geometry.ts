// Planar geometry for tools and hit-testing, in CSS px. Pure functions.

export interface Pt {
  x: number;
  y: number;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Distance from (px, py) to the segment (x1,y1)-(x2,y2). */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

/**
 * The part of the line through a→b to draw inside [-m, W+m]×[-m, H+m]:
 * the segment itself, plus the ray beyond a (extA) and/or beyond b (extB).
 * Null when nothing of it is inside.
 */
export function clipLine(
  x1: number, y1: number, x2: number, y2: number,
  extA: boolean, extB: boolean, W: number, H: number, m = 2,
): [number, number, number, number] | null {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return null;
  let t0 = -Infinity, t1 = Infinity;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, x1 + m) || !clip(dx, W + m - x1) || !clip(-dy, y1 + m) || !clip(dy, H + m - y1)) return null;
  const lo = extA ? t0 : Math.max(t0, 0);
  const hi = extB ? t1 : Math.min(t1, 1);
  if (lo > hi) return null;
  return [x1 + lo * dx, y1 + lo * dy, x1 + hi * dx, y1 + hi * dy];
}

/** Flat [x0,y0,x1,y1,…] points of an ellipse (rotated by rot), n segments. */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, rot: number, n = 72): number[] {
  const out: number[] = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    out.push(cx + x * c - y * s, cy + x * s + y * c);
  }
  return out;
}

/** Flat points along a circular arc from angle a0 to a1 (radians, y down). */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): number[] {
  const n = Math.max(6, Math.min(180, Math.ceil((Math.abs(a1 - a0) * r) / 4)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Quadratic Bézier points p0, control c, p1. */
export function quadPoints(p0: Pt, c: Pt, p1: Pt, n = 48): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, u * u * p0.y + 2 * u * t * c.y + t * t * p1.y);
  }
  return out;
}

/** The quadratic control point that makes the curve p0→p1 pass through `through` at t = 0.5. */
export function controlThrough(p0: Pt, through: Pt, p1: Pt): Pt {
  return { x: 2 * through.x - (p0.x + p1.x) / 2, y: 2 * through.y - (p0.y + p1.y) / 2 };
}

/** Circle through three points, or null when they are collinear. */
export function circumcircle(a: Pt, b: Pt, c: Pt): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: dist(cx, cy, a.x, a.y) };
}

export function pointInPolygon(px: number, py: number, pts: readonly number[]): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i]!, yi = pts[2 * i + 1]!, xj = pts[2 * j]!, yj = pts[2 * j + 1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polyline (flat xy), optionally closed. */
export function distToPolyline(px: number, py: number, pts: readonly number[], close: boolean): number {
  const n = pts.length / 2;
  if (n === 0) return Infinity;
  if (n === 1) return dist(px, py, pts[0]!, pts[1]!);
  let best = Infinity;
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    best = Math.min(best, distToSegment(px, py, pts[2 * i]!, pts[2 * i + 1]!, pts[2 * j]!, pts[2 * j + 1]!));
  }
  return best;
}

/** Intersection of lines a1→a2 and b1→b2, or null when parallel. */
export function intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

/** Filled arrow head at (x2,y2) for a line coming from (x1,y1): flat polygon. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): number[] {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 0.45;
  return [x2, y2, x2 - size * Math.cos(a - s), y2 - size * Math.sin(a - s), x2 - size * Math.cos(a + s), y2 - size * Math.sin(a + s)];
}
