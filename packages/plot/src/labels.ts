// Label placement for text marks: pure geometry, no canvas. Each label, in
// priority order, tries positions just outside its own point and takes the
// first whose box is inside the area and clear of what is already there.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}
export interface Anchor {
  x: number;
  y: number;
  /** Radius in px of the point the label belongs to. */
  r: number;
}

/** px between a label and its own point, and the least clear space kept around another label or point. */
export const LABEL_GAP = 2;
const CLEAR = 1;

/** Boxes that overlap, or sit closer than `gap`. */
export function boxesTouch(a: Box, b: Box, gap = CLEAR): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/** A box and a circle that overlap, or sit closer than `gap`. */
export function boxHitsCircle(b: Box, c: Circle, gap = CLEAR): boolean {
  const nx = Math.max(b.x, Math.min(c.x, b.x + b.w));
  const ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
  const r = c.r + gap;
  return (nx - c.x) ** 2 + (ny - c.y) ** 2 < r * r;
}

const inside = (b: Box, a: Box): boolean => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

/** The eight candidate boxes around an anchor, in the order they are tried: top, bottom, right, left, then the diagonals. */
export function candidates(a: Anchor, w: number, h: number, gap = LABEL_GAP): Box[] {
  const d = a.r + gap;
  const q = d * Math.SQRT1_2;
  const at = (x: number, y: number): Box => ({ x: Math.round(x), y: Math.round(y), w, h });
  return [
    at(a.x - w / 2, a.y - d - h),
    at(a.x - w / 2, a.y + d),
    at(a.x + d, a.y - h / 2),
    at(a.x - d - w, a.y - h / 2),
    at(a.x + q, a.y - q - h),
    at(a.x - q - w, a.y - q - h),
    at(a.x + q, a.y + q),
    at(a.x - q - w, a.y + q),
  ];
}

export interface PlaceInput {
  anchors: readonly Anchor[];
  sizes: readonly { w: number; h: number }[];
  area: Box;
  /** Points a label must stay off. Empty when marks are not avoided. */
  circles: readonly Circle[];
  /** Boxes already taken (by other text marks); placed boxes are pushed here. */
  placed: Box[];
  /** Label indices tried first, in this order; the rest follow in index order. */
  order?: readonly number[];
}

/** Box per label, or null for one that has no free position (or no position at all). Deterministic. */
export function placeLabels(inp: PlaceInput): (Box | null)[] {
  const n = inp.anchors.length;
  const out: (Box | null)[] = new Array<Box | null>(n).fill(null);
  const first = inp.order ?? [];
  const seq = [...first, ...Array.from({ length: n }, (_, i) => i).filter((i) => !first.includes(i))];
  for (const i of seq) {
    const a = inp.anchors[i]!;
    const s = inp.sizes[i]!;
    if (a.x !== a.x || a.y !== a.y) continue;
    // Every point counts, the label's own included: its radius only widens the ring the label sits outside of, so a bigger
    // point at the same spot (an equal peer, a marker) pushes the label out rather than being ignored.
    let r = a.r;
    for (const c of inp.circles) if (Math.abs(c.x - a.x) < 0.5 && Math.abs(c.y - a.y) < 0.5 && c.r > r) r = c.r;
    for (const b of candidates({ x: a.x, y: a.y, r }, Math.round(s.w), Math.round(s.h))) {
      if (!inside(b, inp.area)) continue;
      if (inp.placed.some((o) => boxesTouch(b, o))) continue;
      if (inp.circles.some((c) => boxHitsCircle(b, c))) continue;
      out[i] = b;
      inp.placed.push(b);
      break;
    }
  }
  return out;
}
