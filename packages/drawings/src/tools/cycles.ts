// Cycle tools: cyclic lines, time cycles, sine line.
//
// Periods are measured in x, which is linear in the bar index, so a
// non-trading gap does not stretch a cycle.

import type { Pt } from "../geometry.js";
import type { Shape, ToolDef } from "../types.js";
import { finiteAnchors, line, needDistinctTimes, pxs, tool } from "./util.js";

/** Most lines/arcs one cycle tool draws; a period this dense is not drawn. */
const MAX_REPEATS = 600;
const MIN_PERIOD_PX = 2;

function period(p0: Pt, p1: Pt): number {
  const w = Math.abs(p1.x - p0.x);
  return w;
}

export const cyclicLines = tool({
  id: "cyclicLines", label: "Cyclic lines", family: "cycles", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: (d) => { finiteAnchors(d); needDistinctTimes(d, 0, 1); },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const w = period(p0, p1);
    if (w < MIN_PERIOD_PX) return [line(p0, p1)];
    const first = Math.ceil((-50 - p0.x) / w), last = Math.floor((c.W + 50 - p0.x) / w);
    const out: Shape[] = [];
    for (let k = first; k <= last && out.length < MAX_REPEATS; k++) {
      const x = p0.x + k * w;
      out.push(line({ x, y: 0 }, { x, y: c.H }, { extA: true, extB: true }));
    }
    return out;
  },
});

export const timeCycles = tool({
  id: "timeCycles", label: "Time cycles", family: "cycles", gesture: "drag", anchors: 2,
  defaults: () => ({ style: { fill: "rgba(41,98,255,0.1)" } }),
  validate: (d) => { finiteAnchors(d); needDistinctTimes(d, 0, 1); },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const w = period(p0, p1);
    if (w < MIN_PERIOD_PX) return [line(p0, p1)];
    const out: Shape[] = [];
    // Half-ellipses of width one period and height half a period, repeating to the right of the first anchor.
    const dir = p1.x >= p0.x ? 1 : -1;
    for (let k = 0; k < MAX_REPEATS; k++) {
      const x0 = p0.x + dir * k * w;
      if (dir > 0 ? x0 > c.W + 50 : x0 < -50) break;
      out.push({ k: "arc", cx: x0 + (dir * w) / 2, cy: p0.y, r: w / 2, a0: Math.PI, a1: 2 * Math.PI, fill: d.style.fill });
    }
    return out;
  },
});

/** y of the sine through two consecutive extrema (x0,y0) and (x1,y1) at x. */
export function sineY(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const m = (y0 + y1) / 2;
  return m + (y0 - m) * Math.cos((Math.PI * (x - x0)) / (x1 - x0));
}

export const sineLine = tool({
  id: "sineLine", label: "Sine line", family: "cycles", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: (d) => { finiteAnchors(d); needDistinctTimes(d, 0, 1); },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    if (Math.abs(p1.x - p0.x) < MIN_PERIOD_PX) return [line(p0, p1)];
    const pts: number[] = [];
    for (let x = -4; x <= c.W + 4; x += 2) pts.push(x, sineY(p0.x, p0.y, p1.x, p1.y, x));
    return [{ k: "poly", pts }];
  },
});

export const cycleTools: ToolDef[] = [cyclicLines, timeCycles, sineLine];
