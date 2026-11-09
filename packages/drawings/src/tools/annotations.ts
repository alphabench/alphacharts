// Annotations: text, anchored text, note, anchored note, callout, comment,
// price label, price note, signpost, flag mark, arrow, arrow marker, arrow
// mark up, arrow mark down.
//
// "Anchored" text and notes are positioned on the pane (props.fx / props.fy,
// fractions of its size) and stay put while the chart pans; every other tool
// here is fixed to time + price.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { Drawing, Shape, ToolCtx, ToolDef } from "../types.js";
import { A, finiteAnchors, head, line, poly, px, pxs, text, tool } from "./util.js";

const BOX = { border: null, pad: 5 } as const;

function content(d: Drawing, fallback: string): string {
  return d.style.text || fallback;
}

function screenPoint(d: Drawing, c: ToolCtx): Pt {
  const fx = d.props.fx, fy = d.props.fy;
  if (typeof fx !== "number" || typeof fy !== "number" || !Number.isFinite(fx) || !Number.isFinite(fy)) throw new TypeError(`drawings: ${d.tool} "${d.id}" needs numeric props fx and fy`);
  return { x: fx * c.W, y: fy * c.H };
}

export const textTool = tool({
  id: "text", label: "Text", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { text: "Text" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    return [text(p.x, p.y, content(d, "Text"), { align: "left", base: "middle", textColor: d.style.color })];
  },
});

export const anchoredText = tool({
  id: "anchoredText", label: "Anchored text", family: "annotations", gesture: "single", anchors: 0, screen: true,
  defaults: () => ({ style: { text: "Text" }, props: { fx: 0.5, fy: 0.5 } }),
  shapes(d, c) {
    const p = screenPoint(d, c);
    return [text(p.x, p.y, content(d, "Text"), { align: "left", base: "middle", textColor: d.style.color })];
  },
});

function noteShapes(d: Drawing, p: Pt): Shape[] {
  return [
    line(p, { x: p.x + 14, y: p.y - 14 }, { width: 1 }),
    { k: "ellipse", cx: p.x, cy: p.y, rx: 3, ry: 3, fill: d.style.color, width: 1 },
    text(p.x + 14, p.y - 14, content(d, "Note"), { align: "left", base: "bottom", bg: withAlpha(d.style.color, 0.9), textColor: "contrast", ...BOX }),
  ];
}

export const note = tool({
  id: "note", label: "Note", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { text: "Note" } }),
  validate: finiteAnchors,
  shapes: (d, c) => noteShapes(d, px(c, A(d, 0))),
});

export const anchoredNote = tool({
  id: "anchoredNote", label: "Anchored note", family: "annotations", gesture: "single", anchors: 0, screen: true,
  defaults: () => ({ style: { text: "Note" }, props: { fx: 0.5, fy: 0.5 } }),
  shapes: (d, c) => noteShapes(d, screenPoint(d, c)),
});

export const callout = tool({
  id: "callout", label: "Callout", family: "annotations", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { text: "Callout" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [target, boxAt] = pxs(c, d) as [Pt, Pt];
    return [
      line(boxAt, target, { width: 1 }),
      { k: "ellipse", cx: target.x, cy: target.y, rx: 3, ry: 3, fill: d.style.color, width: 1 },
      text(boxAt.x, boxAt.y, content(d, "Callout"), { align: "center", base: "middle", bg: withAlpha(d.style.color, 0.9), textColor: "contrast", ...BOX }),
    ];
  },
});

export const comment = tool({
  id: "comment", label: "Comment", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { text: "Comment" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    return [
      poly([p, { x: p.x - 6, y: p.y - 14 }, { x: p.x + 6, y: p.y - 14 }], { close: true, fill: withAlpha(d.style.color, 0.9), width: 0, hit: false }),
      text(p.x, p.y - 14, content(d, "Comment"), { align: "center", base: "bottom", bg: withAlpha(d.style.color, 0.9), textColor: "contrast", ...BOX }),
    ];
  },
});

export const priceLabel = tool({
  id: "priceLabel", label: "Price label", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const label = `${d.style.text ? d.style.text + " " : ""}${c.fmt(A(d, 0).price)}`;
    return [
      poly([p, { x: p.x + 8, y: p.y - 9 }, { x: p.x + 8, y: p.y + 9 }], { close: true, fill: d.style.color, width: 0, hit: false }),
      text(p.x + 8, p.y, label, { align: "left", base: "middle", bg: d.style.color, textColor: "contrast", ...BOX }),
    ];
  },
});

export const priceNote = tool({
  id: "priceNote", label: "Price note", family: "annotations", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const a = px(c, A(d, 0)), b = px(c, A(d, 1));
    const label = `${d.style.text ? d.style.text + " " : ""}${c.fmt(A(d, 0).price)}`;
    return [
      line(a, { x: b.x, y: a.y }, { dash: "dashed", width: 1 }),
      line({ x: b.x, y: a.y }, b, { width: 1 }),
      { k: "ellipse", cx: a.x, cy: a.y, rx: 3, ry: 3, fill: d.style.color, width: 1 },
      text(b.x, b.y, label, { align: "center", base: "middle", bg: d.style.color, textColor: "contrast", ...BOX }),
    ];
  },
});

export const signpost = tool({
  id: "signpost", label: "Signpost", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { text: "Sign" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const top = { x: p.x, y: p.y - 44 };
    return [
      line(p, top),
      { k: "ellipse", cx: p.x, cy: p.y, rx: 3, ry: 3, fill: d.style.color, width: 1 },
      text(top.x, top.y, content(d, "Sign"), { align: "left", base: "bottom", bg: d.style.color, textColor: "contrast", ...BOX }),
    ];
  },
});

export const flagMark = tool({
  id: "flagMark", label: "Flag mark", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    return [
      line(p, { x: p.x, y: p.y - 28 }),
      poly([{ x: p.x, y: p.y - 28 }, { x: p.x + 16, y: p.y - 22 }, { x: p.x, y: p.y - 16 }], { close: true, fill: d.style.color }),
    ];
  },
});

export const arrow = tool({
  id: "arrow", label: "Arrow", family: "annotations", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b] = pxs(c, d) as [Pt, Pt];
    return [line(a, b), head(a, b, 6 + d.style.width * 2, d.style.color)];
  },
});

export const arrowMarker = tool({
  id: "arrowMarker", label: "Arrow marker", family: "annotations", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { fill: "#8a8a8a" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b] = pxs(c, d) as [Pt, Pt];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L === 0) return [line(a, b)];
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, nx = -uy, ny = ux;
    const hl = Math.min(L * 0.45, 20), sw = 4, hw = 10;
    const at = (along: number, across: number): Pt => ({ x: a.x + ux * along + nx * across, y: a.y + uy * along + ny * across });
    return [poly([at(0, sw), at(L - hl, sw), at(L - hl, hw), at(L, 0), at(L - hl, -hw), at(L - hl, -sw), at(0, -sw)], { close: true, fill: d.style.fill ?? d.style.color })];
  },
});

function markShape(d: Drawing, p: Pt, dirUp: boolean): Shape[] {
  const s = dirUp ? 1 : -1; // tip is the anchor; the body extends away from the tip
  const pts: Pt[] = [
    p, { x: p.x - 9, y: p.y + s * 11 }, { x: p.x - 4, y: p.y + s * 11 }, { x: p.x - 4, y: p.y + s * 28 },
    { x: p.x + 4, y: p.y + s * 28 }, { x: p.x + 4, y: p.y + s * 11 }, { x: p.x + 9, y: p.y + s * 11 },
  ];
  return [poly(pts, { close: true, fill: d.style.color, width: 1 })];
}

export const arrowMarkUp = tool({
  id: "arrowMarkUp", label: "Arrow mark up", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { color: "chart-up" } }),
  validate: finiteAnchors,
  shapes: (d, c) => markShape(d, px(c, A(d, 0)), true),
});

export const arrowMarkDown = tool({
  id: "arrowMarkDown", label: "Arrow mark down", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { color: "chart-down" } }),
  validate: finiteAnchors,
  shapes: (d, c) => markShape(d, px(c, A(d, 0)), false),
});

/** The side arrows: the tip is the anchor, the body extends away from it along x. */
function markShapeX(d: Drawing, p: Pt, pointsRight: boolean): Shape[] {
  const s = pointsRight ? -1 : 1;
  const pts: Pt[] = [
    p, { x: p.x + s * 11, y: p.y - 9 }, { x: p.x + s * 11, y: p.y - 4 }, { x: p.x + s * 28, y: p.y - 4 },
    { x: p.x + s * 28, y: p.y + 4 }, { x: p.x + s * 11, y: p.y + 4 }, { x: p.x + s * 11, y: p.y + 9 },
  ];
  return [poly(pts, { close: true, fill: d.style.color, width: 1 })];
}

export const arrowMarkLeft = tool({
  id: "arrowMarkLeft", label: "Arrow mark left", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { color: "#8a8a8a" } }),
  validate: finiteAnchors,
  shapes: (d, c) => markShapeX(d, px(c, A(d, 0)), false),
});

export const arrowMarkRight = tool({
  id: "arrowMarkRight", label: "Arrow mark right", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { color: "#8a8a8a" } }),
  validate: finiteAnchors,
  shapes: (d, c) => markShapeX(d, px(c, A(d, 0)), true),
});

/** A pin: a round head on a stem whose tip is the anchor, with the text above it. */
export const pin = tool({
  id: "pin", label: "Pin", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { text: "" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const out: Shape[] = [line(p, { x: p.x, y: p.y - 18 }), { k: "ellipse", cx: p.x, cy: p.y - 24, rx: 6, ry: 6, fill: d.style.color, width: 1 }];
    if (d.style.text) out.push(text(p.x, p.y - 34, d.style.text, { align: "center", base: "bottom", bg: withAlpha(d.style.color, 0.9), textColor: "contrast", ...BOX }));
    return out;
  },
});

const TABLE_CELL = { w: 76, h: 24 } as const;
export const TABLE_MAX = 20;
export const TABLE_TEXT_MAX = 200;

/** A table of text on the pane (props.cells: rows of strings), positioned like the anchored notes. */
export const table = tool({
  id: "table", label: "Table", family: "annotations", gesture: "single", anchors: 0, screen: true,
  defaults: () => ({ props: { fx: 0.5, fy: 0.5, cells: [["", ""], ["", ""]] } }),
  validate(d) {
    const cells = d.props.cells;
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > TABLE_MAX) throw new RangeError(`drawings: table "${d.id}" prop "cells" must be 1..${TABLE_MAX} rows`);
    for (const row of cells) {
      if (!Array.isArray(row) || row.length < 1 || row.length > TABLE_MAX) throw new RangeError(`drawings: table "${d.id}" every row of "cells" must have 1..${TABLE_MAX} cells`);
      for (const cell of row) if (typeof cell !== "string" || cell.length > TABLE_TEXT_MAX) throw new TypeError(`drawings: table "${d.id}" every cell must be text of at most ${TABLE_TEXT_MAX} characters`);
    }
  },
  shapes(d, c) {
    const p = screenPoint(d, c);
    const cells = d.props.cells as string[][];
    const out: Shape[] = [];
    cells.forEach((row, r) => row.forEach((cell, col) => {
      const x = p.x + col * TABLE_CELL.w, y = p.y + r * TABLE_CELL.h;
      out.push(poly([{ x, y }, { x: x + TABLE_CELL.w, y }, { x: x + TABLE_CELL.w, y: y + TABLE_CELL.h }, { x, y: y + TABLE_CELL.h }], { close: true, fill: withAlpha(d.style.color, 0.12), width: 1 }));
      if (cell) out.push(text(x + TABLE_CELL.w / 2, y + TABLE_CELL.h / 2, cell, { align: "center", base: "middle", textColor: d.style.textColor, hit: false }));
    }));
    return out;
  },
});

export const ICON_GLYPH_MAX = 16;

/** A symbol on the chart: `props.glyph` is any text, an emoji or a pictogram character. The host's picker decides which glyphs it offers. */
export const icon = tool({
  id: "icon", label: "Icon", family: "annotations", gesture: "single", anchors: 1,
  defaults: () => ({ style: { fontSize: 24 }, props: { glyph: "★" } }),
  validate(d) {
    finiteAnchors(d);
    const g = d.props.glyph;
    if (typeof g !== "string" || !g.trim() || g.length > ICON_GLYPH_MAX) throw new TypeError(`drawings: icon "${d.id}" prop "glyph" must be 1..${ICON_GLYPH_MAX} characters of text`);
  },
  shapes(d, c) {
    const p = px(c, A(d, 0));
    return [text(p.x, p.y, d.props.glyph as string, { align: "center", base: "middle", size: d.style.fontSize, textColor: d.style.color })];
  },
});

export const annotationTools: ToolDef[] = [
  textTool, anchoredText, note, anchoredNote, callout, comment, priceLabel, priceNote, signpost, flagMark, arrow, arrowMarker, arrowMarkUp, arrowMarkDown, arrowMarkLeft, arrowMarkRight, pin, table, icon,
];
