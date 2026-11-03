// Shared plumbing for the Canvas2D renderers in this package: the same unit
// iteration the WebGL window performs (raw rows, or LOD buckets above level
// 0), in device px, and the same integer snapping.

import { COL_C, COL_COLOR, COL_H, COL_L, COL_O, COL_V, LOD_C, LOD_COLOR, LOD_H, LOD_L, LOD_O, type DrawView2D, type SeriesRenderer2D } from "@alphacharts/core";
import { chooseLevel } from "@alphacharts/core/internal";

export const snap = (y: number): number => Math.floor(y + 0.5);

export function levelOf(v: DrawView2D): number {
  return chooseLevel(v.data, v.time.spacing * v.dpr);
}

/** Device-px y of a price. */
export const Y = (v: DrawView2D, p: number): number => v.price.y(p) * v.dpr;

export type UnitFn = (x: number, o: number, h: number, l: number, c: number, color: number) => void;

/** Visit present units over the view at `level`, x in device px. Holes are skipped (compacted). */
export function eachUnit(v: DrawView2D, level: number, fn: UnitFn): void {
  const d = v.data, dpr = v.dpr, t = v.time;
  if (level === 0) {
    const st = d.store;
    const ohlc = d.shape === "ohlc";
    const O = st.cols[ohlc ? COL_O : COL_V]!, H = st.cols[ohlc ? COL_H : COL_V]!, L = st.cols[ohlc ? COL_L : COL_V]!, C = st.cols[ohlc ? COL_C : COL_V]!;
    const COL = ohlc ? undefined : st.cols[COL_COLOR];
    const a = Math.max(v.lo - 1, st.first), b = Math.min(v.hi + 1, st.end - 1);
    for (let i = a; i <= b; i++) {
      const p = st.head + (i - st.first);
      const o = O[p]!;
      if (o !== o) continue;
      fn(t.x(i) * dpr, o, H[p]!, L[p]!, C[p]!, COL ? COL[p]! : 0);
    }
    return;
  }
  const lv = d.lod.level(level);
  if (!lv) return;
  const O = lv.cols[LOD_O]!, H = lv.cols[LOD_H]!, L = lv.cols[LOD_L]!, C = lv.cols[LOD_C]!, COL = lv.cols[LOD_COLOR];
  const half = ((1 << level) - 1) / 2;
  const a = Math.max((v.lo >> level) - 1, lv.first), b = Math.min((v.hi >> level) + 1, lv.end - 1);
  for (let k = a; k <= b; k++) {
    const p = lv.head + (k - lv.first);
    const o = O[p]!;
    if (o !== o) continue;
    fn(t.x((k << level) + half) * dpr, o, H[p]!, L[p]!, C[p]!, COL ? COL[p]! : 0);
  }
}

export abstract class Base2D<O> implements SeriesRenderer2D<O> {
  abstract draw(view: DrawView2D, options: O): void;
  dataChanged(): void {}
  dispose(): void {}
}

/** Anti-aliased stroke settings shared by the line-like marks. */
export function strokeStyle(v: DrawView2D, color: string, widthCss: number): void {
  const ctx = v.ctx;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, widthCss * v.dpr);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}
