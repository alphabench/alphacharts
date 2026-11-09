// Fibonacci tools: retracement, trend-based extension, channel, time zone,
// speed resistance fan, trend-based time, circles, spiral, speed resistance
// arcs, wedge.
//
// Level prices are exact arithmetic on the anchors (see the *Price helpers);
// the screen position is the price scale's mapping of that price. Spacing in
// time (time zones, trend-based time) is done in x, which is linear in the
// bar index, so a weekend gap does not stretch a zone.

import type { Pt } from "../geometry.js";
import { dist } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { Anchor, Drawing, Shape, ToolDef } from "../types.js";
import { A, FIB_BASIC, FIB_RETRACEMENT, fibColor, fillOf, finiteAnchors, levelsProp, line, needDistinctTimes, px, pxs, shade, text, tool } from "./util.js";

/** Retracement: level 0 is a1, level 1 is a0. */
export const fibRetracementPrice = (a0: Anchor, a1: Anchor, r: number): number => a1.price + (a0.price - a1.price) * r;

/** Trend-based extension: level 0 is c, 1 projects the full a→b move from c. */
export const fibExtensionPrice = (a: Anchor, b: Anchor, c: Anchor, r: number): number => c.price + (b.price - a.price) * r;

export const FIB_SEQUENCE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const PHI = (1 + Math.sqrt(5)) / 2;

const lvl = (levels: number[]) => ({ props: { levels } });

export const fibRetracement = tool({
  id: "fibRetracement", label: "Fib retracement", family: "fibonacci", gesture: "drag", anchors: 2,
  defaults: () => lvl(FIB_RETRACEMENT),
  validate: (d) => { finiteAnchors(d); levelsProp(d); },
  shapes(d, c) {
    const a0 = A(d, 0), a1 = A(d, 1);
    const p0 = px(c, a0), p1 = px(c, a1);
    const xl = Math.min(p0.x, p1.x), xr = d.style.extendRight ? c.W + 10 : Math.max(p0.x, p1.x);
    const out: Shape[] = [line(p0, p1, { dash: "dashed", width: 1, color: "muted" })];
    const lv = levelsProp(d);
    const ys = lv.map((r) => c.Y(fibRetracementPrice(a0, a1, r)));
    for (let i = 0; i + 1 < lv.length; i++) out.push(shade([{ x: xl, y: ys[i]! }, { x: xr, y: ys[i]! }, { x: xr, y: ys[i + 1]! }, { x: xl, y: ys[i + 1]! }], withAlpha(fibColor(lv[i + 1]!), 0.07)));
    lv.forEach((r, i) => {
      const y = ys[i]!;
      out.push(line({ x: xl, y }, { x: xr, y }, { color: fibColor(r), width: 1 }));
      out.push(text(xl - 4, y, `${r} (${c.fmt(fibRetracementPrice(a0, a1, r))})`, { align: "right", base: "middle", textColor: fibColor(r), size: 10, hit: false }));
    });
    return out;
  },
});

export const fibExtension = tool({
  id: "fibExtension", label: "Trend-based Fib extension", family: "fibonacci", gesture: "clicks", anchors: 3,
  defaults: () => lvl([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236]),
  validate: (d) => { finiteAnchors(d); levelsProp(d); },
  shapes(d, c) {
    const [a, b, cc] = [A(d, 0), A(d, 1), A(d, 2)];
    const [pa, pb, pc] = [px(c, a), px(c, b), px(c, cc)];
    const xl = pc.x, xr = d.style.extendRight ? c.W + 10 : Math.max(pc.x, pb.x) + 40;
    const out: Shape[] = [line(pa, pb, { dash: "dashed", width: 1, color: "muted" }), line(pb, pc, { dash: "dashed", width: 1, color: "muted" })];
    const lv = levelsProp(d);
    const ys = lv.map((r) => c.Y(fibExtensionPrice(a, b, cc, r)));
    for (let i = 0; i + 1 < lv.length; i++) out.push(shade([{ x: xl, y: ys[i]! }, { x: xr, y: ys[i]! }, { x: xr, y: ys[i + 1]! }, { x: xl, y: ys[i + 1]! }], withAlpha(fibColor(lv[i + 1]!), 0.07)));
    lv.forEach((r, i) => {
      const y = ys[i]!;
      out.push(line({ x: xl, y }, { x: xr, y }, { color: fibColor(r), width: 1 }));
      out.push(text(xl - 4, y, `${r} (${c.fmt(fibExtensionPrice(a, b, cc, r))})`, { align: "right", base: "middle", textColor: fibColor(r), size: 10, hit: false }));
    });
    return out;
  },
});

export const fibChannel = tool({
  id: "fibChannel", label: "Fib channel", family: "fibonacci", gesture: "clicks", anchors: 3,
  defaults: () => lvl([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]),
  validate(d) {
    finiteAnchors(d);
    levelsProp(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [p0, p1, p2] = pxs(c, d) as [Pt, Pt, Pt];
    const base = p0.y + ((p1.y - p0.y) * (p2.x - p0.x)) / (p1.x - p0.x);
    const off = p2.y - base;
    const lv = levelsProp(d);
    const at = (r: number): [Pt, Pt] => [{ x: p0.x, y: p0.y + r * off }, { x: p1.x, y: p1.y + r * off }];
    const out: Shape[] = [];
    for (let i = 0; i + 1 < lv.length; i++) {
      const [a0, a1] = at(lv[i]!), [b0, b1] = at(lv[i + 1]!);
      out.push(shade([a0, a1, b1, b0], withAlpha(fibColor(lv[i + 1]!), 0.07)));
    }
    for (const r of lv) {
      const [a0, a1] = at(r);
      out.push(line(a0, a1, { extB: d.style.extendRight, extA: d.style.extendLeft, color: fibColor(r), width: 1 }), text(a1.x + 4, a1.y, String(r), { base: "middle", textColor: fibColor(r), size: 10, hit: false }));
    }
    return out;
  },
});

export const fibTimeZone = tool({
  id: "fibTimeZone", label: "Fib time zone", family: "fibonacci", gesture: "drag", anchors: 2,
  defaults: () => lvl(FIB_SEQUENCE),
  validate(d) {
    finiteAnchors(d);
    levelsProp(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const unit = p1.x - p0.x;
    const out: Shape[] = [];
    for (const n of levelsProp(d)) {
      const x = p0.x + n * unit;
      if (x < -50 || x > c.W + 50) continue;
      out.push(line({ x, y: 0 }, { x, y: c.H }, { extA: true, extB: true, color: n === 0 || n === 1 ? "muted" : "#8a8a8a", width: 1 }), text(x + 3, 3, String(n), { base: "top", size: 10, textColor: "muted", hit: false }));
    }
    out.push(line(p0, p1, { dash: "dashed", width: 1 }));
    return out;
  },
});

export const FIB_FAN = [0.25, 0.382, 0.5, 0.618, 0.75, 1];
export const fibSpeedFan = tool({
  id: "fibSpeedFan", label: "Fib speed resistance fan", family: "fibonacci", gesture: "drag", anchors: 2,
  defaults: () => lvl(FIB_FAN),
  validate(d) {
    finiteAnchors(d);
    levelsProp(d);
    needDistinctTimes(d, 0, 1);
    if (A(d, 0).price === A(d, 1).price) throw new RangeError(`drawings: fibSpeedFan "${d.id}" needs anchors at different prices`);
  },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const out: Shape[] = [
      shade([p0, { x: p1.x, y: p0.y }, p1, { x: p0.x, y: p1.y }], withAlpha(d.style.color, 0.05)),
      line(p0, { x: p1.x, y: p0.y }, { dash: "dashed", width: 1, hit: false }), line({ x: p1.x, y: p0.y }, p1, { dash: "dashed", width: 1, hit: false }),
      line(p1, { x: p0.x, y: p1.y }, { dash: "dashed", width: 1, hit: false }), line({ x: p0.x, y: p1.y }, p0, { dash: "dashed", width: 1, hit: false }),
    ];
    for (const r of levelsProp(d)) {
      const colour = fibColor(r === 0.25 ? 0.5 : r);
      const e1 = { x: p1.x, y: p0.y + r * (p1.y - p0.y) }, e2 = { x: p0.x + r * (p1.x - p0.x), y: p1.y };
      out.push(line(p0, e1, { extB: true, color: colour, width: 1 }), line(p0, e2, { extB: true, color: colour, width: 1 }), text(e1.x + 3, e1.y, String(r), { base: "middle", size: 10, textColor: colour, hit: false }));
    }
    return out;
  },
});

export const fibTrendTime = tool({
  id: "fibTrendTime", label: "Trend-based Fib time", family: "fibonacci", gesture: "clicks", anchors: 3,
  defaults: () => lvl([0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 4.236]),
  validate(d) {
    finiteAnchors(d);
    levelsProp(d);
    needDistinctTimes(d, 0, 1);
  },
  shapes(d, c) {
    const [pa, pb, pc] = pxs(c, d) as [Pt, Pt, Pt];
    const unit = pb.x - pa.x;
    const out: Shape[] = [line(pa, pb, { dash: "dashed", width: 1, color: "muted" })];
    for (const r of levelsProp(d)) {
      const x = pc.x + r * unit;
      if (x < -50 || x > c.W + 50) continue;
      out.push(line({ x, y: 0 }, { x, y: c.H }, { extA: true, extB: true, color: fibColor(r), width: 1 }), text(x + 3, 3, String(r), { base: "top", size: 10, textColor: fibColor(r), hit: false }));
    }
    return out;
  },
});

export const fibCircles = tool({
  id: "fibCircles", label: "Fib circles", family: "fibonacci", gesture: "drag", anchors: 2,
  defaults: () => lvl([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]),
  validate(d) {
    finiteAnchors(d);
    levelsProp(d);
  },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const base = dist(p0.x, p0.y, p1.x, p1.y);
    const out: Shape[] = [line(p0, p1, { dash: "dashed", width: 1, color: "muted" })];
    for (const r of levelsProp(d)) {
      out.push({ k: "ellipse", cx: p0.x, cy: p0.y, rx: base * r, ry: base * r, color: fibColor(r), width: 1 }, text(p0.x + base * r, p0.y, String(r), { size: 10, base: "bottom", textColor: fibColor(r), hit: false }));
    }
    return out;
  },
});

export const fibSpiral = tool({
  id: "fibSpiral", label: "Fib spiral", family: "fibonacci", gesture: "drag", anchors: 2,
  defaults: () => ({ props: { clockwise: false } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const r0 = dist(p0.x, p0.y, p1.x, p1.y);
    if (r0 === 0) return [line(p0, p1)];
    const th0 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const dir = d.props.clockwise === true ? 1 : -1;
    // r(θ) = r0·φ^(2θ/π): the golden spiral, growing by φ every quarter turn.
    const maxR = 2 * Math.hypot(c.W, c.H);
    const thMax = Math.min(8 * Math.PI, (Math.log(maxR / r0) * Math.PI) / (2 * Math.log(PHI)));
    const pts: Pt[] = [];
    for (let th = -3 * Math.PI; th <= thMax; th += 0.08) {
      const r = r0 * Math.pow(PHI, (2 * th) / Math.PI);
      pts.push({ x: p0.x + r * Math.cos(th0 + dir * th), y: p0.y + r * Math.sin(th0 + dir * th) });
    }
    return [line(p0, p1, { dash: "dashed", width: 1 }), { k: "poly", pts: pts.flatMap((p) => [p.x, p.y]) }];
  },
});

export const FIB_ARCS = [0.382, 0.5, 0.618, 1, 1.382, 1.618];
export const fibSpeedArcs = tool({
  id: "fibSpeedArcs", label: "Fib speed resistance arcs", family: "fibonacci", gesture: "drag", anchors: 2,
  defaults: () => lvl(FIB_ARCS),
  validate: (d) => { finiteAnchors(d); levelsProp(d); },
  shapes(d, c) {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const base = dist(p0.x, p0.y, p1.x, p1.y);
    const th = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const out: Shape[] = [line(p0, p1, { dash: "dashed", width: 1, color: "muted" })];
    for (const r of levelsProp(d)) {
      out.push({ k: "arc", cx: p1.x, cy: p1.y, r: base * r, a0: th - Math.PI / 2, a1: th + Math.PI / 2, color: fibColor(r), width: 1 });
      out.push(text(p1.x + base * r * Math.cos(th), p1.y + base * r * Math.sin(th), String(r), { size: 10, base: "middle", textColor: fibColor(r), hit: false }));
    }
    return out;
  },
});

export const fibWedge = tool({
  id: "fibWedge", label: "Fib wedge", family: "fibonacci", gesture: "clicks", anchors: 3,
  defaults: () => lvl([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]),
  validate: (d) => { finiteAnchors(d); levelsProp(d); },
  shapes(d, c) {
    const [p0, p1, p2] = pxs(c, d) as [Pt, Pt, Pt];
    const base = dist(p0.x, p0.y, p1.x, p1.y);
    const t1 = Math.atan2(p1.y - p0.y, p1.x - p0.x), t2 = Math.atan2(p2.y - p0.y, p2.x - p0.x);
    // Sweep the shorter way from arm 1 to arm 2.
    const delta = ((((t2 - t1 + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const out: Shape[] = [line(p0, p1, { extB: true }), line(p0, p2, { extB: true })];
    for (const r of levelsProp(d)) out.push({ k: "arc", cx: p0.x, cy: p0.y, r: base * r, a0: t1, a1: t1 + delta, color: fibColor(r), width: 1 });
    return out;
  },
});

export const fibTools: ToolDef[] = [fibRetracement, fibExtension, fibChannel, fibTimeZone, fibSpeedFan, fibTrendTime, fibCircles, fibSpiral, fibSpeedArcs, fibWedge];
export { FIB_BASIC, fillOf };
export type { Drawing };
