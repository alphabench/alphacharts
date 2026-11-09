// Helpers shared by tool modules: anchor access, shape constructors, the
// arithmetic behind every number a tool prints.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { BarSource } from "../source.js";
import type { Anchor, Drawing, DrawingStyle, Shape, Stroke, ToolCtx, ToolDef } from "../types.js";

/** Anchor i of a drawing; a missing one is a bug in the caller, not a default. */
export function A(d: Drawing, i: number): Anchor {
  const a = d.anchors[i];
  if (!a) throw new Error(`drawings: ${d.tool} "${d.id}" has no anchor ${i} (has ${d.anchors.length})`);
  return a;
}

export const px = (c: ToolCtx, a: Anchor): Pt => ({ x: c.X(a.time), y: c.Y(a.price) });
export const pxs = (c: ToolCtx, d: Drawing): Pt[] => d.anchors.map((a) => px(c, a));

export function prop<T>(d: Drawing, key: string): T {
  if (!(key in d.props)) throw new Error(`drawings: ${d.tool} "${d.id}" is missing prop "${key}"`);
  return d.props[key] as T;
}

export function numProp(d: Drawing, key: string): number {
  const v = prop<unknown>(d, key);
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`drawings: ${d.tool} "${d.id}" prop "${key}" must be a finite number, got ${String(v)}`);
  return v;
}

export function levelsProp(d: Drawing): number[] {
  const v = prop<unknown>(d, "levels");
  if (!Array.isArray(v) || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new TypeError(`drawings: ${d.tool} "${d.id}" prop "levels" must be an array of finite numbers`);
  return v as number[];
}

// ---- shapes -------------------------------------------------------------------

export function line(a: Pt, b: Pt, o: Stroke & { extA?: boolean; extB?: boolean } = {}): Shape {
  return { k: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...o };
}

export function poly(pts: readonly Pt[], o: Stroke & { close?: boolean; fill?: string | null } = {}): Shape {
  const flat: number[] = [];
  for (const p of pts) flat.push(p.x, p.y);
  return { k: "poly", pts: flat, ...o };
}

/** A filled polygon with no outline and no hit-test (bands, shading). */
export function shade(pts: readonly Pt[], fill: string): Shape {
  return poly(pts, { close: true, fill, width: 0, hit: false });
}

export function text(x: number, y: number, t: string, o: Omit<Extract<Shape, { k: "text" }>, "k" | "x" | "y" | "text"> = {}): Shape {
  return { k: "text", x, y, text: t, ...o };
}

/** Filled arrow head at b for a shaft from a (hit-test off: the shaft carries the hit). */
export function head(a: Pt, b: Pt, size: number, color: string): Shape {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 0.45;
  return poly(
    [b, { x: b.x - size * Math.cos(ang - s), y: b.y - size * Math.sin(ang - s) }, { x: b.x - size * Math.cos(ang + s), y: b.y - size * Math.sin(ang + s) }],
    { close: true, fill: color, color, width: 0, hit: false },
  );
}

/** extendLeft/extendRight are in time terms: map them to the ends of the segment a→b (a may be the later one). */
export function extension(style: DrawingStyle, a: Pt, b: Pt): { extA: boolean; extB: boolean } {
  const aIsLeft = a.x <= b.x;
  return { extA: aIsLeft ? style.extendLeft : style.extendRight, extB: aIsLeft ? style.extendRight : style.extendLeft };
}

export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Pt, b: Pt): Pt => lerp(a, b, 0.5);

export function fillOf(style: DrawingStyle, alpha = 0.15): string {
  return style.fill ?? withAlpha(style.color, alpha);
}

// ---- readouts -----------------------------------------------------------------

export function fmtTime(t: number): string {
  if (!Number.isFinite(t)) throw new RangeError(`fmtTime: ${t}`);
  return new Date(t).toISOString().slice(0, 16).replace("T", " ");
}

/** Whole days/hours/minutes (seconds under a minute) of a duration in ms. */
export function fmtDuration(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d ? `${d}d` : "", h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

export interface Measure {
  dPrice: number;
  /** Δ/|from|·100, or null when the start price is 0. */
  pct: number | null;
  /** Bars from a0 to a1 (fractional between bars), or null without a bar source. */
  bars: number | null;
  dTime: number;
}

export function measure(a0: Anchor, a1: Anchor, source: BarSource | null): Measure {
  const dPrice = a1.price - a0.price;
  return {
    dPrice,
    pct: a0.price === 0 ? null : (dPrice / Math.abs(a0.price)) * 100,
    bars: source && source.length > 0 ? source.logical(a1.time) - source.logical(a0.time) : null,
    dTime: a1.time - a0.time,
  };
}

const sign = (v: number) => (v < 0 ? "-" : v > 0 ? "+" : "");

export function barsText(bars: number): string {
  const r = Math.round(bars);
  return Math.abs(bars - r) < 1e-9 ? `${r}` : bars.toFixed(1);
}

/** "+12.50 (+0.05%)", then "34 bars, 2h 5m" when known. */
export function measureLines(m: Measure, c: ToolCtx): string[] {
  const pct = m.pct === null ? "" : ` (${sign(m.pct)}${Math.abs(m.pct).toFixed(2)}%)`;
  const out = [`${sign(m.dPrice)}${c.fmt(Math.abs(m.dPrice))}${pct}`];
  const tail = [m.bars === null ? "" : `${barsText(m.bars)} bars`, fmtDuration(m.dTime)].filter(Boolean).join(", ");
  out.push(tail);
  return out;
}

/** Ratio b/a of two price moves, or null when a is 0. */
export function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function ratioText(r: number | null): string {
  return r === null ? "n/a" : (Math.round(r * 1000) / 1000).toString();
}

/**
 * The colour of each Fibonacci level, as a colour slot of the chart's theme (see `resolveColor` in @alphacharts/core): the ends
 * (0 and 1) muted, the golden ratios the strongest palette colour, the rest spread over the palette.
 */
export const FIB_COLORS: Record<string, string> = {
  "0": "muted", "0.236": "chart-2", "0.382": "chart-3", "0.5": "chart-4", "0.618": "chart-1", "0.786": "chart-5",
  "1": "muted", "1.272": "chart-3", "1.618": "chart-1", "2": "chart-2", "2.618": "chart-4", "3.618": "chart-5", "4.236": "chart-3",
};
export const fibColor = (r: number): string => FIB_COLORS[String(r)] ?? "muted";

export const FIB_RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
export const FIB_BASIC = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Tool factory: fills the optional members so definitions stay short. */
export function tool(t: ToolDef): ToolDef {
  return t;
}

export const lineDefaults = (style: Partial<DrawingStyle> = {}, props: Record<string, unknown> = {}) => () => ({ style, props });

export function needDistinctTimes(d: Drawing, i: number, j: number): void {
  if (A(d, i).time === A(d, j).time) throw new RangeError(`drawings: ${d.tool} "${d.id}" needs anchors ${i} and ${j} at different times`);
}

/** Validate every anchor is finite. */
export function finiteAnchors(d: Drawing): void {
  d.anchors.forEach((a, i) => {
    if (!Number.isFinite(a.time) || !Number.isFinite(a.price)) throw new TypeError(`drawings: ${d.tool} "${d.id}" anchor ${i} is not finite (${a.time}, ${a.price})`);
  });
}
