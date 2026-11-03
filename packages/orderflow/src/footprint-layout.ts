// Footprint geometry, independent of the drawing backend.
//
// Per bar: `analyzeBar` turns the bar's levels into what a footprint shows
// (imbalances, stacked imbalances, POC, unfinished auctions). `buildRects`
// turns that into device-pixel rectangles for the visible bars; the WebGL
// renderer uploads them, the Canvas2D renderer fills them, and the overlay
// asks `cellTexts` for the numbers to print over the same cells.
//
// Level of detail, decided by `lodFor` from CSS px and shared by the renderers
// and the overlay so they always agree:
//   cells   bar >= minBarWidth wide and a level >= minCellHeight tall
//   shaded  bar >= SHADED_MIN_SPACING wide: a candle whose body is shaded by
//           the volume at each price (a profile-shaded candle)
//   plain   anything narrower: an ordinary candle; below COLUMN_SPACING wide,
//           one high-low line per pixel column
//
// Imbalance (diagonal, as order-flow platforms define it): a buy imbalance at
// level k when buy[k] >= ratio * sell[k-1] and buy[k] >= minVolume; a sell
// imbalance when sell[k] >= ratio * buy[k+1] and sell[k] >= minVolume. A level
// outside the bar's range has volume 0. Unknown-side volume takes no part.
// Stacked imbalances: `stacked` or more consecutive levels with the same-side
// imbalance. Unfinished auction: both buy and sell volume traded at the bar's
// high (or low) level.

import type { FlowBars } from "./bars.js";
import type { OrderFlow } from "./flow.js";

export type CellMode = "bidAsk" | "delta" | "volume";

export interface FootprintParams {
  mode: CellMode;
  imbalanceRatio: number;
  imbalanceMinVolume: number;
  stackedImbalances: number;
  showPoc: boolean;
  showUnfinished: boolean;
  minCellHeight: number;
  minBarWidth: number;
}

export interface FootprintColors {
  up: number;
  down: number;
  buy: number;
  sell: number;
  neutral: number;
  imbalanceBuy: number;
  imbalanceSell: number;
  poc: number;
  unfinished: number;
}

export const SHADED_MIN_SPACING = 6;
export const COLUMN_SPACING = 1.5;

export function validateParams(p: FootprintParams): void {
  if (!(p.imbalanceRatio > 0)) throw new RangeError(`orderflow: imbalanceRatio ${p.imbalanceRatio} must be positive`);
  if (!(p.imbalanceMinVolume >= 0)) throw new RangeError(`orderflow: imbalanceMinVolume ${p.imbalanceMinVolume} must be >= 0`);
  if (!Number.isInteger(p.stackedImbalances) || p.stackedImbalances < 2) throw new RangeError(`orderflow: stackedImbalances ${p.stackedImbalances} must be an integer >= 2`);
  if (!(p.minCellHeight > 0) || !(p.minBarWidth > 0)) throw new RangeError("orderflow: minCellHeight and minBarWidth must be positive");
  if (p.mode !== "bidAsk" && p.mode !== "delta" && p.mode !== "volume") throw new RangeError(`orderflow: mode must be bidAsk, delta or volume, got ${String(p.mode)}`);
}

export type Lod = "cells" | "shaded" | "plain";

export function lodFor(spacingCss: number, rowCss: number, p: FootprintParams): Lod {
  if (spacingCss >= p.minBarWidth && rowCss >= p.minCellHeight) return "cells";
  return spacingCss >= SHADED_MIN_SPACING ? "shaded" : "plain";
}

/** What the cells show. An approximate flow has no sides, so only volume. */
export function effectiveMode(mode: CellMode, flow: OrderFlow): CellMode {
  return flow.approximate ? "volume" : mode;
}

export interface BarAnalysis {
  readonly bar: number;
  readonly kLo: number;
  readonly kHi: number;
  readonly buy: Float64Array;
  readonly sell: Float64Array;
  readonly unknown: Float64Array;
  readonly imbBuy: Uint8Array;
  readonly imbSell: Uint8Array;
  /** 1 where the level is part of a stacked run. */
  readonly stackBuy: Uint8Array;
  readonly stackSell: Uint8Array;
  /** Tick of the level with the most volume (ties: the one nearest the bar's middle, then lower). */
  readonly pocK: number;
  readonly maxSide: number;
  readonly maxTotal: number;
  readonly maxAbsDelta: number;
  readonly unfinishedHigh: boolean;
  readonly unfinishedLow: boolean;
}

export function analyzeBar(bars: FlowBars, bar: number, p: FootprintParams): BarAnalysis {
  const g = bars.grids[bar]!;
  const kLo = g.lo, kHi = g.hi, n = g.span;
  const buy = new Float64Array(n), sell = new Float64Array(n), unknown = new Float64Array(n);
  let maxSide = 0, maxTotal = 0, maxAbsDelta = 0, poc = 0;
  const mid = (n - 1) / 2;
  for (let r = 0; r < n; r++) {
    const k = kLo + r;
    buy[r] = g.get(k, 0);
    sell[r] = g.get(k, 1);
    unknown[r] = g.get(k, 2);
    const t = buy[r]! + sell[r]! + unknown[r]!;
    maxSide = Math.max(maxSide, buy[r]!, sell[r]!);
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(buy[r]! - sell[r]!));
    if (t > maxTotal || (t === maxTotal && t > 0 && Math.abs(r - mid) < Math.abs(poc - mid))) {
      maxTotal = t;
      poc = r;
    }
  }
  const imbBuy = new Uint8Array(n), imbSell = new Uint8Array(n);
  for (let r = 0; r < n; r++) {
    const below = r > 0 ? sell[r - 1]! : 0, above = r < n - 1 ? buy[r + 1]! : 0;
    if (buy[r]! > 0 && buy[r]! >= p.imbalanceMinVolume && buy[r]! >= p.imbalanceRatio * below) imbBuy[r] = 1;
    if (sell[r]! > 0 && sell[r]! >= p.imbalanceMinVolume && sell[r]! >= p.imbalanceRatio * above) imbSell[r] = 1;
  }
  const stackBuy = stack(imbBuy, p.stackedImbalances), stackSell = stack(imbSell, p.stackedImbalances);
  return {
    bar, kLo, kHi, buy, sell, unknown, imbBuy, imbSell, stackBuy, stackSell,
    pocK: kLo + poc, maxSide, maxTotal, maxAbsDelta,
    unfinishedHigh: n > 0 && buy[n - 1]! > 0 && sell[n - 1]! > 0,
    unfinishedLow: n > 0 && buy[0]! > 0 && sell[0]! > 0,
  };
}

function stack(flags: Uint8Array, min: number): Uint8Array {
  const out = new Uint8Array(flags.length);
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i] === 1;
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      if (i - s >= min) out.fill(1, s, i);
      s = -1;
    }
  }
  return out;
}

// ---- rectangles ---------------------------------------------------------------------

/** Growable list of device-px rectangles with packed 0xRRGGBBAA colours. */
export class RectBatch {
  /** x0, y0, x1, y1 per rect. */
  xy = new Float32Array(4 * 1024);
  rgba = new Uint32Array(1024);
  n = 0;

  clear(): void {
    this.n = 0;
  }

  push(x0: number, y0: number, x1: number, y1: number, color: number): void {
    if (!(x1 > x0) || !(y1 > y0) || (color & 255) === 0) return;
    if (this.n === this.rgba.length) {
      const xy = new Float32Array(this.xy.length * 2);
      xy.set(this.xy);
      const c = new Uint32Array(this.rgba.length * 2);
      c.set(this.rgba);
      this.xy = xy;
      this.rgba = c;
    }
    const o = this.n * 4;
    this.xy[o] = x0;
    this.xy[o + 1] = y0;
    this.xy[o + 2] = x1;
    this.xy[o + 3] = y1;
    this.rgba[this.n++] = color >>> 0;
  }
}

export const withAlpha = (c: number, a: number): number => ((c & 0xffffff00) | Math.max(0, Math.min(255, Math.round(((c & 255) / 255) * a * 255)))) >>> 0;

/** Everything buildRects needs about the view, in device px unless noted. */
export interface RectView {
  dpr: number;
  /** Pane size in device px. */
  width: number;
  height: number;
  /** CSS px per bar. */
  spacing: number;
  /** Visible timeline indices. */
  lo: number;
  hi: number;
  /** Device x of a timeline index's centre. */
  xOf(index: number): number;
  /** Device y of a price. */
  yOf(price: number): number;
  /** Price at a device y. */
  priceAt(y: number): number;
  /** Flow bar row at a timeline index, or -1. */
  barAt(index: number): number;
  open(index: number): number;
  high(index: number): number;
  low(index: number): number;
  close(index: number): number;
  /** high/low over timeline indices [a, b] (NaN when empty). */
  range(a: number, b: number, out: Float64Array): void;
}

export interface BarColumns {
  left: number;
  right: number;
  /** Open-to-close strip. */
  stripX0: number;
  stripX1: number;
  /** One cell, or the bid then ask halves. */
  x0: number;
  mid: number;
  x1: number;
}

export function barColumns(xc: number, spacingDev: number, dpr: number, mode: CellMode): BarColumns {
  const w = Math.max(8, Math.floor(spacingDev * 0.94));
  const left = Math.round(xc - w / 2);
  const strip = Math.max(2, Math.round(2 * dpr));
  const gap = Math.max(1, Math.round(dpr));
  const x0 = left + strip + gap, x1 = left + w;
  const half = Math.floor((x1 - x0 - gap) / 2);
  return { left, right: left + w, stripX0: left, stripX1: left + strip, x0, mid: mode === "bidAsk" ? x0 + half : x1, x1: mode === "bidAsk" ? x0 + half * 2 + gap : x1 };
}

/** Ticks of a bar that fall in the pane (one tick of slack each side). */
function visibleTicks(view: RectView, bars: FlowBars, a: BarAnalysis): [number, number] {
  const p0 = view.priceAt(0) / bars.tickSize, p1 = view.priceAt(view.height) / bars.tickSize;
  return [Math.max(a.kLo, Math.floor(Math.min(p0, p1)) - 1), Math.min(a.kHi, Math.ceil(Math.max(p0, p1)) + 1)];
}

/** Cell edges between rows k and k+1 are shared, so rows never gap or overlap. */
export function rowEdge(view: Pick<RectView, "yOf">, bars: FlowBars, k: number): number {
  return Math.round(view.yOf(bars.priceOf(k) - bars.tickSize / 2));
}

/**
 * Device y of row k as [top, bottom], top < bottom on every price scale: an
 * inverted scale draws higher prices lower, and a log, percent or indexed one
 * spaces rows unevenly, so a row's edges always come from the scale's y().
 */
export function rowSpan(view: Pick<RectView, "yOf">, bars: FlowBars, k: number): [number, number] {
  const a = rowEdge(view, bars, k), b = rowEdge(view, bars, k + 1);
  return a < b ? [a, b] : [b, a];
}

/** [top, bottom] of the device-y interval between two prices, rounded, at least 1 px tall. */
function ySpan(view: Pick<RectView, "yOf">, p0: number, p1: number): [number, number] {
  const a = Math.round(view.yOf(p0)), b = Math.round(view.yOf(p1));
  const top = Math.min(a, b);
  return [top, Math.max(Math.max(a, b), top + 1)];
}

/**
 * Smallest height in CSS px of a one-tick row at the top, middle and bottom of
 * the pane. Equal everywhere on a linear scale; on a log scale the rows at the
 * high-price end are the smallest, and cells are only readable when those are.
 */
export function minRowCss(view: Pick<RectView, "yOf" | "priceAt" | "height" | "dpr">, tickSize: number): number {
  let min = Infinity;
  for (const y of [0, view.height / 2, view.height]) {
    const ref = view.priceAt(y);
    min = Math.min(min, Math.abs(view.yOf(ref + tickSize) - view.yOf(ref)) / view.dpr);
  }
  return min;
}

/** +1 when higher prices are drawn lower on screen (an inverted scale), else -1. */
function upSign(view: Pick<RectView, "yOf" | "priceAt" | "height">, tickSize: number): number {
  const ref = view.priceAt(view.height / 2);
  return view.yOf(ref + tickSize) > view.yOf(ref) ? 1 : -1;
}

export function buildRects(out: RectBatch, view: RectView, flow: OrderFlow, p: FootprintParams, c: FootprintColors, analyze: (bar: number) => BarAnalysis): Lod {
  const bars = flow.bars;
  const dpr = view.dpr;
  const spacingDev = view.spacing * dpr;
  const rowCss = minRowCss(view, bars.tickSize);
  const lod = lodFor(view.spacing, rowCss, p);
  const upDir = upSign(view, bars.tickSize);
  const mode = effectiveMode(p.mode, flow);
  if (lod === "plain" && view.spacing < COLUMN_SPACING) {
    columns(out, view, c);
    return lod;
  }
  const line = Math.max(1, Math.round(dpr));
  for (let i = view.lo; i <= view.hi; i++) {
    const xc = view.xOf(i);
    const o = view.open(i), h = view.high(i), l = view.low(i), cl = view.close(i);
    if (o !== o) continue;
    const up = cl >= o;
    const col = up ? c.up : c.down;
    const cols = barColumns(xc, spacingDev, dpr, mode);
    if (lod === "plain") {
      const bw = Math.max(1, Math.floor(spacingDev * 0.7));
      const wick = Math.max(1, Math.floor(dpr));
      const left = Math.round(xc - bw / 2);
      const [yh, yl] = ySpan(view, h, l);
      const [yt, yb] = ySpan(view, Math.max(o, cl), Math.min(o, cl));
      const wl = Math.round(xc - wick / 2);
      out.push(wl, yh, wl + wick, yl, col);
      out.push(left, yt, left + bw, yb, col);
      continue;
    }
    const bar = view.barAt(i);
    if (bar < 0) continue;
    if (lod === "shaded") {
      shadedCandle(out, view, bars, bar, xc, spacingDev, o, h, l, cl, col);
      continue;
    }
    const a = analyze(bar);
    // Open-to-close strip.
    const [yt, yb] = ySpan(view, Math.max(o, cl), Math.min(o, cl));
    out.push(cols.stripX0, yt, cols.stripX1, yb, col);
    const [kBot, kTop] = visibleTicks(view, bars, a);
    for (let k = kBot; k <= kTop; k++) {
      const r = k - a.kLo;
      const bu = a.buy[r]!, se = a.sell[r]!, un = a.unknown[r]!;
      if (bu + se + un === 0) continue;
      const [y0, y1] = rowSpan(view, bars, k);
      const yy1 = y1 - (y1 - y0 > 3 * line ? line : 0);
      if (mode === "bidAsk") {
        const sellC = a.imbSell[r] ? withAlpha(c.imbalanceSell, 0.95) : withAlpha(c.sell, 0.12 + 0.55 * (se / a.maxSide));
        const buyC = a.imbBuy[r] ? withAlpha(c.imbalanceBuy, 0.95) : withAlpha(c.buy, 0.12 + 0.55 * (bu / a.maxSide));
        out.push(cols.x0, y0, cols.mid, yy1, sellC);
        out.push(cols.mid + Math.max(1, Math.round(dpr)), y0, cols.x1, yy1, buyC);
        if (a.stackSell[r]) out.push(cols.x0, y0, cols.x0 + Math.max(2, Math.round(2 * dpr)), yy1, c.imbalanceSell);
        if (a.stackBuy[r]) out.push(cols.x1 - Math.max(2, Math.round(2 * dpr)), y0, cols.x1, yy1, c.imbalanceBuy);
      } else if (mode === "delta") {
        const d = bu - se;
        const f = a.maxAbsDelta > 0 ? Math.abs(d) / a.maxAbsDelta : 0;
        out.push(cols.x0, y0, cols.x1, yy1, d === 0 ? withAlpha(c.neutral, 0.1) : withAlpha(d > 0 ? c.buy : c.sell, 0.12 + 0.7 * f));
      } else {
        out.push(cols.x0, y0, cols.x1, yy1, withAlpha(c.neutral, 0.1 + 0.7 * ((bu + se + un) / a.maxTotal)));
      }
      if (p.showPoc && k === a.pocK) outline(out, cols.x0, y0, cols.x1, yy1, line, c.poc);
    }
    if (p.showUnfinished && !flow.approximate) {
      const t = Math.max(2, Math.round(2 * dpr));
      // A marker just outside the bar's high (or low) edge, on whichever side of it prices rise to.
      const cap = (y: number, dir: number) => {
        const a0 = y + dir * line, a1 = y + dir * (t + line);
        out.push(cols.x0, Math.min(a0, a1), cols.x1, Math.max(a0, a1), c.unfinished);
      };
      if (a.unfinishedHigh) cap(rowEdge(view, bars, a.kHi + 1), upDir);
      if (a.unfinishedLow) cap(rowEdge(view, bars, a.kLo), -upDir);
    }
  }
  return lod;
}

function outline(out: RectBatch, x0: number, y0: number, x1: number, y1: number, t: number, color: number): void {
  out.push(x0, y0, x1, y0 + t, color);
  out.push(x0, y1 - t, x1, y1, color);
  out.push(x0, y0 + t, x0 + t, y1 - t, color);
  out.push(x1 - t, y0 + t, x1, y1 - t, color);
}

/** A candle whose body is shaded by the volume at each price. */
function shadedCandle(out: RectBatch, view: RectView, bars: FlowBars, bar: number, xc: number, spacingDev: number, o: number, h: number, l: number, cl: number, col: number): void {
  const dpr = view.dpr;
  const bw = Math.max(3, Math.floor(spacingDev * 0.8));
  const left = Math.round(xc - bw / 2);
  const wick = Math.max(1, Math.floor(dpr));
  const wl = Math.round(xc - wick / 2);
  const [yh, yl] = ySpan(view, h, l);
  out.push(wl, yh, wl + wick, yl, col);
  const g = bars.grids[bar]!;
  const kHi = Math.round(Math.max(o, cl) / bars.tickSize), kLo = Math.round(Math.min(o, cl) / bars.tickSize);
  const rowDev = Math.abs(view.yOf(h) - view.yOf(h - bars.tickSize));
  const group = Math.max(1, Math.ceil((3 * dpr) / Math.max(rowDev, 1e-6)));
  let max = 0;
  const sums: number[] = [];
  for (let k = kLo; k <= kHi; k += group) {
    let s = 0;
    for (let j = k; j < Math.min(k + group, kHi + 1); j++) s += g.total(j);
    sums.push(s);
    if (s > max) max = s;
  }
  let gi = 0;
  for (let k = kLo; k <= kHi; k += group, gi++) {
    const top = Math.min(k + group, kHi + 1);
    const ea = rowEdge(view, bars, top), eb = rowEdge(view, bars, k);
    const y0 = Math.min(ea, eb), y1 = Math.max(ea, eb);
    out.push(left, y0, left + bw, Math.max(y1, y0 + 1), withAlpha(col, max > 0 ? 0.2 + 0.8 * (sums[gi]! / max) : 0.2));
  }
}

/** Zoomed far out: one high-low line per pixel column, from exact range queries. */
function columns(out: RectBatch, view: RectView, c: FootprintColors): void {
  const mm = new Float64Array(2);
  const w = Math.ceil(view.width);
  const spacingDev = view.spacing * view.dpr;
  const x0 = view.xOf(view.lo);
  // Fractional index at device x; column x holds the bars whose centres lie in [at(x), at(x+1)).
  const at = (x: number) => view.lo + (x - x0) / spacingDev;
  for (let x = 0; x < w; x++) {
    const a = Math.max(view.lo, Math.ceil(at(x))), b = Math.min(view.hi, Math.ceil(at(x + 1)) - 1);
    if (b < a) continue;
    view.range(a, b, mm);
    if (mm[0]! !== mm[0]!) continue;
    const [yh, yl] = ySpan(view, mm[1]!, mm[0]!);
    out.push(x, yh, x + 1, yl, view.close(b) >= view.open(a) ? c.up : c.down);
  }
}

// ---- text ---------------------------------------------------------------------------

export interface CellText {
  /** Device px of the cell's left/right edges and vertical middle. */
  x0: number;
  x1: number;
  yMid: number;
  /** Cell height in device px. */
  h: number;
  value: number;
  bold: boolean;
  side: "bid" | "ask" | "cell";
}

/** Compact volume: 1,234 → "1.2k" only when the full number would not fit. */
export function volumeText(v: number, full: boolean): string {
  if (full || v < 1000) return Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 2 : 1);
  if (v < 1e6) return `${(v / 1000).toFixed(v < 1e4 ? 1 : 0)}k`;
  return `${(v / 1e6).toFixed(1)}m`;
}

/** Numbers to print on the visible cells (the overlay decides which are readable). */
export function cellTexts(view: RectView, flow: OrderFlow, p: FootprintParams, analyze: (bar: number) => BarAnalysis, emit: (t: CellText, bar: number, level: number) => void): void {
  const bars = flow.bars;
  const dpr = view.dpr;
  const mode = effectiveMode(p.mode, flow);
  for (let i = view.lo; i <= view.hi; i++) {
    const bar = view.barAt(i);
    if (bar < 0) continue;
    const a = analyze(bar);
    const cols = barColumns(view.xOf(i), view.spacing * dpr, dpr, mode);
    const [kBot, kTop] = visibleTicks(view, bars, a);
    for (let k = kBot; k <= kTop; k++) {
      const r = k - a.kLo;
      const bu = a.buy[r]!, se = a.sell[r]!, un = a.unknown[r]!;
      if (bu + se + un === 0) continue;
      const [y0, y1] = rowSpan(view, bars, k);
      const base = { yMid: (y0 + y1) / 2, h: y1 - y0 };
      if (mode === "bidAsk") {
        emit({ ...base, x0: cols.x0, x1: cols.mid, value: se, bold: a.imbSell[r] === 1, side: "bid" }, bar, k);
        emit({ ...base, x0: cols.mid, x1: cols.x1, value: bu, bold: a.imbBuy[r] === 1, side: "ask" }, bar, k);
      } else if (mode === "delta") {
        emit({ ...base, x0: cols.x0, x1: cols.x1, value: bu - se, bold: false, side: "cell" }, bar, k);
      } else {
        emit({ ...base, x0: cols.x0, x1: cols.x1, value: bu + se + un, bold: false, side: "cell" }, bar, k);
      }
    }
  }
}
