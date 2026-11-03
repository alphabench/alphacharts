// Squarified treemap (Bruls, Huizing, van Wijk) with nested groups.

import type { TreeNode } from "./spec.js";

export interface Tile {
  node: TreeNode;
  depth: number;
  /** Names from the root's child down to this node. */
  path: readonly string[];
  /** Sum of the leaves below (or the leaf's own value). */
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rectangle available to the children (inside the gap and header). */
  inner: { x: number; y: number; w: number; h: number };
  children: Tile[];
}

export interface TreemapOptions {
  gap: number;
  header: number;
}

/** Total value of a node: its own value for a leaf, the sum of its children otherwise. */
export function nodeValue(n: TreeNode): number {
  if (n.children && n.children.length > 0) {
    let s = 0;
    for (const c of n.children) s += nodeValue(c);
    return s;
  }
  const v = n.value ?? 0;
  if (!(v >= 0) || !Number.isFinite(v)) throw new RangeError(`treemap: "${n.name}" has value ${v}; sizes must be finite and not negative`);
  return v;
}

/** Lay out `root` in a w x h rectangle. Nodes of zero size get no tile. */
export function treemap(root: TreeNode, w: number, h: number, opts: TreemapOptions): Tile {
  const rootTile = place(root, 0, [], 0, 0, w, h, opts);
  return rootTile;
}

function place(node: TreeNode, depth: number, path: readonly string[], x: number, y: number, w: number, h: number, o: TreemapOptions): Tile {
  const value = nodeValue(node);
  const kids = (node.children ?? []).filter((c) => nodeValue(c) > 0);
  const isGroup = node.children !== undefined && node.children.length > 0;
  // The root has no title strip or inset: it is the plot area itself.
  const pad = depth === 0 ? 0 : o.gap;
  const head = isGroup && depth > 0 ? o.header : 0;
  const inner = { x: x + pad, y: y + pad + head, w: Math.max(0, w - 2 * pad), h: Math.max(0, h - 2 * pad - head) };
  const tile: Tile = { node, depth, path, value, x, y, w, h, inner, children: [] };
  if (kids.length === 0 || inner.w <= 0 || inner.h <= 0) return tile;
  const sorted = [...kids].sort((a, b) => nodeValue(b) - nodeValue(a));
  const total = sorted.reduce((s, c) => s + nodeValue(c), 0);
  const area = inner.w * inner.h;
  const rects = squarify(sorted.map((c) => (nodeValue(c) / total) * area), inner.x, inner.y, inner.w, inner.h);
  sorted.forEach((c, i) => {
    const r = rects[i]!;
    tile.children.push(place(c, depth + 1, depth === 0 ? [c.name] : [...path, c.name], r.x, r.y, r.w, r.h, o));
  });
  return tile;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangles with the given areas (descending) tiling the rectangle, aspect ratios kept near 1. */
export function squarify(areas: readonly number[], x: number, y: number, w: number, h: number): Rect[] {
  const out: Rect[] = [];
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    let j = i + 1;
    let sum = areas[i]!;
    let worstNow = worst(areas, i, j, sum, side);
    while (j < areas.length) {
      const next = sum + areas[j]!;
      const w2 = worst(areas, i, j + 1, next, side);
      if (w2 > worstNow) break;
      sum = next;
      worstNow = w2;
      j++;
    }
    // Lay areas[i..j) along the short side as one strip.
    if (w >= h) {
      const sw = sum / h;
      let yy = y;
      for (let k = i; k < j; k++) {
        const hh = areas[k]! / sw;
        out.push({ x, y: yy, w: sw, h: hh });
        yy += hh;
      }
      x += sw;
      w -= sw;
    } else {
      const sh = sum / w;
      let xx = x;
      for (let k = i; k < j; k++) {
        const ww = areas[k]! / sh;
        out.push({ x: xx, y, w: ww, h: sh });
        xx += ww;
      }
      y += sh;
      h -= sh;
    }
    i = j;
  }
  return out;
}

function worst(areas: readonly number[], from: number, to: number, sum: number, side: number): number {
  const max = areas[from]!, min = areas[to - 1]!;
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Every tile below `t` that has no children (the leaves), in layout order. */
export function leaves(t: Tile, out: Tile[] = []): Tile[] {
  if (t.children.length === 0) {
    if (t.depth > 0) out.push(t);
  } else for (const c of t.children) leaves(c, out);
  return out;
}
