// Canvas2D series renderers: the fallback when WebGL2 is unavailable. Same
// level-of-detail choice and the same integer pixel snapping as the WebGL
// renderers (barWidths), so the two produce the same geometry; marks are
// batched into one Path2D per colour.

import { LOD_C, LOD_COLOR, LOD_H, LOD_L, LOD_O } from "../data/lod.js";
import { COL_BAR_COLOR, COL_C, COL_COLOR, COL_H, COL_L, COL_O, COL_V, type DataChange, type SeriesData } from "../data/model.js";
import type { PriceScale } from "../scale/price-scale.js";
import type { TimeScale } from "../scale/time-scale.js";
import { cssColor } from "./color.js";
import { barWidths, type AreaStyle, type BarStyle, type CandleStyle, type HistogramStyle, type LineStyle } from "./renderers.js";
import { chooseLevel } from "./window.js";

export interface DrawView2D {
  /** Transformed so (0, 0) is the pane's top-left device pixel, clipped to it. */
  readonly ctx: CanvasRenderingContext2D;
  readonly data: SeriesData;
  readonly time: TimeScale;
  readonly price: PriceScale;
  readonly dpr: number;
  /** Pane size in device px. */
  readonly width: number;
  readonly height: number;
  readonly lo: number;
  readonly hi: number;
}

export interface SeriesRenderer2D<O> {
  draw(view: DrawView2D, options: O): void;
  dataChanged(change: DataChange): void;
  dispose(): void;
}

type UnitFn = (x: number, o: number, h: number, l: number, c: number, color: number) => void;

/** Visit present units over [lo, hi] at `level`, x in device px. */
function eachUnit(v: DrawView2D, level: number, fn: UnitFn): void {
  const d = v.data, dpr = v.dpr, t = v.time;
  if (level === 0) {
    const st = d.store;
    const ohlc = d.shape === "ohlc";
    const O = st.cols[ohlc ? COL_O : COL_V]!, H = st.cols[ohlc ? COL_H : COL_V]!, L = st.cols[ohlc ? COL_L : COL_V]!, C = st.cols[ohlc ? COL_C : COL_V]!;
    const COL = ohlc ? st.cols[COL_BAR_COLOR] : st.cols[COL_COLOR];
    const a = Math.max(v.lo - 1, st.first), b = Math.min(v.hi + 1, st.end - 1);
    for (let i = a; i <= b; i++) {
      const p = st.head + (i - st.first);
      const o = O[p]!;
      if (o !== o) continue;
      fn(t.x(i) * dpr, o, H[p]!, L[p]!, C[p]!, COL ? COL[p]! : 0);
    }
    return;
  }
  const lv = d.lod.level(level);
  if (!lv) return;
  const O = lv.cols[LOD_O]!, H = lv.cols[LOD_H]!, L = lv.cols[LOD_L]!, C = lv.cols[LOD_C]!, COL = lv.cols[LOD_COLOR];
  const half = ((1 << level) - 1) / 2;
  const a = Math.max((v.lo >> level) - 1, lv.first), b = Math.min((v.hi >> level) + 1, lv.end - 1);
  for (let k = a; k <= b; k++) {
    const p = lv.head + (k - lv.first);
    const o = O[p]!;
    if (o !== o) continue;
    fn(t.x((k << level) + half) * dpr, o, H[p]!, L[p]!, C[p]!, COL ? COL[p]! : 0);
  }
}

const levelOf = (v: DrawView2D) => chooseLevel(v.data, v.time.spacing * v.dpr);
const Y = (v: DrawView2D, p: number) => v.price.y(p) * v.dpr;
const snap = (y: number) => Math.floor(y + 0.5);

abstract class Base<O> implements SeriesRenderer2D<O> {
  abstract draw(view: DrawView2D, options: O): void;
  dataChanged(): void {}
  dispose(): void {}
}

export class Candles2D extends Base<CandleStyle> {
  draw(v: DrawView2D, o: CandleStyle): void {
    const level = levelOf(v);
    const [bw, ww] = barWidths(v.time.spacing, v.dpr, level, 0.8);
    const bodyUp = new Path2D(), bodyDown = new Path2D(), wickUp = new Path2D(), wickDown = new Path2D();
    // bars with their own colour: one path per colour (body and wick alike), drawn after the plain ones
    let own: Map<number, Path2D> | undefined;
    eachUnit(v, level, (x, op, h, l, c, color) => {
      const left = Math.floor(x - bw / 2 + 0.5);
      const up = c >= op;
      const yh = snap(Y(v, h)), yl = Math.max(snap(Y(v, l)), yh + 1);
      const yt = snap(Y(v, Math.max(op, c))), yb = Math.max(snap(Y(v, Math.min(op, c))), yt + 1);
      if (color !== 0) {
        let p = (own ??= new Map()).get(color);
        if (!p) own.set(color, (p = new Path2D()));
        p.rect(left + (bw - ww) / 2, yh, ww, yl - yh);
        p.rect(left, yt, bw, yb - yt);
        return;
      }
      (up ? wickUp : wickDown).rect(left + (bw - ww) / 2, yh, ww, yl - yh);
      (up ? bodyUp : bodyDown).rect(left, yt, bw, yb - yt);
    });
    const ctx = v.ctx;
    ctx.fillStyle = o.wickUpColor;
    ctx.fill(wickUp);
    ctx.fillStyle = o.wickDownColor;
    ctx.fill(wickDown);
    ctx.fillStyle = o.upColor;
    ctx.fill(bodyUp);
    ctx.fillStyle = o.downColor;
    ctx.fill(bodyDown);
    if (own) for (const [color, p] of own) { ctx.fillStyle = cssColor(color); ctx.fill(p); }
  }
}

export class Bars2D extends Base<BarStyle> {
  draw(v: DrawView2D, o: BarStyle): void {
    const level = levelOf(v);
    const [bw, t] = barWidths(v.time.spacing, v.dpr, level, 0.8);
    const up = new Path2D(), down = new Path2D();
    let own: Map<number, Path2D> | undefined;
    eachUnit(v, level, (x, op, h, l, c, color) => {
      let p = c >= op ? up : down;
      if (color !== 0) {
        p = (own ??= new Map()).get(color) ?? new Path2D();
        own.set(color, p);
      }
      const left = Math.floor(x - bw / 2 + 0.5);
      const mid = left + (bw - t) / 2;
      const yh = snap(Y(v, h)), yl = Math.max(snap(Y(v, l)), yh + 1);
      p.rect(mid, yh, t, yl - yh);
      p.rect(left, Math.floor(Y(v, op) - t / 2 + 0.5), mid - left, t);
      p.rect(mid + t, Math.floor(Y(v, c) - t / 2 + 0.5), left + bw - mid - t, t);
    });
    v.ctx.fillStyle = o.upColor;
    v.ctx.fill(up);
    v.ctx.fillStyle = o.downColor;
    v.ctx.fill(down);
    if (own) for (const [color, p] of own) { v.ctx.fillStyle = cssColor(color); v.ctx.fill(p); }
  }
}

export class Histogram2D extends Base<HistogramStyle> {
  draw(v: DrawView2D, o: HistogramStyle): void {
    const level = levelOf(v);
    const [bw] = barWidths(v.time.spacing, v.dpr, level, 0.8);
    const byColor = new Map<number, Path2D>();
    // On a log scale a base at or below zero sits at the pane's lowest value.
    const yb = snap((v.price.logCoords && !(o.base > 0) ? v.price.yOfDisplay(v.price.min) : v.price.y(o.base)) * v.dpr);
    eachUnit(v, level, (x, _o, h, l, _c, color) => {
      const val = Math.abs(h - o.base) >= Math.abs(l - o.base) ? h : l;
      const yv = snap(Y(v, val));
      const y0 = Math.min(yv, yb), y1 = Math.max(Math.max(yv, yb), y0 + 1);
      let p = byColor.get(color);
      if (!p) byColor.set(color, (p = new Path2D()));
      p.rect(Math.floor(x - bw / 2 + 0.5), y0, bw, y1 - y0);
    });
    for (const [color, p] of byColor) {
      v.ctx.fillStyle = color === 0 ? o.color : cssColor(color);
      v.ctx.fill(p);
    }
  }
}

/** Path through every present unit; zoomed out, each bucket's full low..high. */
function linePath(v: DrawView2D, level: number, valueOf: "c" | "h"): { path: Path2D; first: number; last: number } {
  const path = new Path2D();
  let started = false, first = 0, last = 0;
  eachUnit(v, level, (x, o, h, l, c) => {
    if (level === 0 || valueOf === "h") {
      const y = Y(v, valueOf === "h" ? h : c);
      if (started) path.lineTo(x, y);
      else {
        path.moveTo(x, y);
        first = x;
        started = true;
      }
    } else {
      if (started) path.lineTo(x, Y(v, o));
      else {
        path.moveTo(x, Y(v, o));
        first = x;
        started = true;
      }
      path.lineTo(x, Y(v, h));
      path.lineTo(x, Y(v, l));
      path.lineTo(x, Y(v, c));
    }
    last = x;
  });
  return { path, first, last };
}

function stroke(v: DrawView2D, path: Path2D, color: string, width: number): void {
  const ctx = v.ctx;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * v.dpr);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);
}

/**
 * A line whose points carry their own colours: each segment, drawn from the previous unit to this one, takes this
 * unit's colour (0 = the series colour), one path per colour. Used only when the series may hold coloured points.
 */
function colouredLine(v: DrawView2D, level: number, color: string, width: number): void {
  const byColor = new Map<number, Path2D>();
  let px = 0, py = 0, have = false;
  eachUnit(v, level, (x, o, h, l, c, col) => {
    let p = byColor.get(col);
    if (!p) byColor.set(col, (p = new Path2D()));
    // zoomed out a unit is a bucket: its envelope, in the order the plain path walks it
    const ys = level === 0 ? [Y(v, c)] : [Y(v, o), Y(v, h), Y(v, l), Y(v, c)];
    if (have) {
      p.moveTo(px, py);
      p.lineTo(x, ys[0]!);
    }
    if (level !== 0) for (let k = 1; k < ys.length; k++) { if (k === 1) p.moveTo(x, ys[0]!); p.lineTo(x, ys[k]!); }
    px = x;
    py = ys[ys.length - 1]!;
    have = true;
  });
  for (const [col, p] of byColor) stroke(v, p, col === 0 ? color : cssColor(col), width);
}

export class Line2D extends Base<LineStyle> {
  draw(v: DrawView2D, o: LineStyle): void {
    const level = levelOf(v);
    if (v.data.pointColors) colouredLine(v, level, o.color, o.lineWidth);
    else stroke(v, linePath(v, level, "c").path, o.color, o.lineWidth);
  }
}

export class Area2D extends Base<AreaStyle> {
  draw(v: DrawView2D, o: AreaStyle): void {
    const level = levelOf(v);
    const fill = linePath(v, level, "h");
    const area = new Path2D(fill.path);
    area.lineTo(fill.last, v.height);
    area.lineTo(fill.first, v.height);
    area.closePath();
    const g = v.ctx.createLinearGradient(0, 0, 0, v.height);
    g.addColorStop(0, o.topColor);
    g.addColorStop(1, o.bottomColor);
    v.ctx.fillStyle = g;
    v.ctx.fill(area);
    if (v.data.pointColors) colouredLine(v, level, o.lineColor, o.lineWidth);
    else stroke(v, linePath(v, level, "c").path, o.lineColor, o.lineWidth);
  }
}
