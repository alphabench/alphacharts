// Channels and pitchforks: parallel channel, regression trend channel,
// flat top/bottom, disjoint channel; pitchfork (standard, Schiff, modified
// Schiff, inside) and pitchfan.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { BarSource } from "../source.js";
import type { Drawing, Shape, ToolCtx, ToolDef } from "../types.js";
import { A, FIB_BASIC, fibColor, fillOf, finiteAnchors, lerp, line, mid, needDistinctTimes, px, pxs, shade, text, tool } from "./util.js";

/** y of the line through p0, p1 at x. */
const lineY = (p0: Pt, p1: Pt, x: number): number => p0.y + ((p1.y - p0.y) * (x - p0.x)) / (p1.x - p0.x);

/** x range a channel is drawn over: its anchors, or the whole pane when extended. */
function span(d: Drawing, p0: Pt, p1: Pt, c: ToolCtx): [number, number] {
  const lo = Math.min(p0.x, p1.x), hi = Math.max(p0.x, p1.x);
  return [d.style.extendLeft ? -10 : lo, d.style.extendRight ? c.W + 10 : hi];
}

export const parallelChannel = tool({
  id: "parallelChannel", label: "Parallel channel", family: "channels", gesture: "clicks", anchors: 3,
  defaults: () => ({ style: { fill: null }, props: { midline: true } }),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [p0, p1, p2] = pxs(c, d) as [Pt, Pt, Pt];
    const off = p2.y - lineY(p0, p1, p2.x);
    const [xa, xb] = span(d, p0, p1, c);
    const base = (o: number): [Pt, Pt] => [{ x: xa, y: lineY(p0, p1, xa) + o }, { x: xb, y: lineY(p0, p1, xb) + o }];
    const [a0, a1] = base(0), [b0, b1] = base(off);
    const out: Shape[] = [shade([a0, a1, b1, b0], fillOf(d.style, 0.12)), line(a0, a1), line(b0, b1)];
    if (d.props.midline !== false) {
      const [m0, m1] = base(off / 2);
      out.push(line(m0, m1, { dash: "dashed", width: Math.max(1, d.style.width * 0.66) }));
    }
    return out;
  },
});

export interface Regression {
  slope: number;
  intercept: number;
  /** Population standard deviation of the residuals. */
  sigma: number;
  n: number;
}

/** Ordinary least squares of y on x = 0..n-1. */
export function regression(y: readonly number[]): Regression {
  const n = y.length;
  if (n < 2) throw new RangeError(`regression: needs at least 2 values, got ${n}`);
  const mx = (n - 1) / 2;
  let my = 0;
  for (const v of y) my += v;
  my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (y[i]! - my);
    sxx += (i - mx) * (i - mx);
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = y[i]! - (intercept + slope * i);
    ss += r * r;
  }
  return { slope, intercept, sigma: Math.sqrt(ss / n), n };
}

export function regressionOf(source: BarSource, t0: number, t1: number): { reg: Regression; lo: number; hi: number } {
  const [lo, hi] = source.range(Math.min(t0, t1), Math.max(t0, t1));
  if (hi - lo < 2) throw new RangeError(`regression channel: only ${hi - lo} bar(s) between the anchors`);
  const closes: number[] = [];
  for (let i = lo; i < hi; i++) closes.push(source.at(i).close);
  return { reg: regression(closes), lo, hi };
}

export const regressionTrendChannel = tool({
  id: "regressionTrendChannel", label: "Regression trend channel", family: "channels", gesture: "drag", anchors: 2, needsSource: true,
  defaults: () => ({ props: { deviations: 2 } }),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
    const k = d.props.deviations;
    if (typeof k !== "number" || !(k > 0)) throw new RangeError(`drawings: regressionTrendChannel "${d.id}" prop "deviations" must be > 0`);
  },
  shapes(d, c) {
    if (!c.source) throw new Error("regressionTrendChannel needs a BarSource");
    const { reg, lo, hi } = regressionOf(c.source, A(d, 0).time, A(d, 1).time);
    const k = d.props.deviations as number;
    const tFirst = c.source.at(lo).time, tLast = c.source.at(hi - 1).time;
    const at = (i: number, dev: number) => ({ x: 0, y: c.Y(reg.intercept + reg.slope * i + dev * reg.sigma) });
    const xa = c.X(tFirst), xb = c.X(tLast);
    const seg = (dev: number): [Pt, Pt] => [{ x: xa, y: at(0, dev).y }, { x: xb, y: at(hi - lo - 1, dev).y }];
    const [u0, u1] = seg(k), [m0, m1] = seg(0), [l0, l1] = seg(-k);
    return [
      shade([u0, u1, l1, l0], fillOf(d.style, 0.1)),
      line(u0, u1), line(l0, l1),
      line(m0, m1, { dash: "dashed" }),
    ];
  },
});

export const flatTopBottom = tool({
  id: "flatTopBottom", label: "Flat top/bottom", family: "channels", gesture: "clicks", anchors: 3,
  defaults: () => ({}),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [p0, p1, p2] = pxs(c, d) as [Pt, Pt, Pt];
    const y = p2.y;
    return [shade([p0, p1, { x: p1.x, y }, { x: p0.x, y }], fillOf(d.style, 0.12)), line(p0, p1), line({ x: p0.x, y }, { x: p1.x, y })];
  },
});

export const disjointChannel = tool({
  id: "disjointChannel", label: "Disjoint channel", family: "channels", gesture: "clicks", anchors: 4,
  defaults: () => ({}),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [p0, p1, p2, p3] = pxs(c, d) as [Pt, Pt, Pt, Pt];
    return [shade([p0, p1, p3, p2], fillOf(d.style, 0.12)), line(p0, p1), line(p2, p3)];
  },
});

// ---- pitchforks ---------------------------------------------------------------

export type ForkVariant = "standard" | "schiff" | "modifiedSchiff" | "inside";

/**
 * Where the median line starts and the points the two outer tines pass
 * through. The median always runs to the midpoint M of B and C; tines are
 * parallel to it.
 * - standard: from A; tines through B and C.
 * - schiff: from (A.x, midpoint price of A and B).
 * - modifiedSchiff: from the midpoint of A and B.
 * - inside: from A; tines through the midpoints of A–B and A–C.
 */
export function forkGeometry(v: ForkVariant, a: Pt, b: Pt, cc: Pt): { origin: Pt; m: Pt; t1: Pt; t2: Pt } {
  const m = mid(b, cc);
  switch (v) {
    case "standard": return { origin: a, m, t1: b, t2: cc };
    case "schiff": return { origin: { x: a.x, y: (a.y + b.y) / 2 }, m, t1: b, t2: cc };
    case "modifiedSchiff": return { origin: mid(a, b), m, t1: b, t2: cc };
    case "inside": return { origin: a, m, t1: mid(a, b), t2: mid(a, cc) };
  }
}

function forkTool(id: string, label: string, v: ForkVariant): ToolDef {
  return tool({
    id, label, family: "pitchforks", gesture: "clicks", anchors: 3,
    defaults: () => ({}),
    validate: finiteAnchors,
    shapes(d, c) {
      const [a, b, cc] = pxs(c, d) as [Pt, Pt, Pt];
      const g = forkGeometry(v, a, b, cc);
      const u = { x: g.m.x - g.origin.x, y: g.m.y - g.origin.y };
      if (u.x === 0 && u.y === 0) throw new RangeError(`drawings: ${id} "${d.id}" has a zero-length median`);
      const ahead = (p: Pt): Pt => ({ x: p.x + u.x, y: p.y + u.y });
      // Bands out to the pane edge along the median direction.
      const far = (p: Pt): Pt => {
        const k = u.x > 0 ? (c.W + 50 - p.x) / u.x : u.x < 0 ? (-50 - p.x) / u.x : 1e4;
        return { x: p.x + u.x * k, y: p.y + u.y * k };
      };
      const fo = far(g.origin);
      return [
        shade([g.origin, g.t1, far(g.t1), fo], withAlpha(d.style.color, 0.08)),
        shade([g.origin, g.t2, far(g.t2), fo], withAlpha(d.style.color, 0.08)),
        line(g.origin, ahead(g.origin), { extB: true }),
        line(g.t1, ahead(g.t1), { extB: true }),
        line(g.t2, ahead(g.t2), { extB: true }),
        line(b, cc, { dash: "dashed", width: 1 }),
        line(a, b, { dash: "dotted", width: 1, hit: false }),
      ];
    },
  });
}

export const pitchfork = forkTool("pitchfork", "Pitchfork", "standard");
export const schiffPitchfork = forkTool("schiffPitchfork", "Schiff pitchfork", "schiff");
export const modifiedSchiffPitchfork = forkTool("modifiedSchiffPitchfork", "Modified Schiff pitchfork", "modifiedSchiff");
export const insidePitchfork = forkTool("insidePitchfork", "Inside pitchfork", "inside");

export const pitchfan = tool({
  id: "pitchfan", label: "Pitchfan", family: "pitchforks", gesture: "clicks", anchors: 3,
  defaults: () => ({ props: { levels: FIB_BASIC } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b, cc] = pxs(c, d) as [Pt, Pt, Pt];
    const levels = d.props.levels as number[];
    const out: Shape[] = [line(b, cc, { dash: "dashed", width: 1 })];
    const rays = levels.map((r) => {
      const p = lerp(b, cc, r);
      return { r, p };
    });
    for (let i = 0; i + 1 < rays.length; i++) {
      const u = rays[i]!.p, v = rays[i + 1]!.p;
      const far = (p: Pt): Pt => {
        const dx = p.x - a.x, dy = p.y - a.y;
        const k = dx > 0 ? (c.W + 50 - a.x) / dx : dx < 0 ? (-50 - a.x) / dx : 1e4;
        return { x: a.x + dx * k, y: a.y + dy * k };
      };
      out.push(shade([a, far(u), far(v)], withAlpha(fibColor(rays[i]!.r), 0.07)));
    }
    for (const { r, p } of rays) out.push(line(a, p, { extB: true, color: fibColor(r), width: r === 0.5 ? d.style.width : 1 }), text(p.x, p.y, String(r), { textColor: fibColor(r), size: 10, hit: false }));
    return out;
  },
});

export const channelTools: ToolDef[] = [parallelChannel, regressionTrendChannel, flatTopBottom, disjointChannel, pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork, pitchfan];
