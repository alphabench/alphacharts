// Gann tools: box, square fixed, square, fan.

import type { Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { Anchor, Shape, ToolCtx, ToolDef } from "../types.js";
import { A, finiteAnchors, fmtTime, levelsProp, line, needDistinctTimes, px, pxs, shade, text, tool } from "./util.js";

const BOX_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];

/** Price at fraction r of the way from a0 to a1. */
export const gannBoxPrice = (a0: Anchor, a1: Anchor, r: number): number => a0.price + (a1.price - a0.price) * r;

/** Gann fan: the line through a0 whose slope is num/den times the 1×1 slope (a0→a1); its price at a1's time. */
export const gannFanPrice = (a0: Anchor, a1: Anchor, num: number, den: number): number => a0.price + ((a1.price - a0.price) * num) / den;

export const GANN_RATIOS: ReadonlyArray<readonly [number, number]> = [[8, 1], [4, 1], [3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [1, 4], [1, 8]];

function grid(p0: Pt, p1: Pt, xs: number[], ys: number[], color: string): Shape[] {
  const out: Shape[] = [];
  for (const r of xs) out.push(line({ x: p0.x + r * (p1.x - p0.x), y: p0.y }, { x: p0.x + r * (p1.x - p0.x), y: p1.y }, { width: 1, color: withAlpha(color, 0.7) }));
  for (const r of ys) out.push(line({ x: p0.x, y: p0.y + r * (p1.y - p0.y) }, { x: p1.x, y: p0.y + r * (p1.y - p0.y) }, { width: 1, color: withAlpha(color, 0.7) }));
  return out;
}

export const gannBox = tool({
  id: "gannBox", label: "Gann box", family: "gann", gesture: "drag", anchors: 2,
  defaults: () => ({ props: { levels: BOX_LEVELS } }),
  validate: (d) => { finiteAnchors(d); needDistinctTimes(d, 0, 1); levelsProp(d); },
  shapes(d, c) {
    const a0 = A(d, 0), a1 = A(d, 1);
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    const lv = levelsProp(d);
    // Horizontal lines sit at the scale's position of the labelled price, so label and line agree on any scale.
    const yAt = (r: number) => c.Y(gannBoxPrice(a0, a1, r));
    const out: Shape[] = [];
    for (let i = 0; i + 1 < lv.length; i += 2) {
      const ya = yAt(lv[i]!), yb = yAt(lv[i + 1]!);
      out.push(shade([{ x: p0.x, y: ya }, { x: p1.x, y: ya }, { x: p1.x, y: yb }, { x: p0.x, y: yb }], withAlpha(d.style.color, 0.06)));
    }
    out.push(...grid(p0, p1, lv, [], d.style.color));
    for (const r of lv) out.push(line({ x: p0.x, y: yAt(r) }, { x: p1.x, y: yAt(r) }, { width: 1, color: withAlpha(d.style.color, 0.7) }));
    out.push(line(p0, p1), line({ x: p0.x, y: p1.y }, { x: p1.x, y: p0.y }));
    out.push(line(p0, { x: p1.x, y: p0.y }), line({ x: p1.x, y: p0.y }, p1), line(p1, { x: p0.x, y: p1.y }), line({ x: p0.x, y: p1.y }, p0));
    for (const r of lv) {
      out.push(text(Math.min(p0.x, p1.x) - 4, yAt(r), c.fmt(gannBoxPrice(a0, a1, r)), { align: "right", base: "middle", size: 10, textColor: d.style.color, hit: false }));
      const x = p0.x + r * (p1.x - p0.x);
      out.push(text(x, Math.min(p0.y, p1.y) - 4, fmtTime(c.T(x)), { align: "center", base: "bottom", size: 9, textColor: d.style.color, hit: false }));
    }
    return out;
  },
});

const DIV8 = [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1];

function squareShapes(p0: Pt, p1: Pt, color: string): Shape[] {
  const out = grid(p0, p1, DIV8, DIV8, color);
  const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  out.push(line(p0, p1, { extB: true }), line({ x: p0.x, y: p1.y }, { x: p1.x, y: p0.y }, { extB: true }));
  out.push(line({ x: m.x, y: p0.y }, { x: p1.x, y: m.y }, { width: 1 }), line({ x: p1.x, y: m.y }, { x: m.x, y: p1.y }, { width: 1 }), line({ x: m.x, y: p1.y }, { x: p0.x, y: m.y }, { width: 1 }), line({ x: p0.x, y: m.y }, { x: m.x, y: p0.y }, { width: 1 }));
  return out;
}

export const gannSquare = tool({
  id: "gannSquare", label: "Gann square", family: "gann", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: (d) => { finiteAnchors(d); needDistinctTimes(d, 0, 1); },
  shapes: (d, c) => {
    const [p0, p1] = pxs(c, d) as [Pt, Pt];
    return squareShapes(p0, p1, d.style.color);
  },
});

/** The second corner of a fixed (screen-square) Gann square: same width and height in px. */
function fixedCorner(d: { anchors: Anchor[] }, c: ToolCtx): Pt {
  const p0 = px(c, d.anchors[0]!), p1 = px(c, d.anchors[1]!);
  const side = Math.abs(p1.x - p0.x);
  return { x: p1.x, y: p0.y + (p1.y >= p0.y ? side : -side) };
}

export const gannSquareFixed = tool({
  id: "gannSquareFixed", label: "Gann square fixed", family: "gann", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate: (d) => { finiteAnchors(d); needDistinctTimes(d, 0, 1); },
  handlePoints: (d, c) => [px(c, A(d, 0)), fixedCorner(d, c)],
  shapes: (d, c) => squareShapes(px(c, A(d, 0)), fixedCorner(d, c), d.style.color),
});

export const gannFan = tool({
  id: "gannFan", label: "Gann fan", family: "gann", gesture: "drag", anchors: 2,
  defaults: () => ({}),
  validate(d) {
    finiteAnchors(d);
    needDistinctTimes(d, 0, 1);
    if (A(d, 0).price === A(d, 1).price) throw new RangeError(`drawings: gannFan "${d.id}" needs anchors at different prices (its 1×1 line would be flat)`);
  },
  shapes(d, c) {
    const a0 = A(d, 0), a1 = A(d, 1);
    const p0 = px(c, a0), x1 = c.X(a1.time);
    const out: Shape[] = [];
    const ends = GANN_RATIOS.map(([n, m]) => ({ n, m, e: { x: x1, y: c.Y(gannFanPrice(a0, a1, n, m)) } }));
    for (let i = 0; i + 1 < ends.length; i++) {
      const far = (e: Pt): Pt => {
        const dx = e.x - p0.x, dy = e.y - p0.y;
        const k = dx !== 0 ? (c.W + 50 - p0.x) / dx : 1e4;
        return { x: p0.x + dx * k, y: p0.y + dy * k };
      };
      if (x1 > p0.x) out.push(shade([p0, far(ends[i]!.e), far(ends[i + 1]!.e)], withAlpha(d.style.color, i % 2 ? 0.04 : 0.09)));
    }
    for (const { n, m, e } of ends) {
      out.push(line(p0, e, { extB: true, extA: false, width: n === m ? d.style.width : 1 }), text(e.x + 3, e.y, `${n}x${m}`, { base: "middle", size: 10, textColor: d.style.color, hit: false }));
    }
    return out;
  },
});

export const gannTools: ToolDef[] = [gannBox, gannSquareFixed, gannSquare, gannFan];
