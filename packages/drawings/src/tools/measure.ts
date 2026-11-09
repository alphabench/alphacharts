// Measure tools: date range, price range, date & price range.
//
// The numbers are `measure()` of the two anchors: Δ price, Δ/|from|·100 %,
// bars between the anchors' positions in the bar sequence (only when the
// plugin has a BarSource) and the time difference.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { Drawing, ToolCtx, ToolDef } from "../types.js";
import { A, finiteAnchors, needDistinctTimes, line, measure, measureLines, poly, pxs, text, tool, head, barsText, fmtDuration } from "./util.js";

function colour(d: Drawing, dPrice: number): string {
  return dPrice < 0 ? "chart-down" : d.style.color;
}

const label = (x: number, y: number, t: string, col: string) =>
  text(x, y, t, { align: "center", base: "middle", bg: withAlpha(col, 0.9), textColor: "contrast", pad: 4, hit: false });

function priceText(d: Drawing, c: ToolCtx): string {
  const m = measure(A(d, 0), A(d, 1), c.source);
  const sign = m.dPrice < 0 ? "-" : m.dPrice > 0 ? "+" : "";
  return `${sign}${c.fmt(Math.abs(m.dPrice))}${m.pct === null ? "" : ` (${sign}${Math.abs(m.pct).toFixed(2)}%)`}`;
}

function timeText(d: Drawing, c: ToolCtx): string {
  const m = measure(A(d, 0), A(d, 1), c.source);
  return [m.bars === null ? "" : `${barsText(m.bars)} bars`, fmtDuration(m.dTime)].filter(Boolean).join(", ");
}

export const dateRange = tool({
  id: "dateRange", label: "Date range", family: "measure", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const y = (p0.y + p1.y) / 2;
    const col = d.style.color;
    return [
      poly([{ x: p0.x, y: 0 }, { x: p1.x, y: 0 }, { x: p1.x, y: c.H }, { x: p0.x, y: c.H }], { close: true, fill: withAlpha(col, 0.1), width: 0 }),
      line({ x: p0.x, y: 0 }, { x: p0.x, y: c.H }, { width: 1, color: col }), line({ x: p1.x, y: 0 }, { x: p1.x, y: c.H }, { width: 1, color: col }),
      line({ x: p0.x, y }, { x: p1.x, y }, { width: 1, color: col }), head({ x: p0.x, y }, { x: p1.x, y }, 8, col),
      label((p0.x + p1.x) / 2, y - 14, timeText(d, c), col),
    ];
  },
});

export const priceRange = tool({
  id: "priceRange", label: "Price range", family: "measure", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const x = (p0.x + p1.x) / 2;
    const col = colour(d, A(d, 1).price - A(d, 0).price);
    return [
      poly([{ x: 0, y: p0.y }, { x: c.W, y: p0.y }, { x: c.W, y: p1.y }, { x: 0, y: p1.y }], { close: true, fill: withAlpha(col, 0.1), width: 0 }),
      line({ x: 0, y: p0.y }, { x: c.W, y: p0.y }, { width: 1, color: col, extA: true, extB: true }), line({ x: 0, y: p1.y }, { x: c.W, y: p1.y }, { width: 1, color: col, extA: true, extB: true }),
      line({ x, y: p0.y }, { x, y: p1.y }, { width: 1, color: col }), head({ x, y: p0.y }, { x, y: p1.y }, 8, col),
      label(x, (p0.y + p1.y) / 2, priceText(d, c), col),
    ];
  },
});

export const dateAndPriceRange = tool({
  id: "dateAndPriceRange", label: "Date and price range", family: "measure", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const col = colour(d, A(d, 1).price - A(d, 0).price);
    const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
    return [
      poly([p0, { x: p1.x, y: p0.y }, p1, { x: p0.x, y: p1.y }], { close: true, fill: withAlpha(col, 0.12), color: col, width: 1 }),
      line({ x: cx, y: p0.y }, { x: cx, y: p1.y }, { width: 1, color: col, hit: false }), head({ x: cx, y: p0.y }, { x: cx, y: p1.y }, 8, col),
      line({ x: p0.x, y: cy }, { x: p1.x, y: cy }, { width: 1, color: col, hit: false }), head({ x: p0.x, y: cy }, { x: p1.x, y: cy }, 8, col),
      label(cx, Math.min(p0.y, p1.y) - 14, `${priceText(d, c)}\n${timeText(d, c)}`, col),
    ];
  },
});

/**
 * A sector of a circle: click the centre, click a point on the first edge (it sets the radius), click a point toward the second
 * edge. The sweep is the shorter way round, so a sector is never more than a half circle.
 */
export const sector = tool({
  id: "sector", label: "Sector", family: "measure", gesture: "clicks", anchors: 3,
  defaults: () => ({}),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [o, p, q] = pxs(c, d) as [Pt, Pt, Pt];
    const r = Math.hypot(p.x - o.x, p.y - o.y);
    const a0 = Math.atan2(p.y - o.y, p.x - o.x);
    let delta = Math.atan2(q.y - o.y, q.x - o.x) - a0;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // the shorter way round: (-π, π]
    const a1 = a0 + delta;
    const end = { x: o.x + r * Math.cos(a1), y: o.y + r * Math.sin(a1) };
    return [
      { k: "arc", cx: o.x, cy: o.y, r, a0, a1, fill: d.style.fill ?? withAlpha(d.style.color, 0.18) },
      line(o, p),
      line(o, end),
    ];
  },
});

export const measureTools: ToolDef[] = [dateRange, priceRange, dateAndPriceRange, sector];
export { measureLines };
