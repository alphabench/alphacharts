// Mark renderers (Canvas2D). Coordinates are CSS px on a context scaled by the
// device pixel ratio; rectangle edges and hairlines are snapped to whole device
// pixels so neighbours share an edge and nothing blurs.

import { crisp, drawWatermark } from "@alphacharts/core";
import { scaleAlpha, textOn, withAlpha } from "./color.js";
import { visible, type PArea, type PBar, type PCandle, type PHeat, type PHist, type PLine, type PRule, type PScatter, type PTree, type PMark } from "./model.js";
import { isBand, type Panel, type PosScale } from "./panel.js";
import { placeLabels, type Box, type Circle } from "./labels.js";
import type { AreaMark, Curve, LabelChip, ScatterShape, TextMark } from "./spec.js";
import { leaves, treemap, type Tile } from "./treemap.js";

export const snapTo = (v: number, dpr: number): number => Math.round(v * dpr) / dpr;

// ---- bars ------------------------------------------------------------------

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel rectangle of bar i of `m` (before device snapping). NaN fields when the datum is missing. */
export function barRect(p: Panel, m: PBar, i: number): BarRect {
  const vertical = m.orient === "v";
  const catScale: PosScale = vertical ? p.sx : p.sy;
  const valScale: PosScale = vertical ? p.yScaleOf(m.yAxis) : p.sx;
  let c0: number, thick: number;
  if (isBand(catScale)) {
    const slotW = catScale.bandwidth / m.slots;
    c0 = catScale.map(m.pos.cat![i]!) + m.slot * slotW;
    thick = slotW;
    if (m.slots > 1) {
      c0 += 0.5;
      thick -= 1;
    }
  } else {
    const c = m.pos.num![i]!;
    const hw = (m.mark.width ?? p.widthOf(m)) / 2;
    const a = catScale.map(c - hw), b = catScale.map(c + hw);
    const total = Math.abs(b - a);
    const slotW = total / m.slots;
    c0 = Math.min(a, b) + m.slot * slotW;
    thick = slotW - (m.slots > 1 ? 1 : 0);
  }
  if (isBand(valScale)) return { x: NaN, y: NaN, w: NaN, h: NaN };
  // A log axis has no zero: bars rise from the bottom of the axis.
  const lo0 = valScale.kind === "log" && !(m.lo[i]! > 0) ? Math.min(...valScale.domain) : m.lo[i]!;
  const v0 = valScale.map(lo0), v1 = valScale.map(m.hi[i]!);
  const lo = Math.min(v0, v1), len = Math.abs(v1 - v0);
  return vertical ? { x: c0, y: lo, w: thick, h: len } : { x: lo, y: c0, w: len, h: thick };
}

function drawBars(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PBar): void {
  const th = p.theme;
  const n = m.pos.length;
  const tick = 1 / dpr;
  for (let i = 0; i < n; i++) {
    const r = barRect(p, m, i);
    if (!(r.w === r.w) || !(r.h === r.h)) continue;
    if (m.hi[i] === m.lo[i]) continue;
    const x0 = snapTo(r.x, dpr), y0 = snapTo(r.y, dpr);
    let x1 = snapTo(r.x + r.w, dpr), y1 = snapTo(r.y + r.h, dpr);
    if (x1 - x0 < tick) x1 = x0 + tick;
    if (y1 - y0 < tick) y1 = y0 + tick;
    const colour = m.colors ? m.colors[i]! : m.sign ? (m.value[i]! >= 0 ? m.sign.positive : m.sign.negative) : m.color;
    // Opacity multiplies the colour's own alpha; outlines and value labels stay opaque.
    ctx.fillStyle = scaleAlpha(colour, m.mark.opacity ?? 1);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const stroke = m.mark.strokes?.[i];
    if (stroke) {
      // Inside the bar's edge, so neighbours' outlines never overlap and the bar keeps its footprint.
      const lw = Math.min(m.mark.strokeWidth ?? 1.5, (x1 - x0) / 2, (y1 - y0) / 2);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, x1 - x0 - lw, y1 - y0 - lw);
    }
    if (m.mark.labels) {
      const text = p.o.fmt.value(m.value[i]!);
      ctx.fillStyle = th.textMuted;
      ctx.font = p.font;
      if (m.orient === "v") {
        ctx.textAlign = "center";
        const up = m.hi[i]! >= m.lo[i]!;
        ctx.textBaseline = up ? "bottom" : "top";
        ctx.fillText(text, (x0 + x1) / 2, up ? y0 - 2 : y1 + 2);
      } else {
        ctx.textBaseline = "middle";
        const right = m.hi[i]! >= m.lo[i]!;
        ctx.textAlign = right ? "left" : "right";
        ctx.fillText(text, right ? x1 + 4 : x0 - 4, (y0 + y1) / 2);
      }
    }
  }
}

// ---- lines and areas --------------------------------------------------------

/** Runs of consecutive finite points: [start, end) index pairs. */
function runs(xs: ArrayLike<number>, ys: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i < ys.length; i++) {
    const ok = xs[i]! === xs[i]! && ys[i]! === ys[i]!;
    if (ok && s < 0) s = i;
    else if (!ok && s >= 0) {
      out.push([s, i]);
      s = -1;
    }
  }
  if (s >= 0) out.push([s, ys.length]);
  return out;
}

/** Fewer points for a dense run: first, min, max and last of every device-pixel column. */
function decimate(xs: number[], ys: number[], dpr: number, width: number): [number[], number[]] {
  const n = xs.length;
  if (n <= 2 * width * dpr) return [xs, ys];
  for (let i = 1; i < n; i++) if (xs[i]! < xs[i - 1]!) return [xs, ys]; // only x-sorted data
  const ox: number[] = [], oy: number[] = [];
  let i = 0;
  while (i < n) {
    const col = Math.floor(xs[i]! * dpr);
    let j = i, lo = i, hi = i;
    while (j + 1 < n && Math.floor(xs[j + 1]! * dpr) === col) {
      j++;
      if (ys[j]! < ys[lo]!) lo = j;
      if (ys[j]! > ys[hi]!) hi = j;
    }
    const idx = [...new Set([i, lo, hi, j])].sort((a, b) => a - b);
    for (const k of idx) {
      ox.push(xs[k]!);
      oy.push(ys[k]!);
    }
    i = j + 1;
  }
  return [ox, oy];
}

/** Add the polyline through the points to the path; `moveFirst` starts a new subpath, else continues with a line. */
function trace(path: CanvasRenderingContext2D | Path2D, xs: number[], ys: number[], curve: Curve, moveFirst: boolean): void {
  const n = xs.length;
  if (n === 0) return;
  if (moveFirst) path.moveTo(xs[0]!, ys[0]!);
  else path.lineTo(xs[0]!, ys[0]!);
  if (curve === "monotone" && n > 2) {
    const dx: number[] = [], d: number[] = [], m: number[] = new Array<number>(n);
    for (let i = 0; i < n - 1; i++) {
      dx.push(xs[i + 1]! - xs[i]!);
      d.push(dx[i] === 0 ? 0 : (ys[i + 1]! - ys[i]!) / dx[i]!);
    }
    m[0] = d[0]!;
    m[n - 1] = d[n - 2]!;
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!;
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i]!;
        m[i + 1] = t * b * d[i]!;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i]! / 3;
      path.bezierCurveTo(xs[i]! + h, ys[i]! + m[i]! * h, xs[i + 1]! - h, ys[i + 1]! - m[i + 1]! * h, xs[i + 1]!, ys[i + 1]!);
    }
    return;
  }
  for (let i = 1; i < n; i++) {
    const x0 = xs[i - 1]!, y0 = ys[i - 1]!, x = xs[i]!, y = ys[i]!;
    if (curve === "step") {
      const xm = (x0 + x) / 2;
      path.lineTo(xm, y0);
      path.lineTo(xm, y);
    } else if (curve === "stepAfter") path.lineTo(x, y0);
    else if (curve === "stepBefore") path.lineTo(x0, y);
    path.lineTo(x, y);
  }
}

const reverseCurve = (c: Curve): Curve => (c === "stepAfter" ? "stepBefore" : c === "stepBefore" ? "stepAfter" : c);

function pixels(p: Panel, pos: { num: Float64Array | null; cat: string[] | null }, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = p.xPx(pos, i);
  return out;
}

function drawLine(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PLine): void {
  const sy = p.yScaleOf(m.yAxis);
  if (isBand(sy)) return;
  const xs = pixels(p, m.pos, m.y.length);
  const ys = Float64Array.from(m.y, (v) => sy.map(v));
  ctx.strokeStyle = m.color;
  ctx.lineWidth = m.mark.width ?? 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(m.mark.dash ? [...m.mark.dash] : []);
  ctx.beginPath();
  for (const [a, b] of runs(xs, ys)) {
    const [rx, ry] = decimate(Array.from(xs.subarray(a, b)), Array.from(ys.subarray(a, b)), dpr, p.area.w);
    trace(ctx, rx, ry, m.curve, true);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (m.mark.points) {
    ctx.fillStyle = m.color;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      if (xs[i]! !== xs[i]! || ys[i]! !== ys[i]!) continue;
      ctx.moveTo(xs[i]! + 2.5, ys[i]!);
      ctx.arc(xs[i]!, ys[i]!, 2.5, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function drawArea(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PArea): void {
  const sy = p.yScaleOf(m.yAxis);
  if (isBand(sy)) return;
  const n = m.hi.length;
  const xs = pixels(p, m.pos, n);
  const top = Float64Array.from(m.hi, (v) => sy.map(v));
  let floorPx = 0;
  if (m.autoBase) {
    const [d0, d1] = sy.domain;
    floorPx = sy.map(Math.min(Math.max(0, Math.min(d0, d1)), Math.max(d0, d1)));
  }
  const bot = Float64Array.from(m.lo, (v) => (m.autoBase ? floorPx : sy.map(v)));
  const isBandMark = m.type === "errorBand";
  const opacity = m.mark.opacity ?? (isBandMark ? 0.2 : 0.25);
  const split = m.type === "area" ? (m.mark as { split?: { above?: string; below?: string } }).split : undefined;
  const th = p.theme;
  const a = p.area;

  const fillPath = new Path2D();
  const linePath = new Path2D();
  for (const [s, e] of runs(xs, top)) {
    const [tx, ty] = decimate(Array.from(xs.subarray(s, e)), Array.from(top.subarray(s, e)), dpr, a.w);
    const bx = Array.from(xs.subarray(s, e)).reverse(), by = Array.from(bot.subarray(s, e)).reverse();
    trace(fillPath, tx, ty, m.curve, true);
    trace(fillPath, bx, by, reverseCurve(m.curve), false);
    fillPath.closePath();
    trace(linePath, tx, ty, m.curve, true);
  }

  const am = m.type === "area" ? (m.mark as AreaMark) : undefined;
  const baseline = m.autoBase ? floorPx : sy.map(typeof am?.y0 === "number" ? am.y0 : 0);
  // Gradient: full opacity at the line, nothing at the baseline. The far end is the point of the line furthest from the
  // baseline, on the side being painted (`side` -1: above it, 1: below it, 0: either).
  const gradient = (fill: string, side: -1 | 0 | 1): CanvasGradient | string => {
    let far = NaN;
    for (let i = 0; i < n; i++) {
      const t = top[i]!;
      if (t !== t || (side !== 0 && Math.sign(t - baseline) === -side)) continue;
      if (far !== far || Math.abs(t - baseline) > Math.abs(far - baseline)) far = t;
    }
    // Only what is on screen sets the strength: a spike far outside the plot would wash the visible fill out.
    far = Math.min(Math.max(far, a.y), a.y + a.h);
    if (!(Math.abs(far - baseline) >= 1)) return withAlpha(fill, opacity);
    const g = ctx.createLinearGradient(0, far, 0, baseline);
    g.addColorStop(0, withAlpha(fill, opacity));
    g.addColorStop(1, withAlpha(fill, 0));
    return g;
  };
  const paint = (fill: string, stroke: string, side: -1 | 0 | 1 = 0) => {
    ctx.fillStyle = am?.gradient ? gradient(fill, side) : withAlpha(fill, opacity);
    ctx.fill(fillPath);
    if (am && am.line !== false) {
      ctx.strokeStyle = am.strokeColor ?? stroke;
      ctx.lineWidth = am.width ?? 1.5;
      ctx.lineJoin = "round";
      ctx.stroke(linePath);
    }
  };

  if (split) {
    const base = typeof (m.mark as { y0?: unknown }).y0 === "number" ? ((m.mark as { y0: number }).y0) : 0;
    const yb = sy.map(base);
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, Math.max(0, yb - a.y));
    ctx.clip();
    paint(split.above ?? th.up, split.above ?? th.up, -1);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.x, yb, a.w, Math.max(0, a.y + a.h - yb));
    ctx.clip();
    paint(split.below ?? th.down, split.below ?? th.down, 1);
    ctx.restore();
  } else paint(m.color, m.color);
}

// ---- candles ------------------------------------------------------------------

/** Body rectangle x extent (CSS px, before snapping) of candle i, centred on its x. */
export function candleSpan(p: Panel, m: PCandle, i: number): { cx: number; w: number } {
  const cx = p.xPx(m.pos, i);
  if (isBand(p.sx)) return { cx, w: Math.max(1, p.sx.kind === "point" ? p.sx.step * 0.7 : p.sx.bandwidth) };
  const hw = (m.mark.width ?? p.candleWidthOf(m)) / 2;
  const a = p.sx.map(m.pos.num![i]! - hw), b = p.sx.map(m.pos.num![i]! + hw);
  return { cx, w: Math.max(1, Math.abs(b - a)) };
}

function drawCandles(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PCandle): void {
  const sy = p.yScaleOf(m.yAxis);
  if (isBand(sy)) return;
  const tick = 1 / dpr;
  const n = m.pos.length;
  // One path per colour: a candle chart is thousands of the same two shapes.
  const up = new Path2D(), down = new Path2D(), upWick = new Path2D(), downWick = new Path2D();
  for (let i = 0; i < n; i++) {
    const o = m.open[i]!, h = m.high[i]!, l = m.low[i]!, c = m.close[i]!;
    if (o !== o || h !== h || l !== l || c !== c) continue;
    const { cx, w } = candleSpan(p, m, i);
    if (cx !== cx) continue;
    const rising = c >= o;
    const yo = sy.map(o), yc = sy.map(c);
    const bx0 = snapTo(cx - w / 2, dpr);
    let bx1 = snapTo(cx + w / 2, dpr);
    if (bx1 - bx0 < tick) bx1 = bx0 + tick;
    const by0 = snapTo(Math.min(yo, yc), dpr);
    let by1 = snapTo(Math.max(yo, yc), dpr);
    if (by1 - by0 < tick) by1 = by0 + tick;
    // The wick is one device pixel wide at the body's centre line.
    const wx = crisp((bx0 + bx1) / 2, dpr);
    const wick = rising ? upWick : downWick;
    wick.moveTo(wx, sy.map(h));
    wick.lineTo(wx, sy.map(l));
    (rising ? up : down).rect(bx0, by0, bx1 - bx0, by1 - by0);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = m.up;
  ctx.stroke(upWick);
  ctx.strokeStyle = m.down;
  ctx.stroke(downWick);
  ctx.fillStyle = m.up;
  ctx.fill(up);
  ctx.fillStyle = m.down;
  ctx.fill(down);
}

// ---- scatter -----------------------------------------------------------------

export function scatterRadii(m: PScatter): Float64Array {
  const n = m.y.length;
  const out = new Float64Array(n);
  const fixed = typeof m.mark.size === "number" ? m.mark.size : 3.5;
  if (!m.size) return out.fill(fixed);
  const [rmin, rmax] = m.mark.radius ?? [3, 22];
  let lo = Infinity, hi = -Infinity;
  for (const v of m.size) {
    if (v === v) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (let i = 0; i < n; i++) {
    const t = hi > lo ? Math.sqrt(Math.max(0, (m.size[i]! - lo) / (hi - lo))) : 0.5;
    out[i] = rmin + (rmax - rmin) * t;
  }
  return out;
}

export function addShape(path: Path2D, shape: ScatterShape, x: number, y: number, r: number): void {
  switch (shape) {
    case "square": path.rect(x - r, y - r, 2 * r, 2 * r); break;
    case "diamond":
      path.moveTo(x, y - r * 1.25);
      path.lineTo(x + r * 1.25, y);
      path.lineTo(x, y + r * 1.25);
      path.lineTo(x - r * 1.25, y);
      path.closePath();
      break;
    case "triangle":
      path.moveTo(x, y - r * 1.2);
      path.lineTo(x + r * 1.1, y + r * 0.9);
      path.lineTo(x - r * 1.1, y + r * 0.9);
      path.closePath();
      break;
    case "triangleDown":
      path.moveTo(x, y + r * 1.2);
      path.lineTo(x + r * 1.1, y - r * 0.9);
      path.lineTo(x - r * 1.1, y - r * 0.9);
      path.closePath();
      break;
    case "cross":
      path.moveTo(x - r, y - r);
      path.lineTo(x + r, y + r);
      path.moveTo(x + r, y - r);
      path.lineTo(x - r, y + r);
      break;
    default:
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
  }
}

/** Colour, shape, opacity and hollowness of point i. */
export function pointStyle(p: Panel, m: PScatter, i: number): { color: string; shape: ScatterShape; opacity: number; hollow: boolean } {
  const cs = p.colors.get(m);
  const mk = m.mark;
  const color = mk.colors ? mk.colors[i]! : cs && mk.colorValue ? cs.map(mk.colorValue[i]!) : m.color;
  return { color, shape: mk.shapes ? mk.shapes[i]! : "circle", opacity: mk.opacities ? mk.opacities[i]! : (mk.opacity ?? (m.size ? 0.6 : 0.85)), hollow: mk.hollow ? mk.hollow[i]! === true : false };
}

function drawScatter(p: Panel, ctx: CanvasRenderingContext2D, m: PScatter): void {
  const sy = p.yScaleOf(m.yAxis);
  if (isBand(sy)) return;
  const n = m.y.length;
  const r = scatterRadii(m);
  const batches = new Map<string, { fill: Path2D; stroke: Path2D; style: ReturnType<typeof pointStyle> }>();
  for (let i = 0; i < n; i++) {
    const x = p.xPx(m.pos, i), y = sy.map(m.y[i]!);
    if (x !== x || y !== y) continue;
    const st = pointStyle(p, m, i);
    const key = `${st.color}|${st.shape}|${st.opacity}|${st.hollow}`;
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { fill: new Path2D(), stroke: new Path2D(), style: st }));
    addShape(st.hollow || st.shape === "cross" ? b.stroke : b.fill, st.shape, x, y, r[i]!);
  }
  for (const b of batches.values()) {
    const { color, opacity, hollow } = b.style;
    ctx.fillStyle = withAlpha(color, opacity);
    ctx.fill(b.fill);
    ctx.strokeStyle = withAlpha(color, hollow ? Math.max(opacity, 0.9) : opacity);
    ctx.lineWidth = hollow ? 1.5 : 1.5;
    ctx.stroke(b.stroke);
    if (!hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke(b.fill);
    }
  }
}

// ---- histogram ----------------------------------------------------------------

function drawHist(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PHist): void {
  const sy = p.yScaleOf(m.yAxis);
  if (isBand(sy) || isBand(p.sx)) return;
  const base = sy.map(0);
  ctx.fillStyle = withAlpha(m.color, 0.85);
  for (const b of m.bins) {
    const v = m.mark.density ? b.density : b.count;
    if (!(v > 0)) continue;
    const x0 = snapTo(p.sx.map(b.x0), dpr), x1 = snapTo(p.sx.map(b.x1), dpr);
    const y = snapTo(sy.map(v), dpr), yb = snapTo(base, dpr);
    ctx.fillRect(x0, y, Math.max(1 / dpr, x1 - x0 - 1), Math.max(1 / dpr, yb - y));
  }
}

// ---- heatmap ------------------------------------------------------------------

export function heatCell(p: Panel, m: PHeat, i: number): BarRect {
  const sx = p.sx, sy = p.sy;
  if (!isBand(sx) || !isBand(sy)) return { x: NaN, y: NaN, w: NaN, h: NaN };
  return { x: sx.map(m.xc[i]!), y: sy.map(m.yc[i]!), w: sx.bandwidth, h: sy.bandwidth };
}

function drawHeat(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PHeat): void {
  const cs = p.colors.get(m);
  if (!cs) return;
  const gap = m.mark.gap ?? 1;
  const decimals = m.mark.decimals;
  ctx.font = p.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < m.value.length; i++) {
    const v = m.value[i]!;
    if (v !== v) continue;
    const c = heatCell(p, m, i);
    if (c.x !== c.x) continue;
    const x0 = snapTo(c.x + gap / 2, dpr), x1 = snapTo(c.x + c.w - gap / 2, dpr);
    const y0 = snapTo(c.y + gap / 2, dpr), y1 = snapTo(c.y + c.h - gap / 2, dpr);
    const fill = cs.map(v);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y0, Math.max(1 / dpr, x1 - x0), Math.max(1 / dpr, y1 - y0));
    if (m.mark.labels) {
      const text = decimals !== undefined ? p.o.fmt.fixedDigits(decimals).format(v) : p.o.fmt.value(v);
      if (p.textWidth(ctx, text) + 4 <= x1 - x0 && p.theme.fontSize + 2 <= y1 - y0) {
        ctx.fillStyle = textOn(fill);
        ctx.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2);
      }
    }
  }
}

// ---- treemap ------------------------------------------------------------------

const treeCache = new WeakMap<PTree, { w: number; h: number; tile: Tile }>();

/** The laid-out tiles in the panel's area (cached per size). Tile coordinates are relative to the area. */
export function treeTiles(p: Panel, m: PTree): Tile {
  const a = p.area;
  const hit = treeCache.get(m);
  if (hit && hit.w === a.w && hit.h === a.h) return hit.tile;
  const tile = treemap(m.mark.root, a.w, a.h, { gap: m.mark.gap ?? 2, header: m.mark.header ?? 16 });
  treeCache.set(m, { w: a.w, h: a.h, tile });
  return tile;
}

export function tileColor(p: Panel, m: PTree, t: Tile, groupIndex: number): string {
  const th = p.theme;
  if (t.node.color) return t.node.color;
  const cs = p.colors.get(m);
  if (m.mark.colorBy === "value" && cs && t.children.length === 0) return cs.map(t.node.colorValue ?? t.node.value ?? 0);
  return th.palette[groupIndex % th.palette.length]!;
}

function drawTree(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PTree): void {
  const root = treeTiles(p, m);
  const a = p.area;
  ctx.font = p.font;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const byValue = m.mark.colorBy === "value";
  const total = root.value;
  const draw = (t: Tile, group: number): void => {
    const x0 = snapTo(a.x + t.x, dpr), x1 = snapTo(a.x + t.x + t.w, dpr);
    const y0 = snapTo(a.y + t.y, dpr), y1 = snapTo(a.y + t.y + t.h, dpr);
    const leaf = t.children.length === 0;
    const fill = tileColor(p, m, t, group);
    if (leaf) {
      const gap = (m.mark.gap ?? 2) / 2;
      const lx0 = x0 + gap, ly0 = y0 + gap, lw = x1 - x0 - 2 * gap, lh = y1 - y0 - 2 * gap;
      if (lw <= 0 || lh <= 0) return;
      ctx.fillStyle = byValue ? fill : withAlpha(fill, 0.85);
      ctx.fillRect(lx0, ly0, lw, lh);
      const label = t.node.name;
      const needH = p.theme.fontSize + 6;
      if (lh >= needH && lw >= 24) {
        ctx.fillStyle = textOn(fill);
        ctx.fillText(p.fit(ctx, label, lw - 8), lx0 + 4, ly0 + 3);
        // The second line is the host's own text, or the tile's share of the total said as such: a bare
        // percentage reads as the colour's value (a day's change) when it is not.
        const detail = t.node.detail ?? (total > 0 ? p.o.msg("plot.treemap.share", { value: p.o.fmt.value((t.value / total) * 100) }) : undefined);
        if (lh >= 2 * needH && detail) {
          ctx.globalAlpha = 0.8;
          ctx.fillText(p.fit(ctx, detail, lw - 8), lx0 + 4, ly0 + 3 + p.theme.fontSize + 2);
          ctx.globalAlpha = 1;
        }
      }
      return;
    }
    if (t.depth > 0) {
      const gap = (m.mark.gap ?? 2) / 2;
      ctx.fillStyle = withAlpha(fill, 0.14);
      ctx.fillRect(x0 + gap, y0 + gap, x1 - x0 - 2 * gap, y1 - y0 - 2 * gap);
      const head = m.mark.header ?? 16;
      if (head > 0 && x1 - x0 > 30) {
        ctx.fillStyle = p.theme.text;
        ctx.fillText(p.fit(ctx, t.node.name, x1 - x0 - 2 * gap - 8), x0 + gap + 4, y0 + gap + 3);
      }
    }
    t.children.forEach((c, i) => draw(c, t.depth === 0 ? i : group));
  };
  draw(root, 0);
}

export { leaves };

// ---- reference marks ------------------------------------------------------------

interface Taken {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Taken, list: Taken[]) => list.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);

function drawRule(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: PRule, taken: Taken[]): void {
  const a = p.area, th = p.theme;
  ctx.strokeStyle = m.color;
  ctx.lineWidth = m.mark.width ?? 1;
  ctx.setLineDash([...(m.mark.dash ?? [4, 3])]);
  ctx.font = p.font;
  const fs = th.fontSize;
  const sy = p.yScaleOf(m.yAxis);
  const lines: { vertical: boolean; px: number; label: string | undefined }[] = [];
  m.xs.forEach((v, i) => lines.push({ vertical: true, px: p.valuePx(p.sx, v), label: m.mark.labels?.[i] }));
  m.ys.forEach((v, i) => lines.push({ vertical: false, px: p.valuePx(sy, v), label: m.mark.labels?.[m.xs.length + i] }));
  for (const l of lines) {
    if (!(l.px === l.px)) continue;
    if (l.vertical ? l.px < a.x || l.px > a.x + a.w : l.px < a.y || l.px > a.y + a.h) continue;
    ctx.beginPath();
    if (l.vertical) {
      const x = crisp(l.px, dpr);
      ctx.moveTo(x, a.y);
      ctx.lineTo(x, a.y + a.h);
    } else {
      const y = crisp(l.px, dpr);
      ctx.moveTo(a.x, y);
      ctx.lineTo(a.x + a.w, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const l of lines) {
    if (!l.label || !(l.px === l.px)) continue;
    const w = p.textWidth(ctx, l.label);
    for (let row = 0; row < 8; row++) {
      let box: Taken;
      let tx: number, ty: number;
      if (l.vertical) {
        const right = l.px + 4 + w + 4 > a.x + a.w;
        tx = right ? l.px - 4 - w : l.px + 4;
        ty = a.y + 2 + row * (fs + 4);
        box = { x0: tx - 2, y0: ty - 1, x1: tx + w + 2, y1: ty + fs + 1 };
      } else {
        tx = a.x + a.w - 4 - w;
        ty = l.px - fs - 3 - row * (fs + 4);
        box = { x0: tx - 2, y0: ty - 1, x1: tx + w + 2, y1: ty + fs + 1 };
      }
      if (overlaps(box, taken) && row < 7) continue;
      taken.push(box);
      ctx.fillStyle = withAlpha(th.background, 0.8);
      ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.fillStyle = m.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(l.label, tx, ty);
      break;
    }
  }
}

function drawBand(p: Panel, ctx: CanvasRenderingContext2D, dpr: number, m: Extract<PMark, { type: "band" }>): void {
  const a = p.area;
  const sy = p.yScaleOf(m.yAxis);
  let x0 = a.x, x1 = a.x + a.w, y0 = a.y, y1 = a.y + a.h;
  if (m.mark.x) {
    const u = p.valuePx(p.sx, m.mark.x[0]), v = p.valuePx(p.sx, m.mark.x[1]);
    x0 = Math.min(u, v);
    x1 = Math.max(u, v);
  }
  if (m.mark.y) {
    const u = p.valuePx(sy, m.mark.y[0]), v = p.valuePx(sy, m.mark.y[1]);
    y0 = Math.min(u, v);
    y1 = Math.max(u, v);
  }
  if (!(x0 === x0 && x1 === x1 && y0 === y0 && y1 === y1)) return;
  const cx0 = Math.max(a.x, x0), cx1 = Math.min(a.x + a.w, x1), cy0 = Math.max(a.y, y0), cy1 = Math.min(a.y + a.h, y1);
  if (cx1 <= cx0 || cy1 <= cy0) return;
  ctx.fillStyle = withAlpha(m.color, m.mark.opacity ?? 0.12);
  const sx0 = snapTo(cx0, dpr), sy0 = snapTo(cy0, dpr);
  ctx.fillRect(sx0, sy0, snapTo(cx1, dpr) - sx0, snapTo(cy1, dpr) - sy0);
  if (m.mark.label) {
    ctx.font = p.font;
    ctx.fillStyle = m.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(p.fit(ctx, m.mark.label, cx1 - cx0 - 8), cx0 + 4, cy0 + 3);
  }
}

const WEIGHT = { normal: "", semibold: "600 ", bold: "700 " } as const;
const CHIP_PAD: readonly [number, number] = [4, 1];
const CHIP_RADIUS = 2;

/** Whether a text mark uses anything beyond plain text at an offset (the original path stays as it was for those that do not). */
const isStyled = (mk: TextMark): boolean => mk.chip !== undefined || mk.chips !== undefined || mk.weights !== undefined || mk.anchor !== undefined || (mk.avoid !== undefined && mk.avoid !== false);

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** A chip: background, the etch clipped to the rounded rectangle, then a 1px inset border. */
function drawChip(ctx: CanvasRenderingContext2D, b: Box, chip: LabelChip): void {
  const radius = chip.radius ?? CHIP_RADIUS;
  if (chip.background !== undefined || chip.etch) {
    roundedRect(ctx, b.x, b.y, b.w, b.h, radius);
    if (chip.background !== undefined) {
      ctx.fillStyle = chip.background;
      ctx.fill();
    }
    if (chip.etch) {
      // 135deg stripes (running bottom-left to top-right) `spacing` apart across the stripe, phase from the top-left corner.
      const pitch = (chip.etch.spacing ?? 6) * Math.SQRT2;
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      for (let c = b.x + b.y; c <= b.x + b.y + b.w + b.h; c += pitch) {
        ctx.moveTo(c - b.y + 1, b.y - 1);
        ctx.lineTo(b.x - 1, c - b.x + 1);
      }
      ctx.strokeStyle = chip.etch.color;
      ctx.lineWidth = chip.etch.width ?? 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }
  if (chip.border !== undefined) {
    roundedRect(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, Math.max(0, radius - 0.5));
    ctx.strokeStyle = chip.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawText(p: Panel, ctx: CanvasRenderingContext2D, m: Extract<PMark, { type: "text" }>, placed: Box[]): void {
  const mk = m.mark;
  const sy = p.yScaleOf(m.yAxis);
  const size = mk.size ?? p.theme.fontSize;
  const px = (i: number): [number, number] => [p.xPx(m.x, i), isBand(sy) ? sy.center(m.y.cat![i]!) : sy.map(m.y.num![i]!)];
  if (!isStyled(mk)) {
    ctx.font = mk.size ? `${mk.size}px ${p.theme.fontFamily}` : p.font;
    ctx.fillStyle = m.color;
    ctx.textAlign = mk.align ?? "center";
    ctx.textBaseline = mk.baseline ?? "middle";
    for (let i = 0; i < mk.text.length; i++) {
      const [x, y] = px(i);
      if (x !== x || y !== y) continue;
      ctx.fillText(mk.text[i]!, x + (mk.dx ?? 0), y + (mk.dy ?? 0));
    }
    return;
  }
  const n = mk.text.length;
  // Each label's chip (own, else the mark's default; null is plain text) and its box size.
  const chips = Array.from({ length: n }, (_, i) => (mk.chips ? mk.chips[i] : mk.chip) ?? null);
  const fonts = Array.from({ length: n }, (_, i) => `${WEIGHT[mk.weights?.[i] ?? "normal"]}${size}px ${p.theme.fontFamily}`);
  const pads = chips.map((c) => (c ? (typeof c.padding === "number" ? [c.padding, c.padding] : (c.padding ?? CHIP_PAD)) : [0, 0]) as readonly [number, number]);
  const sizes = Array.from({ length: n }, (_, i) => ({ w: Math.ceil(p.textWidth(ctx, mk.text[i]!, fonts[i]!)) + 2 * Math.round(pads[i]![0]), h: Math.ceil(size) + 2 * Math.round(pads[i]![1]) }));
  const at = Array.from({ length: n }, (_, i) => px(i));
  let boxes: (Box | null)[];
  if (mk.avoid !== undefined && mk.avoid !== false) {
    const opt = mk.avoid === true ? {} : mk.avoid;
    const own = mk.anchor?.radius;
    const from = own === undefined && mk.anchor?.from !== undefined ? p.prepared.marks.find((o): o is PScatter => o.type === "scatter" && o.mark.name === mk.anchor!.from) : undefined;
    const fromR = from ? scatterRadii(from) : undefined;
    const anchors = at.map(([x, y], i) => ({ x, y, r: typeof own === "number" ? own : own ? own[i]! : (fromR?.[i] ?? 0) }));
    const circles: Circle[] = [];
    if (opt.marks !== false) {
      for (const o of visible(p.prepared)) {
        if (o.type !== "scatter") continue;
        const sc = p.yScaleOf(o.yAxis);
        if (isBand(sc)) continue;
        const r = scatterRadii(o);
        for (let k = 0; k < o.y.length; k++) {
          const cx = p.xPx(o.pos, k), cy = sc.map(o.y[k]!);
          if (cx === cx && cy === cy) circles.push({ x: cx, y: cy, r: r[k]! });
        }
      }
    }
    boxes = placeLabels({ anchors, sizes, area: p.area, circles, placed, ...(opt.order ? { order: opt.order } : {}) });
  } else {
    boxes = at.map(([x, y], i) => {
      if (x !== x || y !== y) return null;
      const { w, h } = sizes[i]!;
      const tx = x + (mk.dx ?? 0), ty = y + (mk.dy ?? 0);
      const al = mk.align ?? "center", bl = mk.baseline ?? "middle";
      return { x: Math.round(al === "left" ? tx : al === "right" ? tx - w : tx - w / 2), y: Math.round(bl === "top" ? ty : bl === "bottom" ? ty - h : ty - h / 2), w, h };
    });
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    if (!b) continue;
    const chip = chips[i];
    if (chip) drawChip(ctx, b, chip);
    ctx.font = fonts[i]!;
    ctx.fillStyle = chip?.color ?? m.color;
    ctx.fillText(mk.text[i]!, b.x + Math.round(pads[i]![0]), b.y + b.h / 2);
  }
}

// ---- entry ------------------------------------------------------------------------

/** Draw the panel's axes and marks. */
export function drawPanel(p: Panel, ctx: CanvasRenderingContext2D, dpr: number): void {
  const th = p.theme;
  if (p.o.title) {
    ctx.font = `600 ${th.fontSize}px ${th.fontFamily}`;
    ctx.fillStyle = th.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(p.o.title, p.area.x, p.rect.y + 4);
  }
  if (!p.prepared.noAxes) p.drawAxes(ctx, dpr);
  const a = p.area;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  ctx.clip();
  const marks = visible(p.prepared);
  const taken: Taken[] = [];
  const placed: Box[] = [];
  for (const m of marks) if (m.type === "band") drawBand(p, ctx, dpr, m);
  for (const m of marks) {
    ctx.save();
    switch (m.type) {
      case "bar": drawBars(p, ctx, dpr, m); break;
      case "area": case "errorBand": drawArea(p, ctx, dpr, m); break;
      case "candle": drawCandles(p, ctx, dpr, m); break;
      case "line": drawLine(p, ctx, dpr, m); break;
      case "histogram": drawHist(p, ctx, dpr, m); break;
      case "heatmap": drawHeat(p, ctx, dpr, m); break;
      case "treemap": drawTree(p, ctx, dpr, m); break;
      case "scatter": drawScatter(p, ctx, m); break;
      default: break;
    }
    ctx.restore();
  }
  for (const m of marks) {
    ctx.save();
    if (m.type === "rule") drawRule(p, ctx, dpr, m, taken);
    else if (m.type === "text") drawText(p, ctx, m, placed);
    ctx.restore();
  }
  if (p.o.watermark) {
    ctx.save();
    ctx.translate(a.x, a.y);
    drawWatermark(ctx, a.w, a.h, th, p.o.watermark);
    ctx.restore();
  }
  ctx.restore();
}
