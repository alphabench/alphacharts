// Line tools: trend line, ray, info line, extended line, horizontal line,
// horizontal ray, vertical line, cross line.

import { crisp } from "@alphacharts/core";
import type { ToolDef } from "../types.js";
import { A, extension, finiteAnchors, fmtTime, line, measure, measureLines, needDistinctTimes, px, text, tool } from "./util.js";

const twoPoint = (d: Parameters<NonNullable<ToolDef["validate"]>>[0]) => {
  finiteAnchors(d);
};

export const trendLine = tool({
  id: "trendLine", label: "Trend line", family: "lines", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: twoPoint,
  shapes: (d, c) => {
    const a = px(c, A(d, 0)), b = px(c, A(d, 1));
    return [line(a, b, extension(d.style, a, b))];
  },
});

export const ray = tool({
  id: "ray", label: "Ray", family: "lines", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { extendRight: true } }),
  validate: twoPoint,
  shapes: (d, c) => [line(px(c, A(d, 0)), px(c, A(d, 1)), { extA: false, extB: true })],
});

export const extendedLine = tool({
  id: "extendedLine", label: "Extended line", family: "lines", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { extendLeft: true, extendRight: true } }),
  validate: twoPoint,
  shapes: (d, c) => [line(px(c, A(d, 0)), px(c, A(d, 1)), { extA: true, extB: true })],
});

export const infoLine = tool({
  id: "infoLine", label: "Info line", family: "lines", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: twoPoint,
  shapes(d, c) {
    const a = A(d, 0), b = A(d, 1);
    const p = px(c, a), q = px(c, b);
    const m = measure(a, b, c.source);
    return [
      line(p, q, extension(d.style, p, q)),
      text((p.x + q.x) / 2, (p.y + q.y) / 2 - 8, [...measureLines(m, c), `${fmtTime(a.time)} → ${fmtTime(b.time)}`].join("\n"), {
        align: "center", base: "bottom", bg: d.style.color, border: null, textColor: "#ffffff", pad: 4,
      }),
    ];
  },
});

export const horizontalLine = tool({
  id: "horizontalLine", label: "Horizontal line", family: "lines", gesture: "single", anchors: 1,
  defaults: () => ({}),
  validate: twoPoint,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const y = crisp(p.y, c.dpr, d.style.width);
    return [
      line({ x: 0, y }, { x: c.W, y }, { extA: true, extB: true }),
      text(c.W - 6, y - 2, c.fmt(A(d, 0).price), { align: "right", base: "bottom", textColor: d.style.color, hit: false, stack: true }),
    ];
  },
});

/** Pixels left of a horizontal ray's start a price label needs ("24579.90" at the default size). */
const RAY_LABEL_ROOM = 72;

export const horizontalRay = tool({
  id: "horizontalRay", label: "Horizontal ray", family: "lines", gesture: "single", anchors: 1,
  defaults: () => ({}),
  validate: twoPoint,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const y = crisp(p.y, c.dpr, d.style.width);
    // The price sits at the ray's left end, clear of the candles and the last-price tag at the right; a ray that
    // starts at the pane's left edge has no room there, so its label sits above the line at the start.
    const label = p.x >= RAY_LABEL_ROOM
      ? text(p.x - 4, y, c.fmt(A(d, 0).price), { align: "right", base: "middle", textColor: d.style.color, hit: false, stack: true })
      : text(Math.max(p.x, 0) + 4, y - 2, c.fmt(A(d, 0).price), { align: "left", base: "bottom", textColor: d.style.color, hit: false, stack: true });
    return [line({ x: p.x, y }, { x: p.x + 1, y }, { extB: true }), label];
  },
});

export const verticalLine = tool({
  id: "verticalLine", label: "Vertical line", family: "lines", gesture: "single", anchors: 1,
  defaults: () => ({}),
  validate: twoPoint,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const x = crisp(p.x, c.dpr, d.style.width);
    return [line({ x, y: 0 }, { x, y: c.H }, { extA: true, extB: true }), text(x + 4, 4, fmtTime(A(d, 0).time), { base: "top", textColor: d.style.color, hit: false })];
  },
});

export const crossLine = tool({
  id: "crossLine", label: "Cross line", family: "lines", gesture: "single", anchors: 1,
  defaults: () => ({}),
  validate: twoPoint,
  shapes(d, c) {
    const p = px(c, A(d, 0));
    const x = crisp(p.x, c.dpr, d.style.width), y = crisp(p.y, c.dpr, d.style.width);
    return [line({ x: 0, y }, { x: c.W, y }, { extA: true, extB: true }), line({ x, y: 0 }, { x, y: c.H }, { extA: true, extB: true })];
  },
});

export const lineTools: ToolDef[] = [trendLine, ray, infoLine, extendedLine, horizontalLine, horizontalRay, verticalLine, crossLine];
export { needDistinctTimes };
