// What is under the pointer (or at a keyboard stop): tooltip content, the
// snapped crosshair position and the marks to highlight.

import { barRect, candleSpan, heatCell, pointStyle, scatterRadii, tileColor, treeTiles, type BarRect } from "./draw.js";
import { visible, type PArea, type PBar, type PCandle, type PHeat, type PHist, type PLine, type PMark, type PScatter, type PTree } from "./model.js";
import { isBand, type Panel } from "./panel.js";
import type { TooltipRow } from "./spec.js";
import { leaves, type Tile } from "./treemap.js";

export interface Dot {
  x: number;
  y: number;
  color: string;
  r: number;
}

export interface Hit {
  title: string;
  rows: TooltipRow[];
  /** Where the tooltip points (panel px). */
  x: number;
  y: number;
  /** Crosshair positions; undefined draws no line on that axis. */
  snapX?: number;
  snapY?: number;
  dots: Dot[];
  /** A cell, tile or band to outline. */
  rect?: BarRect;
  /** The x of the hit as a number (continuous axes) or category, for syncing plots. */
  key?: { num?: number; cat?: string };
}

export type HitMode = "shared" | "nearest" | "none";

/** The visible marks that take part in the tooltip: `tooltip: false` leaves one out. */
const tipped = (p: Panel): PMark[] => visible(p.prepared).filter((m) => m.mark.tooltip !== false);

/** shared: every series at one x; nearest: the one point nearest the pointer. */
export function defaultMode(p: Panel): HitMode {
  const ms = tipped(p);
  if (ms.some((m) => m.type === "heatmap" || m.type === "treemap")) return "nearest";
  if (ms.some((m) => m.type === "bar" || m.type === "candle" || m.type === "line" || m.type === "area" || m.type === "errorBand" || m.type === "histogram")) return "shared";
  return "nearest";
}

const name = (m: PMark, fallback: string) => m.name ?? fallback;

/** The axis along which series are compared: y for horizontal bars. */
function sharedAxis(p: Panel): "x" | "y" {
  const ms = visible(p.prepared);
  return ms.some((m) => m.type === "bar" && m.orient === "h") && !ms.some((m) => m.type === "line" || m.type === "area") ? "y" : "x";
}

/** The tooltip title of one datum: the host's `tooltip.title` (told the title it replaces), else `fallback`. */
function titled(p: Panel, fallback: string, x: unknown, index: number): string {
  const fn = p.o.tooltipTitle;
  return typeof fn === "function" ? fn({ index, x, ...(fallback ? { label: fallback } : {}) }) : fallback;
}

/** `xv`: the x of the datum under the pointer, when there is one (the pixel's inverse is only close to it). */
function titleOf(p: Panel, axis: "x" | "y", px: number, cat: string | undefined, xv?: number): string {
  if (cat !== undefined) return cat;
  const s = axis === "x" ? p.sx : p.sy;
  if (isBand(s)) return "";
  const v = xv ?? s.invert(px);
  // Only on request (`tooltip.title: "axis"`): a formatter written for ticks ("10:00") would otherwise replace the fuller title.
  const spec = p.o.axes?.[axis];
  const tf = spec && p.o.tooltipTitle === "axis" ? spec.tickFormat : undefined;
  if (tf) return tf(v, { step: p.axes.find((a) => a.id === axis)?.step ?? 1, values: [v], index: 0 });
  return s.kind === "time" ? p.o.fmt.instant(v) : p.o.fmt.value(v);
}

/** Tooltip at a pointer position; null outside the plot area. */
export function hitAt(p: Panel, px: number, py: number, mode: HitMode, snap: boolean): Hit | null {
  if (mode === "none" || !p.contains(px, py)) return null;
  const ms = tipped(p);
  const cell = ms.find((m) => m.type === "heatmap" || m.type === "treemap");
  if (cell) return cell.type === "heatmap" ? heatHit(p, cell, px, py) : treeHit(p, cell, px, py);
  return mode === "shared" ? sharedHit(p, px, py, snap) : nearestHit(p, px, py);
}

// ---- shared -------------------------------------------------------------------

function sharedHit(p: Panel, px: number, py: number, snap: boolean): Hit | null {
  const axis = sharedAxis(p);
  const scale = axis === "x" ? p.sx : p.sy;
  const pos = axis === "x" ? px : py;
  const series = tipped(p).filter((m) => (axis === "x" ? m.type !== "bar" || m.orient === "v" : m.type === "bar" && m.orient === "h") && (m.type === "bar" || m.type === "candle" || m.type === "line" || m.type === "area" || m.type === "errorBand" || m.type === "scatter" || m.type === "histogram"));
  if (series.length === 0) return null;

  let key: string | undefined;
  let keyPx: number;
  if (isBand(scale)) {
    key = scale.invert(pos);
    if (key === undefined) return null;
    keyPx = scale.center(key);
  } else {
    let best = Infinity;
    keyPx = NaN;
    for (const m of series) {
      if (m.type === "histogram") {
        for (const b of m.bins) {
          const c = scale.map((b.x0 + b.x1) / 2);
          const d = Math.abs(c - pos);
          if (d < best) [best, keyPx] = [d, c];
        }
        continue;
      }
      if (!hasPos(m)) continue;
      const n = m.pos.length;
      for (let i = 0; i < n; i++) {
        const c = axis === "x" ? p.xPx(m.pos, i) : (m.type === "bar" ? scale.map(m.pos.num![i]!) : NaN);
        const d = Math.abs(c - pos);
        if (d < best) [best, keyPx] = [d, c];
      }
    }
    if (!(keyPx === keyPx)) return null;
  }

  const rows: TooltipRow[] = [];
  const dots: Dot[] = [];
  let rangeTitle: string | undefined;
  let datum: { m: Positioned; i: number } | undefined;
  for (const m of series) {
    if (m.type === "histogram") {
      if (isBand(scale)) continue;
      const v = scale.invert(keyPx);
      const b = m.bins.find((q, i) => v >= q.x0 && (v < q.x1 || (i === m.bins.length - 1 && v <= q.x1)));
      if (!b) continue;
      rows.push({ name: name(m, p.o.msg("plot.tooltip.count")), value: p.o.fmt.value(m.mark.density ? b.density : b.count), color: m.color, raw: m.mark.density ? b.density : b.count, mark: m.id });
      rangeTitle = `${p.o.fmt.value(b.x0)} – ${p.o.fmt.value(b.x1)}`;
      continue;
    }
    const i = indexAt(p, m, axis, key, keyPx, scale);
    if (i < 0) continue;
    rows.push(...rowsOf(p, m, i));
    if (!datum && hasPos(m)) datum = { m, i };
    const dot = dotOf(p, m, i);
    if (dot) dots.push(dot);
  }
  if (rows.length === 0) return null;
  const xv = datum ? datum.m.pos.num?.[datum.i] : undefined;
  const base = rangeTitle ?? titleOf(p, axis, keyPx, key, xv);
  const title = rangeTitle === undefined && datum ? titled(p, base, key ?? xv ?? NaN, datum.i) : base;
  const hit: Hit = { title, rows, x: axis === "x" ? keyPx : px, y: axis === "x" ? py : keyPx, dots };
  if (axis === "x") {
    hit.snapX = snap ? keyPx : px;
    hit.key = key !== undefined ? { cat: key } : { num: (scale as { invert(v: number): number }).invert(keyPx) };
    if (isBand(scale) && key !== undefined) hit.rect = { x: scale.map(key), y: p.area.y, w: scale.bandwidth, h: p.area.h };
  } else {
    hit.snapY = snap ? keyPx : py;
    if (isBand(scale) && key !== undefined) hit.rect = { x: p.area.x, y: scale.map(key), w: p.area.w, h: scale.bandwidth };
  }
  return hit;
}

type Positioned = PBar | PLine | PArea | PCandle | PScatter;
const hasPos = (m: PMark): m is Positioned => m.type === "bar" || m.type === "candle" || m.type === "line" || m.type === "area" || m.type === "errorBand" || m.type === "scatter";

/** Index of the datum of `m` at the shared key, or -1. */
function indexAt(p: Panel, m: PMark, axis: "x" | "y", key: string | undefined, keyPx: number, scale: unknown): number {
  if (!hasPos(m)) return -1;
  const mm = m;
  const n = mm.pos.length;
  if (key !== undefined) {
    if (!mm.pos.cat) return -1;
    return mm.pos.cat.indexOf(key);
  }
  // Same x only (to the pixel): a series with no datum here shows no row rather than its neighbour's value under this title.
  let best = -1, bestD = 0.51;
  for (let i = 0; i < n; i++) {
    const c = axis === "x" ? p.xPx(mm.pos, i) : (scale as { map(v: number): number }).map(mm.pos.num![i]!);
    const d = Math.abs(c - keyPx);
    if (d < bestD) [best, bestD] = [i, d];
  }
  // Candles likewise: a key over a body hits it even when the shared key snapped to another series' x.
  if (best < 0 && m.type === "candle") {
    for (let i = 0; i < n; i++) {
      const c = candleSpan(p, m as PCandle, i);
      if (axis === "x" && Math.abs(keyPx - c.cx) <= c.w / 2) return i;
    }
  }
  // Bars take the datum whose bar contains the key even when wider than 8 px.
  if (best < 0 && m.type === "bar") {
    for (let i = 0; i < n; i++) {
      const r = barRect(p, m as PBar, i);
      const lo = axis === "x" ? r.x : r.y, len = axis === "x" ? r.w : r.h;
      if (keyPx >= lo && keyPx <= lo + len) return i;
    }
  }
  return best;
}

const finite = (v: number): number | undefined => (v === v ? v : undefined);

/** One row for datum i of `m`, with the datum's index, raw number and mark. */
function row(m: PMark, i: number, name: string, value: string, color: string, raw: number): TooltipRow {
  const r: TooltipRow = { name, value, color, index: i, mark: m.id };
  const v = finite(raw);
  if (v !== undefined) r.raw = v;
  return r;
}

/** The tooltip rows of datum i of `m`: one, or four (O, H, L, C) for a candle. */
function rowsOf(p: Panel, m: PMark, i: number): TooltipRow[] {
  const f = p.o.fmt;
  switch (m.type) {
    case "bar": return [row(m, i, name(m, "Bar"), f.value(m.value[i]!), m.sign ? (m.value[i]! >= 0 ? m.sign.positive : m.sign.negative) : m.colors ? m.colors[i]! : m.color, m.value[i]!)];
    case "line": return [row(m, i, name(m, "Line"), f.value(m.y[i]!), m.color, m.y[i]!)];
    case "area": return [row(m, i, name(m, "Area"), f.value(m.y[i]!), m.color, m.y[i]!)];
    case "errorBand": return [row(m, i, name(m, "Range"), `${f.value(m.lo[i]!)} – ${f.value(m.hi[i]!)}`, m.color, m.hi[i]!)];
    case "scatter": return [row(m, i, name(m, "Point"), m.mark.states ? `${f.value(m.y[i]!)} · ${m.mark.states[i]!}` : f.value(m.y[i]!), pointStyle(p, m, i).color, m.y[i]!)];
    case "candle": {
      const color = m.close[i]! >= m.open[i]! ? m.up : m.down;
      return ([["open", m.open], ["high", m.high], ["low", m.low], ["close", m.close]] as const).map(([k, col]) => row(m, i, p.o.msg(`plot.tooltip.${k}`), col[i]! === col[i]! ? f.value(col[i]!) : "", color, col[i]!));
    }
    default: return [{ name: name(m, m.type), value: "", color: m.color, mark: m.id }];
  }
}

function dotOf(p: Panel, m: PMark, i: number): Dot | undefined {
  if (m.type === "line" || m.type === "area" || m.type === "errorBand" || m.type === "scatter") {
    const sy = p.yScaleOf(m.yAxis);
    if (isBand(sy)) return undefined;
    const v = m.type === "line" || m.type === "scatter" ? m.y[i]! : m.hi[i]!;
    const x = p.xPx(m.pos, i), y = sy.map(v);
    if (x !== x || y !== y) return undefined;
    return { x, y, color: m.type === "scatter" ? pointStyle(p, m, i).color : m.color, r: m.type === "scatter" ? Math.max(4, scatterRadii(m)[i]! + 2) : 4 };
  }
  return undefined;
}

// ---- nearest ------------------------------------------------------------------

function pointRows(p: Panel, m: PScatter | Extract<PMark, { type: "line" }>, i: number): { title: string; rows: TooltipRow[] } {
  const f = p.o.fmt;
  const xa = p.axes.find((a) => a.id === "x")?.title ?? "x";
  const ya = p.axes.find((a) => a.id === m.yAxis)?.title ?? "y";
  const xv = m.pos.cat ? m.pos.cat[i]! : p.sx.kind === "time" ? f.instant(m.pos.num![i]!) : f.value(m.pos.num![i]!);
  const color = m.type === "scatter" ? pointStyle(p, m, i).color : m.color;
  const rows: TooltipRow[] = [row(m, i, xa, xv, color, m.pos.num ? m.pos.num[i]! : NaN), row(m, i, ya, f.value(m.y[i]!), color, m.y[i]!)];
  let title = m.name ?? "";
  if (m.type === "scatter") {
    if (m.mark.labels) title = m.mark.labels[i]!;
    if (m.size) rows.push(row(m, i, p.o.msg("plot.tooltip.size"), f.value(m.size[i]!), color, m.size[i]!));
    if (m.mark.colorValue) rows.push(row(m, i, p.o.msg("plot.tooltip.value"), f.value(m.mark.colorValue[i]!), color, m.mark.colorValue[i]!));
    if (m.mark.shapes || m.mark.hollow || m.mark.opacities || m.mark.colors) {
      // The per-point state the marker encodes, spelled out for the tooltip.
      const st = pointStyle(p, m, i);
      const bits: string[] = [];
      if (m.mark.states) bits.push(m.mark.states[i]!);
      else {
        if (st.hollow) bits.push("hollow");
        if (m.mark.shapes) bits.push(st.shape);
      }
      if (bits.length) rows.push(row(m, i, "State", bits.join(", "), color, NaN));
    }
    if (m.mark.states && !(m.mark.shapes || m.mark.hollow || m.mark.opacities || m.mark.colors)) rows.push(row(m, i, "State", m.mark.states[i]!, color, NaN));
  }
  return { title: titled(p, title, m.pos.cat ? m.pos.cat[i]! : m.pos.num![i]!, i), rows };
}

function nearestHit(p: Panel, px: number, py: number): Hit | null {
  let best: { m: PScatter | Extract<PMark, { type: "line" }>; i: number; d: number; x: number; y: number } | undefined;
  const ms = tipped(p);
  // Dots win over the line through them; a line's own points are only candidates when there are no dots.
  const hasDots = ms.some((m) => m.type === "scatter");
  for (const m of ms) {
    if (m.type !== "scatter" && !(m.type === "line" && !hasDots)) continue;
    const sy = p.yScaleOf(m.yAxis);
    if (isBand(sy)) continue;
    const r = m.type === "scatter" ? scatterRadii(m) : undefined;
    const n = m.y.length;
    for (let i = 0; i < n; i++) {
      const x = p.xPx(m.pos, i), y = sy.map(m.y[i]!);
      const d = Math.hypot(x - px, y - py) - (r ? r[i]! : 0);
      if (d < (best?.d ?? 36)) best = { m, i, d, x, y };
    }
  }
  if (!best) return null;
  const { title, rows } = pointRows(p, best.m, best.i);
  const color = best.m.type === "scatter" ? pointStyle(p, best.m, best.i).color : best.m.color;
  const r = best.m.type === "scatter" ? scatterRadii(best.m)[best.i]! + 2 : 4;
  return { title, rows, x: best.x, y: best.y, snapX: best.x, snapY: best.y, dots: [{ x: best.x, y: best.y, color, r }] };
}

// ---- cells ----------------------------------------------------------------------

const heatIndex = new WeakMap<PHeat, Map<string, number>>();

function heatHit(p: Panel, m: PHeat, px: number, py: number): Hit | null {
  if (!isBand(p.sx) || !isBand(p.sy)) return null;
  const cx = p.sx.invert(px), cy = p.sy.invert(py);
  if (cx === undefined || cy === undefined) return null;
  let idx = heatIndex.get(m);
  if (!idx) {
    idx = new Map();
    m.xc.forEach((x, i) => idx!.set(`${x}\u0000${m.yc[i]!}`, i));
    heatIndex.set(m, idx);
  }
  const i = idx.get(`${cx}\u0000${cy}`);
  if (i === undefined) return null;
  return heatHitAt(p, m, i);
}

function heatHitAt(p: Panel, m: PHeat, i: number): Hit {
  const cs = p.colors.get(m);
  const c = heatCell(p, m, i);
  const v = m.value[i]!;
  return {
    title: titled(p, `${m.xc[i]!} · ${m.yc[i]!}`, m.xc[i]!, i),
    rows: [row(m, i, m.name ?? p.o.msg("plot.tooltip.value"), v === v ? p.o.fmt.value(v) : "", cs && v === v ? cs.map(v) : m.color, v)],
    x: c.x + c.w / 2, y: c.y + c.h / 2, dots: [], rect: c,
    key: { cat: m.xc[i]! },
  };
}

function tileAt(t: Tile, x: number, y: number): Tile | undefined {
  if (x < t.x || x > t.x + t.w || y < t.y || y > t.y + t.h) return undefined;
  for (const c of t.children) {
    const hit = tileAt(c, x, y);
    if (hit) return hit;
  }
  return t.depth > 0 ? t : undefined;
}

function treeHit(p: Panel, m: PTree, px: number, py: number): Hit | null {
  const root = treeTiles(p, m);
  const t = tileAt(root, px - p.area.x, py - p.area.y);
  return t ? treeHitOf(p, m, root, t) : null;
}

function treeHitOf(p: Panel, m: PTree, root: Tile, t: Tile): Hit {
  const f = p.o.fmt;
  const top = root.children.findIndex((c) => c.node === (t.path.length ? findTop(root, t) : t.node));
  const rows: TooltipRow[] = [
    { name: p.o.msg("plot.tooltip.value"), value: f.value(t.value), color: tileColor(p, m, t, Math.max(0, top)), raw: t.value, mark: m.id },
    { name: "Share", value: `${f.value(root.value > 0 ? (t.value / root.value) * 100 : 0)}%`, color: tileColor(p, m, t, Math.max(0, top)), raw: root.value > 0 ? (t.value / root.value) * 100 : 0, mark: m.id },
  ];
  if (t.node.colorValue !== undefined) rows.push({ name: "Change", value: f.value(t.node.colorValue), color: tileColor(p, m, t, Math.max(0, top)), raw: t.node.colorValue, mark: m.id });
  const rect = { x: p.area.x + t.x, y: p.area.y + t.y, w: t.w, h: t.h };
  return { title: t.path.join(" / "), rows, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, dots: [], rect };
}

function findTop(root: Tile, t: Tile): TreeNodeLike {
  const first = t.path[0];
  return (root.children.find((c) => c.node.name === first) ?? t).node;
}
type TreeNodeLike = Tile["node"];

// ---- keyboard stops --------------------------------------------------------------

export interface Stop {
  /** Position used to find the stop nearest a pointer hit. */
  x: number;
  y: number;
  hit(): Hit | null;
}

/** Everything the arrow keys can visit, in reading order. */
export function stopsOf(p: Panel, mode: HitMode, snap: boolean): Stop[] {
  const ms = tipped(p);
  const cell = ms.find((m) => m.type === "heatmap" || m.type === "treemap");
  if (cell?.type === "heatmap") {
    const m = cell;
    const order = Array.from(m.value, (_, i) => i);
    const ys = [...new Set(m.yc)], xs = [...new Set(m.xc)];
    order.sort((a, b) => ys.indexOf(m.yc[a]!) - ys.indexOf(m.yc[b]!) || xs.indexOf(m.xc[a]!) - xs.indexOf(m.xc[b]!));
    return order.map((i) => {
      const c = heatCell(p, m, i);
      return { x: c.x + c.w / 2, y: c.y + c.h / 2, hit: () => heatHitAt(p, m, i) };
    });
  }
  if (cell?.type === "treemap") {
    const m = cell;
    const root = treeTiles(p, m);
    return leaves(root).map((t) => ({ x: p.area.x + t.x + t.w / 2, y: p.area.y + t.y + t.h / 2, hit: () => treeHitOf(p, m, root, t) }));
  }
  if (mode === "none") return [];
  if (mode === "shared") {
    const axis = sharedAxis(p);
    const scale = axis === "x" ? p.sx : p.sy;
    const positions: number[] = [];
    if (isBand(scale)) for (const c of scale.domain) positions.push(scale.center(c));
    else {
      const seen = new Set<number>();
      for (const m of ms) {
        if (m.type === "histogram") {
          for (const b of m.bins) seen.add(scale.map((b.x0 + b.x1) / 2));
        } else if (hasPos(m) && (axis === "x" ? m.type !== "bar" || m.orient === "v" : m.type === "bar" && m.orient === "h")) {
          for (let i = 0; i < m.pos.length; i++) seen.add(Math.round((axis === "x" ? p.xPx(m.pos, i) : scale.map(m.pos.num![i]!)) * 100) / 100);
        }
      }
      positions.push(...[...seen].filter((v) => v === v).sort((a, b) => a - b));
    }
    return positions.map((pos) => ({
      x: axis === "x" ? pos : p.area.x, y: axis === "x" ? p.area.y : pos,
      hit: () => (axis === "x" ? sharedHit(p, pos, p.area.y + p.area.h / 2, snap) : sharedHit(p, p.area.x + p.area.w / 2, pos, snap)),
    }));
  }
  const pts: { m: PScatter | Extract<PMark, { type: "line" }>; i: number; x: number; y: number }[] = [];
  for (const m of ms) {
    if (m.type !== "scatter" && m.type !== "line") continue;
    const sy = p.yScaleOf(m.yAxis);
    if (isBand(sy)) continue;
    for (let i = 0; i < m.y.length; i++) pts.push({ m, i, x: p.xPx(m.pos, i), y: sy.map(m.y[i]!) });
  }
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  return pts.map((q) => ({
    x: q.x, y: q.y,
    hit: () => {
      const { title, rows } = pointRows(p, q.m, q.i);
      const color = q.m.type === "scatter" ? pointStyle(p, q.m, q.i).color : q.m.color;
      return { title, rows, x: q.x, y: q.y, snapX: q.x, snapY: q.y, dots: [{ x: q.x, y: q.y, color, r: 6 }] };
    },
  }));
}

export type { PHist };
