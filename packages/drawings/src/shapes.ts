// Drawing and hit-testing shapes. Both are generic over Shape, so a tool is
// only a function from a drawing to shapes.
//
// Hit-testing is in pane CSS px. Strokes hit within `tol`; filled shapes hit
// inside; text hits its (padded) box. Ellipses and arcs are tested as
// polylines, so the test and the picture can differ by a sub-pixel.

import { isColorSlot, parseColor, rgba } from "@alphacharts/core";
import { arcPoints, clipLine, distToPolyline, distToSegment, ellipsePoints, pointInPolygon } from "./geometry.js";
import type { Dash, DrawingStyle, Shape } from "./types.js";

export function dashPattern(d: Dash, w: number): number[] {
  return d === "solid" ? [] : d === "dashed" ? [4 * w, 3 * w] : [w, 2 * w];
}

/** Black or white, whichever has more contrast with `bg` (WCAG relative luminance). */
export function contrastOn(bg: string): string {
  const c = rgba(parseColor(bg));
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? "#ffffff" : "#000000";
}

/** Tools call withAlpha for every shape on every frame; the colours repeat. */
const alphaCache = new Map<string, string>();

/** `color` with its alpha replaced by `a` (0..1), as an rgba() string; a colour slot keeps its name ("chart-2/0.07"). */
export function withAlpha(color: string, a: number): string {
  if (isColorSlot(color)) return `${color.split("/")[0]}/${a}`;
  const key = `${color}|${a}`;
  let out = alphaCache.get(key);
  if (out === undefined) {
    if (alphaCache.size > 2048) alphaCache.clear();
    const c = rgba(parseColor(color));
    out = `rgba(${Math.round(c[0]! * 255)},${Math.round(c[1]! * 255)},${Math.round(c[2]! * 255)},${a})`;
    alphaCache.set(key, out);
  }
  return out;
}

const fontCache = new Map<string, string>();

export function font(style: DrawingStyle, size?: number): string {
  const sz = size ?? style.fontSize;
  const key = `${style.italic ? "i" : ""}${style.bold ? "b" : ""}${sz}`;
  let f = fontCache.get(key);
  if (f === undefined) {
    if (fontCache.size > 512) fontCache.clear();
    f = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${sz}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    fontCache.set(key, f);
  }
  return f;
}

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Text box of a text shape; `measure` returns the text width in px. */
export function textBox(s: Extract<Shape, { k: "text" }>, style: DrawingStyle, measure: (text: string, font: string) => number): TextBox {
  const size = s.size ?? style.fontSize;
  const pad = s.pad ?? (s.bg || s.border ? 4 : 0);
  const f = font(style, size);
  let w: number, nLines: number;
  if (s.text.indexOf("\n") < 0) {
    w = measure(s.text, f) + 2 * pad;
    nLines = 1;
  } else {
    const lines = s.text.split("\n");
    w = Math.max(...lines.map((l) => measure(l, f))) + 2 * pad;
    nLines = lines.length;
  }
  const h = nLines * size * 1.25 + 2 * pad;
  const x = s.align === "right" ? s.x - w : s.align === "center" ? s.x - w / 2 : s.x;
  const y = s.base === "bottom" ? s.y - h : s.base === "middle" ? s.y - h / 2 : s.y;
  return { x, y, w, h };
}

/**
 * Moves the `stack` labels of one pane apart: in order from the top, a label that overlaps one already placed is
 * moved down until it clears it. Mutates the shapes (they are made anew for each frame); nothing else is touched.
 */
export function declutter(items: readonly { s: Extract<Shape, { k: "text" }>; style: DrawingStyle }[], measure: (text: string, font: string) => number): void {
  const placed: TextBox[] = [];
  const boxes = items.map((it) => ({ it, b: textBox(it.s, it.style, measure) })).sort((a, z) => a.b.y - z.b.y);
  for (const { it, b } of boxes) {
    let y = b.y;
    for (let again = true, guard = 0; again && guard < 64; guard++) {
      again = false;
      for (const o of placed) {
        if (b.x < o.x + o.w && o.x < b.x + b.w && y < o.y + o.h && o.y < y + b.h) {
          y = o.y + o.h + 1;
          again = true;
        }
      }
    }
    if (y !== b.y) it.s.y += y - b.y;
    placed.push({ x: b.x, y, w: b.w, h: b.h });
  }
}

/** Text widths by font, then text: measuring is the dearest part of drawing a label. */
const widths = new Map<string, Map<string, number>>();
let widthEntries = 0;

function cachedWidth(ctx: CanvasRenderingContext2D, text: string, f: string): number {
  let byText = widths.get(f);
  if (!byText) widths.set(f, (byText = new Map()));
  let w = byText.get(text);
  if (w === undefined) {
    if (widthEntries > 4096) {
      widths.clear();
      widthEntries = 0;
      widths.set(f, (byText = new Map()));
    }
    ctx.font = f;
    byText.set(text, (w = ctx.measureText(text).width));
    widthEntries++;
  }
  return w;
}

/** True when the box [x0,x1]×[y0,y1] misses the pane [0,W]×[0,H] by more than `m`: nothing of it can show. */
function offPane(x0: number, y0: number, x1: number, y1: number, W: number, H: number, m: number): boolean {
  return x1 < -m || x0 > W + m || y1 < -m || y0 > H + m;
}

export function drawShapes(
  ctx: CanvasRenderingContext2D, shapes: readonly Shape[], style: DrawingStyle, W: number, H: number,
  opts: { widthBoost?: number; resolve?: (color: string) => string } = {},
): void {
  const boost = opts.widthBoost ?? 0;
  // A colour slot ("chart-2", "chart-up" …) is the chart theme's colour; the plugin passes the resolver.
  const R = opts.resolve ?? ((c: string) => c);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Only touch a context property when it changes: each assignment is a call into the browser.
  let curStroke: string | undefined, curFill: string | undefined, curWidth = -1, curDash: string | undefined;
  const stroke = (s: Shape): boolean => {
    const w = (s.width ?? style.width) + boost;
    if (w <= 0) return false;
    const c = R(s.color ?? style.color);
    if (c !== curStroke) ctx.strokeStyle = curStroke = c;
    if (w !== curWidth) ctx.lineWidth = curWidth = w;
    const d = s.dash ?? style.dash;
    const dk = d === "solid" ? "" : `${d}${w}`;
    if (dk !== curDash) {
      ctx.setLineDash(dashPattern(d, w));
      curDash = dk;
    }
    return true;
  };
  const fill = (raw: string): void => {
    const c = R(raw);
    if (c !== curFill) ctx.fillStyle = curFill = c;
  };
  for (const s of shapes) {
    // Anything wholly outside the (clipped) pane is not drawn: panned-away drawings cost no canvas calls.
    const m = (s.width ?? style.width) + boost + 2;
    switch (s.k) {
      case "line": {
        const seg = clipLine(s.x1, s.y1, s.x2, s.y2, s.extA ?? false, s.extB ?? false, W, H);
        if (!seg || !stroke(s)) break;
        ctx.beginPath();
        ctx.moveTo(seg[0], seg[1]);
        ctx.lineTo(seg[2], seg[3]);
        ctx.stroke();
        break;
      }
      case "poly": {
        const n = s.pts.length / 2;
        if (n < 2) break;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < s.pts.length; i += 2) {
          const x = s.pts[i]!, y = s.pts[i + 1]!;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        if (offPane(x0, y0, x1, y1, W, H, m)) break;
        ctx.beginPath();
        ctx.moveTo(s.pts[0]!, s.pts[1]!);
        for (let i = 1; i < n; i++) ctx.lineTo(s.pts[2 * i]!, s.pts[2 * i + 1]!);
        if (s.close) ctx.closePath();
        if (s.fill) {
          fill(s.fill);
          ctx.fill();
        }
        if (stroke(s)) ctx.stroke();
        break;
      }
      case "ellipse": {
        const r = Math.max(Math.abs(s.rx), Math.abs(s.ry));
        if (offPane(s.cx - r, s.cy - r, s.cx + r, s.cy + r, W, H, m)) break;
        ctx.beginPath();
        ctx.ellipse(s.cx, s.cy, Math.max(0, s.rx), Math.max(0, s.ry), s.rot ?? 0, 0, Math.PI * 2);
        if (s.fill) {
          fill(s.fill);
          ctx.fill();
        }
        if (stroke(s)) ctx.stroke();
        break;
      }
      case "arc": {
        if (offPane(s.cx - Math.abs(s.r), s.cy - Math.abs(s.r), s.cx + Math.abs(s.r), s.cy + Math.abs(s.r), W, H, m)) break;
        ctx.beginPath();
        if (s.fill) ctx.moveTo(s.cx, s.cy);
        ctx.arc(s.cx, s.cy, Math.max(0, s.r), s.a0, s.a1, s.a1 < s.a0);
        if (s.fill) {
          ctx.closePath();
          fill(s.fill);
          ctx.fill();
        }
        if (stroke(s)) ctx.stroke();
        break;
      }
      case "text": {
        const size = s.size ?? style.fontSize;
        const b = textBox(s, style, (t, f) => cachedWidth(ctx, t, f));
        if (offPane(b.x, b.y, b.x + b.w, b.y + b.h, W, H, 2)) break;
        ctx.font = font(style, size);
        if (s.bg) {
          fill(s.bg);
          ctx.fillRect(b.x, b.y, b.w, b.h);
        }
        if (s.border) {
          ctx.strokeStyle = curStroke = R(s.border);
          ctx.lineWidth = curWidth = 1;
          ctx.setLineDash([]);
          curDash = "";
          ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        }
        // "contrast": black or white, whichever reads on the label's own background (a label drawn in the drawing's colour)
        fill(s.textColor === "contrast" ? contrastOn(s.bg ? R(s.bg) : "#000000") : s.textColor ?? style.textColor);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const pad = s.pad ?? (s.bg || s.border ? 4 : 0);
        if (s.text.indexOf("\n") < 0) ctx.fillText(s.text, b.x + pad, b.y + pad + size * 0.125);
        else s.text.split("\n").forEach((line, i) => ctx.fillText(line, b.x + pad, b.y + pad + i * size * 1.25 + size * 0.125));
        break;
      }
    }
  }
  ctx.setLineDash([]);
}

/** Flat polylines (and fill flags) a shape is tested as. */
function outlines(s: Shape, W: number, H: number): Array<{ pts: number[]; close: boolean; fill: boolean }> {
  switch (s.k) {
    case "line": {
      const seg = clipLine(s.x1, s.y1, s.x2, s.y2, s.extA ?? false, s.extB ?? false, W, H, 1e6);
      return seg ? [{ pts: [...seg], close: false, fill: false }] : [];
    }
    case "poly":
      return [{ pts: s.pts, close: s.close ?? false, fill: !!s.fill }];
    case "ellipse":
      return [{ pts: ellipsePoints(s.cx, s.cy, s.rx, s.ry, s.rot ?? 0), close: true, fill: !!s.fill }];
    case "arc": {
      const pts = arcPoints(s.cx, s.cy, s.r, s.a0, s.a1);
      return [{ pts: s.fill ? [s.cx, s.cy, ...pts] : pts, close: !!s.fill, fill: !!s.fill }];
    }
    case "text":
      return [];
  }
}

/**
 * Distance 0 when (x, y) is inside a filled shape or a text box, else the
 * distance to the nearest stroke; Infinity when the shape is not hittable.
 */
export function shapeDistance(
  s: Shape, x: number, y: number, W: number, H: number, style: DrawingStyle, measure: (t: string, f: string) => number,
): number {
  if (s.hit === false) return Infinity;
  if (s.k === "text") {
    const b = textBox(s, style, measure);
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w)), dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    return Math.hypot(dx, dy);
  }
  if (s.k === "line") {
    const seg = clipLine(s.x1, s.y1, s.x2, s.y2, s.extA ?? false, s.extB ?? false, W, H, 1e6);
    return seg ? distToSegment(x, y, seg[0], seg[1], seg[2], seg[3]) : Infinity;
  }
  let best = Infinity;
  for (const o of outlines(s, W, H)) {
    if (o.fill && o.close && pointInPolygon(x, y, o.pts)) return 0;
    const stroked = (s.width ?? 1) > 0;
    if (stroked || !o.fill) best = Math.min(best, distToPolyline(x, y, o.pts, o.close));
  }
  return best;
}

/** True when any outline vertex (or a text box corner) of the shape lies in the rectangle. */
export function shapeInRect(s: Shape, x0: number, y0: number, x1: number, y1: number, W: number, H: number): boolean {
  const lo = (a: number, b: number) => Math.min(a, b), hi = (a: number, b: number) => Math.max(a, b);
  const inside = (x: number, y: number) => x >= lo(x0, x1) && x <= hi(x0, x1) && y >= lo(y0, y1) && y <= hi(y0, y1);
  if (s.hit === false) return false;
  if (s.k === "text") return inside(s.x, s.y);
  if (s.k === "line" && (inside(s.x1, s.y1) || inside(s.x2, s.y2))) return true;
  for (const o of outlines(s, W, H)) {
    for (let i = 0; i < o.pts.length; i += 2) if (inside(o.pts[i]!, o.pts[i + 1]!)) return true;
  }
  return false;
}
