// Pattern tools: XABCD, cypher, ABCD, triangle pattern, three drives, head
// and shoulders, and the Elliott family (impulse, correction, triangle,
// double combo, triple combo).
//
// Ratios are |move| / |move| of exact anchor prices (see the *Ratios
// helpers); a ratio over a zero move is printed as "n/a", never as 0.

import { intersect, type Pt } from "../geometry.js";
import { withAlpha } from "../shapes.js";
import type { Anchor, Drawing, Shape, ToolDef } from "../types.js";
import { A, finiteAnchors, line, mid, poly, pxs, ratio, ratioText, shade, text, tool } from "./util.js";

const mv = (a: Anchor, b: Anchor) => Math.abs(b.price - a.price);

export function xabcdRatios(x: Anchor, a: Anchor, b: Anchor, c: Anchor, d: Anchor) {
  return { abXa: ratio(mv(a, b), mv(x, a)), bcAb: ratio(mv(b, c), mv(a, b)), cdBc: ratio(mv(c, d), mv(b, c)), adXa: ratio(mv(a, d), mv(x, a)) };
}

export function cypherRatios(x: Anchor, a: Anchor, b: Anchor, c: Anchor, d: Anchor) {
  return { abXa: ratio(mv(a, b), mv(x, a)), xcXa: ratio(mv(x, c), mv(x, a)), cdXc: ratio(mv(c, d), mv(x, c)) };
}

export function abcdRatios(a: Anchor, b: Anchor, c: Anchor, d: Anchor) {
  return { bcAb: ratio(mv(b, c), mv(a, b)), cdBc: ratio(mv(c, d), mv(b, c)) };
}

export function driveRatios(pts: readonly Anchor[]) {
  if (pts.length !== 7) throw new RangeError(`three drives needs 7 anchors, got ${pts.length}`);
  const p = pts as readonly [Anchor, Anchor, Anchor, Anchor, Anchor, Anchor, Anchor];
  return [ratio(mv(p[1], p[2]), mv(p[0], p[1])), ratio(mv(p[2], p[3]), mv(p[1], p[2])), ratio(mv(p[3], p[4]), mv(p[2], p[3])), ratio(mv(p[4], p[5]), mv(p[3], p[4])), ratio(mv(p[5], p[6]), mv(p[4], p[5]))];
}

/** Labels at the anchors, above a local high and below a local low. */
function pointLabels(ps: readonly Pt[], names: readonly string[], color: string): Shape[] {
  const out: Shape[] = [];
  ps.forEach((p, i) => {
    const name = names[i];
    if (!name) return;
    const prev = ps[i - 1], next = ps[i + 1];
    const high = (!prev || p.y <= prev.y) && (!next || p.y <= next.y);
    out.push(text(p.x, p.y + (high ? -6 : 6), name, { align: "center", base: high ? "bottom" : "top", textColor: color, hit: false }));
  });
  return out;
}

const dashed = { dash: "dashed" as const, width: 1, hit: false };
const ratioLabel = (a: Pt, b: Pt, r: number | null, color: string): Shape => {
  const m = mid(a, b);
  return text(m.x, m.y, ratioText(r), { align: "center", base: "middle", bg: withAlpha(color, 0.85), textColor: "contrast", pad: 2, size: 10, hit: false });
};

export const xabcd = tool({
  id: "xabcd", label: "XABCD pattern", family: "patterns", gesture: "clicks", anchors: 5,
  defaults: () => ({ style: { fill: "rgba(138,138,138,0.12)" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [x, a, b, cc, dd] = pxs(c, d) as [Pt, Pt, Pt, Pt, Pt];
    const r = xabcdRatios(A(d, 0), A(d, 1), A(d, 2), A(d, 3), A(d, 4));
    const col = d.style.color;
    return [
      shade([x, a, b], d.style.fill ?? withAlpha(col, 0.12)), shade([b, cc, dd], d.style.fill ?? withAlpha(col, 0.12)),
      poly([x, a, b, cc, dd]),
      line(x, b, dashed), line(a, cc, dashed), line(b, dd, dashed), line(x, dd, dashed),
      ratioLabel(x, b, r.abXa, col), ratioLabel(a, cc, r.bcAb, col), ratioLabel(b, dd, r.cdBc, col), ratioLabel(x, dd, r.adXa, col),
      ...pointLabels([x, a, b, cc, dd], ["X", "A", "B", "C", "D"], col),
    ];
  },
});

export const cypher = tool({
  id: "cypher", label: "Cypher pattern", family: "patterns", gesture: "clicks", anchors: 5,
  defaults: () => ({ style: { fill: "chart-3/0.12", color: "chart-3" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [x, a, b, cc, dd] = pxs(c, d) as [Pt, Pt, Pt, Pt, Pt];
    const r = cypherRatios(A(d, 0), A(d, 1), A(d, 2), A(d, 3), A(d, 4));
    const col = d.style.color;
    return [
      shade([x, a, b], d.style.fill ?? withAlpha(col, 0.12)), shade([b, cc, dd], d.style.fill ?? withAlpha(col, 0.12)),
      poly([x, a, b, cc, dd]),
      line(x, b, dashed), line(a, cc, dashed), line(x, cc, dashed), line(b, dd, dashed),
      ratioLabel(x, b, r.abXa, col), ratioLabel(x, cc, r.xcXa, col), ratioLabel(b, dd, r.cdXc, col),
      ...pointLabels([x, a, b, cc, dd], ["X", "A", "B", "C", "D"], col),
    ];
  },
});

export const abcd = tool({
  id: "abcd", label: "ABCD pattern", family: "patterns", gesture: "clicks", anchors: 4,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b, cc, dd] = pxs(c, d) as [Pt, Pt, Pt, Pt];
    const r = abcdRatios(A(d, 0), A(d, 1), A(d, 2), A(d, 3));
    const col = d.style.color;
    return [poly([a, b, cc, dd]), line(a, cc, dashed), line(b, dd, dashed), ratioLabel(a, cc, r.bcAb, col), ratioLabel(b, dd, r.cdBc, col), ...pointLabels([a, b, cc, dd], ["A", "B", "C", "D"], col)];
  },
});

export const trianglePattern = tool({
  id: "trianglePattern", label: "Triangle pattern", family: "patterns", gesture: "clicks", anchors: 4,
  defaults: () => ({ style: { fill: "rgba(138,138,138,0.1)" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const [a, b, cc, dd] = pxs(c, d) as [Pt, Pt, Pt, Pt];
    const col = d.style.color;
    const out: Shape[] = [poly([a, b, cc, dd]), line(a, cc, { extB: true, dash: "dashed", width: 1 }), line(b, dd, { extB: true, dash: "dashed", width: 1 })];
    // Apex: where the two trendlines meet, when they converge.
    const apex = intersect(a, cc, b, dd);
    if (apex && apex.x > Math.max(cc.x, dd.x)) out.unshift(shade([a, b, apex], d.style.fill ?? withAlpha(col, 0.1)));
    return [...out, ...pointLabels([a, b, cc, dd], ["A", "B", "C", "D"], col)];
  },
});

export const threeDrives = tool({
  id: "threeDrives", label: "Three drives pattern", family: "patterns", gesture: "clicks", anchors: 7,
  defaults: () => ({}),
  validate: finiteAnchors,
  shapes(d, c) {
    const ps = pxs(c, d);
    const col = d.style.color;
    const rs = driveRatios(d.anchors);
    const out: Shape[] = [poly(ps)];
    rs.forEach((r, i) => out.push(ratioLabel(ps[i + 1]!, ps[i + 2]!, r, col)));
    return [...out, ...pointLabels(ps, ["0", "1", "A", "2", "B", "3", "C"], col)];
  },
});

export const headAndShoulders = tool({
  id: "headAndShoulders", label: "Head and shoulders", family: "patterns", gesture: "clicks", anchors: 7,
  defaults: () => ({ style: { fill: "chart-down/0.12" } }),
  validate: finiteAnchors,
  shapes(d, c) {
    const ps = pxs(c, d);
    const [, ls, n1, head, n2, rs] = ps as [Pt, Pt, Pt, Pt, Pt, Pt, Pt];
    const col = d.style.color;
    return [
      shade([n1, ls, head], d.style.fill ?? withAlpha(col, 0.12)),
      shade([n1, head, n2], d.style.fill ?? withAlpha(col, 0.12)),
      shade([n2, head, rs], d.style.fill ?? withAlpha(col, 0.12)),
      poly(ps),
      line(n1, n2, { extB: true, dash: "dashed", width: 1 }),
      text(n2.x + 6, n2.y, "Neckline", { base: "top", size: 10, textColor: col, hit: false }),
      ...pointLabels(ps, ["", "Left shoulder", "", "Head", "", "Right shoulder", ""], col),
    ];
  },
});

// ---- Elliott ---------------------------------------------------------------------

export type Degree = "minuette" | "minor" | "intermediate" | "primary";

/** Wave label for a degree: minuette ((1)), minor 1, intermediate (1), primary [1]. */
export function waveLabel(degree: Degree, n: string): string {
  switch (degree) {
    case "minuette": return `((${n}))`;
    case "minor": return n;
    case "intermediate": return `(${n})`;
    case "primary": return `[${n}]`;
  }
}

function elliott(id: string, label: string, names: string[]): ToolDef {
  return tool({
    id, label, family: "elliott", gesture: "clicks", anchors: names.length,
    defaults: () => ({ props: { degree: "intermediate" } }),
    validate(d: Drawing) {
      finiteAnchors(d);
      if (!["minuette", "minor", "intermediate", "primary"].includes(d.props.degree as string)) throw new RangeError(`drawings: ${id} "${d.id}" prop "degree" must be minuette, minor, intermediate or primary`);
    },
    shapes(d, c) {
      const ps = pxs(c, d);
      const deg = d.props.degree as Degree;
      return [poly(ps), ...pointLabels(ps, names.map((n) => (n ? waveLabel(deg, n) : "")), d.style.color)];
    },
  });
}

export const elliottImpulse = elliott("elliottImpulse", "Elliott impulse wave", ["", "1", "2", "3", "4", "5"]);
export const elliottCorrection = elliott("elliottCorrection", "Elliott correction wave", ["", "A", "B", "C"]);
export const elliottTriangle = elliott("elliottTriangle", "Elliott triangle wave", ["", "A", "B", "C", "D", "E"]);
export const elliottDoubleCombo = elliott("elliottDoubleCombo", "Elliott double combo wave", ["", "W", "X", "Y"]);
export const elliottTripleCombo = elliott("elliottTripleCombo", "Elliott triple combo wave", ["", "W", "X", "Y", "X", "Z"]);

export const patternTools: ToolDef[] = [
  xabcd, cypher, abcd, trianglePattern, threeDrives, headAndShoulders,
  elliottImpulse, elliottCorrection, elliottTriangle, elliottDoubleCombo, elliottTripleCombo,
];
