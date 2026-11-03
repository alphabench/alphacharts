// Series markers: small shapes (with optional text) on bars, drawn on the
// overlay above a bar's high or below its low. Several markers on one bar
// stack outward, in the order given. Markers are positioned by time, so they
// follow the bar through prepends and live updates; a marker whose bar is gone
// after a later `setData` is skipped when drawing (not an error: the data owns
// the bars, the markers are only annotations on them).

import { parseColor } from "../render/color.js";

export type MarkerShape = "arrowUp" | "arrowDown" | "circle";
export type MarkerPosition = "aboveBar" | "belowBar";

export interface SeriesMarker {
  /** UTC ms; must be the time of a bar of the series. */
  time: number;
  position: MarkerPosition;
  shape: MarkerShape;
  /** CSS colour of the shape and its text. */
  color: string;
  /** Drawn outside the shape (above it for "aboveBar", under it for "belowBar") in the theme font. */
  text?: string;
  /** Reported as `hovered: { kind: "marker", id }` on crosshair, click and dblclick events. Unique within the series. */
  id?: string;
  /** Multiplier of the default size (which follows the bar spacing); default 1. */
  size?: number;
}

const SHAPES = ["arrowUp", "arrowDown", "circle"];
const POSITIONS = ["aboveBar", "belowBar"];

/** What a marker is called in an error message. */
const name = (m: SeriesMarker, i: number) => `marker ${m.id !== undefined ? `"${m.id}"` : `#${i}`} (time ${m.time})`;

/**
 * Check `markers` against the series' bars and return a copy sorted by time
 * (stable: the given order is the stacking order on one bar). `hasBar(time)`
 * says whether the series has a bar at that time.
 */
export function checkMarkers(markers: readonly SeriesMarker[], hasBar: (time: number) => boolean): SeriesMarker[] {
  const ids = new Set<string>();
  markers.forEach((m, i) => {
    if (!Number.isFinite(m.time)) throw new RangeError(`alphacharts: ${name(m, i)} has a non-finite time`);
    if (!POSITIONS.includes(m.position)) throw new RangeError(`alphacharts: ${name(m, i)} has unknown position "${String(m.position)}"`);
    if (!SHAPES.includes(m.shape)) throw new RangeError(`alphacharts: ${name(m, i)} has unknown shape "${String(m.shape)}"`);
    if (m.size !== undefined && !(m.size > 0 && Number.isFinite(m.size))) throw new RangeError(`alphacharts: ${name(m, i)} has size ${m.size}; it must be positive`);
    if (m.id !== undefined) {
      if (m.id === "") throw new RangeError(`alphacharts: ${name(m, i)} has an empty id`);
      if (ids.has(m.id)) throw new Error(`alphacharts: ${name(m, i)}: the id is used by another marker`);
      ids.add(m.id);
    }
    try {
      parseColor(m.color);
    } catch (e) {
      throw new Error(`alphacharts: ${name(m, i)} has a bad colour: ${(e as Error).message}`);
    }
    if (!hasBar(m.time)) throw new RangeError(`alphacharts: ${name(m, i)} is not on a bar of the series`);
  });
  return markers.map((m, i) => ({ m, i })).sort((a, b) => a.m.time - b.m.time || a.i - b.i).map((x) => ({ ...x.m }));
}

/** First index in `sorted` whose time is >= t. */
export function markerLowerBound(sorted: readonly SeriesMarker[], t: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A marker placed on the pane: `box` is the shape plus its text, for drawing bounds and hit tests. */
export interface PlacedMarker {
  marker: SeriesMarker;
  /** Pane CSS px: centre of the shape. */
  cx: number;
  cy: number;
  /** Shape edge in CSS px. */
  size: number;
  box: { x: number; y: number; w: number; h: number };
}

const GAP = 4;
const PAD = 2;

/** Shape size in CSS px for a bar spacing and a marker's multiplier. */
export function markerSize(barSpacing: number, mult = 1): number {
  return Math.round(Math.min(20, Math.max(8, barSpacing * 0.8)) * mult);
}

export interface PlaceInput {
  markers: readonly SeriesMarker[];
  /** Index range [from, to) into `markers` to place. Must cover whole bars. */
  from: number;
  to: number;
  barSpacing: number;
  fontSize: number;
  textWidth(s: string): number;
  /** For a marker: the bar's pane x, high y and low y, or undefined when the series has no bar there. */
  bar(m: SeriesMarker): { x: number; yHigh: number; yLow: number } | undefined;
}

/**
 * Place markers[from..to): above the bar's high or below its low with a small
 * gap, the next marker on the same side of the same bar further out.
 */
export function placeMarkers(inp: PlaceInput): PlacedMarker[] {
  const out: PlacedMarker[] = [];
  let curTime = Number.NaN;
  let above = 0, below = 0; // outward offset used so far on this bar
  for (let k = inp.from; k < inp.to; k++) {
    const m = inp.markers[k]!;
    if (m.time !== curTime) {
      curTime = m.time;
      above = below = 0;
    }
    const bar = inp.bar(m);
    if (!bar) continue;
    const size = markerSize(inp.barSpacing, m.size);
    const textH = m.text ? inp.fontSize + 2 : 0;
    const slot = size + textH + PAD;
    const isAbove = m.position === "aboveBar";
    const off = isAbove ? above : below;
    // Outward from the bar: the shape first, then its text further out.
    const near = isAbove ? bar.yHigh - GAP - off : bar.yLow + GAP + off;
    const cy = isAbove ? near - size / 2 : near + size / 2;
    const top = isAbove ? near - size - textH : near;
    const tw = m.text ? Math.max(size, inp.textWidth(m.text)) : size;
    out.push({ marker: m, cx: bar.x, cy, size, box: { x: bar.x - tw / 2, y: top, w: tw, h: size + textH } });
    if (isAbove) above += slot;
    else below += slot;
  }
  return out;
}

/** Draw placed markers on a pane context (CSS px). */
export function drawMarkers(ctx: CanvasRenderingContext2D, placed: readonly PlacedMarker[]): void {
  ctx.textAlign = "center";
  for (const p of placed) {
    const m = p.marker, r = p.size / 2;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    switch (m.shape) {
      case "circle":
        ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
        break;
      case "arrowUp":
        ctx.moveTo(p.cx, p.cy - r);
        ctx.lineTo(p.cx + r, p.cy + r * 0.2);
        ctx.lineTo(p.cx + r * 0.4, p.cy + r * 0.2);
        ctx.lineTo(p.cx + r * 0.4, p.cy + r);
        ctx.lineTo(p.cx - r * 0.4, p.cy + r);
        ctx.lineTo(p.cx - r * 0.4, p.cy + r * 0.2);
        ctx.lineTo(p.cx - r, p.cy + r * 0.2);
        break;
      case "arrowDown":
        ctx.moveTo(p.cx, p.cy + r);
        ctx.lineTo(p.cx + r, p.cy - r * 0.2);
        ctx.lineTo(p.cx + r * 0.4, p.cy - r * 0.2);
        ctx.lineTo(p.cx + r * 0.4, p.cy - r);
        ctx.lineTo(p.cx - r * 0.4, p.cy - r);
        ctx.lineTo(p.cx - r * 0.4, p.cy - r * 0.2);
        ctx.lineTo(p.cx - r, p.cy - r * 0.2);
        break;
    }
    ctx.closePath();
    ctx.fill();
    if (m.text) {
      const above = m.position === "aboveBar";
      ctx.textBaseline = above ? "bottom" : "top";
      ctx.fillText(m.text, p.cx, above ? p.cy - r - 1 : p.cy + r + 1);
    }
  }
}
