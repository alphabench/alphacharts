// Level-of-detail pyramid over one series.
//
// Level k aggregates buckets of 2^k consecutive timeline indices, aligned to
// absolute index (bucket b covers [b·2^k, (b+1)·2^k)), so prepending history
// only adds buckets at the front and never re-aligns existing ones. A bucket
// holds open-first, high-max, low-min and close-last of the rows it covers
// (holes are NaN and skipped), plus the colour of the row that made the high.
//
// Levels start at LOD_BASE (8-row buckets). Below that the renderer draws raw
// rows: at ≤ 8 rows per device pixel overlapping marks already produce the
// per-pixel min/max a bucket would, and skipping levels 1–2 saves 3/4 of the
// pyramid's memory. Levels are Float32: they feed pixels and autoscale, never
// a displayed value (readouts always come from the Float64 rows).
//
// minMax(a, b) answers the high/low over any index range in O(log n), which is
// what lets autoscale follow a pan over 10M bars every frame.

import { ColumnDeque, F32_NAN, U32_ZERO } from "./deque.js";

export const LOD_BASE = 3;

/** Which source columns hold open/high/low/close (equal for single-value series). */
export interface LodSource {
  readonly store: ColumnDeque;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  /** Column of a packed RGBA colour per row, if the series has one. */
  readonly color?: number;
}

export const LOD_O = 0;
export const LOD_H = 1;
export const LOD_L = 2;
export const LOD_C = 3;
export const LOD_COLOR = 4;

export class Lod {
  /** levels[i] is level LOD_BASE + i, indexed by bucket number. */
  readonly levels: ColumnDeque[] = [];

  constructor(private readonly src: LodSource) {}

  get topLevel(): number {
    return LOD_BASE + this.levels.length - 1;
  }

  level(k: number): ColumnDeque | undefined {
    return this.levels[k - LOD_BASE];
  }

  rebuild(): void {
    this.levels.length = 0;
    const s = this.src.store;
    if (s.length > 0) this.update(s.first, s.end);
  }

  /** Recompute every bucket that covers source rows [lo, hi). */
  update(lo: number, hi: number): void {
    const s = this.src.store;
    if (s.length === 0) {
      this.levels.length = 0;
      return;
    }
    lo = Math.max(lo, s.first);
    hi = Math.min(hi, s.end);
    if (hi <= lo) return;
    const last = s.end - 1;
    for (let k = LOD_BASE; ; k++) {
      let level = this.levels[k - LOD_BASE];
      const bFirst = s.first >> k;
      const bLast = last >> k;
      let a = lo >> k;
      let b = (hi - 1) >> k;
      if (!level) {
        level = new ColumnDeque(this.src.color === undefined ? [F32_NAN, F32_NAN, F32_NAN, F32_NAN] : [F32_NAN, F32_NAN, F32_NAN, F32_NAN, U32_ZERO]);
        this.levels.push(level);
        // A new level has no buckets yet: fill all of them.
        a = bFirst;
        b = bLast;
      }
      level.cover(bFirst, bLast + 1);
      for (let bucket = a; bucket <= b; bucket++) {
        if (k === LOD_BASE) this.fromRows(level, bucket, k);
        else this.fromChildren(level, this.levels[k - 1 - LOD_BASE]!, bucket);
      }
      if (bLast - bFirst <= 1) {
        // At most two buckets: minMax reads the top level whole, so anything
        // above is redundant. (Ranges straddling index 0 never reach one
        // bucket: -1 >> k stays -1.)
        this.levels.length = k - LOD_BASE + 1;
        return;
      }
    }
  }

  /**
   * High and low over source rows [a, b] (inclusive). Writes [low, high] to
   * `out`; both are NaN when the range holds no rows.
   */
  minMax(a: number, b: number, out: Float64Array): Float64Array {
    const s = this.src.store;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let A = Math.max(a, s.first);
    let B = Math.min(b, s.end - 1) + 1; // exclusive
    const H = s.cols[this.src.h]!;
    const L = s.cols[this.src.l]!;
    const off = s.head - s.first;
    const step = 1 << LOD_BASE;
    // Raw rows up to the first and from the last 8-aligned boundary.
    while (A < B && (A & (step - 1)) !== 0) {
      const h = H[off + A]!, l = L[off + A]!;
      if (h > hi) hi = h;
      if (l < lo) lo = l;
      A++;
    }
    while (A < B && (B & (step - 1)) !== 0) {
      B--;
      const h = H[off + B]!, l = L[off + B]!;
      if (h > hi) hi = h;
      if (l < lo) lo = l;
    }
    if (A < B && this.levels.length > 0) {
      A >>= LOD_BASE;
      B >>= LOD_BASE;
      for (let i = 0; A < B; i++) {
        const lv = this.levels[i]!;
        const LH = lv.cols[LOD_H]!, LL = lv.cols[LOD_L]!;
        const lo2 = lv.head - lv.first;
        const top = i === this.levels.length - 1;
        // Peel unaligned ends at this level, then climb.
        while (A < B && (top || (A & 1) !== 0)) {
          const h = LH[lo2 + A]!, l = LL[lo2 + A]!;
          if (h > hi) hi = h;
          if (l < lo) lo = l;
          A++;
        }
        while (A < B && (B & 1) !== 0) {
          B--;
          const h = LH[lo2 + B]!, l = LL[lo2 + B]!;
          if (h > hi) hi = h;
          if (l < lo) lo = l;
        }
        A >>= 1;
        B >>= 1;
      }
    } else {
      for (; A < B; A++) {
        const h = H[off + A]!, l = L[off + A]!;
        if (h > hi) hi = h;
        if (l < lo) lo = l;
      }
    }
    out[0] = lo === Number.POSITIVE_INFINITY ? Number.NaN : lo;
    out[1] = hi === Number.NEGATIVE_INFINITY ? Number.NaN : hi;
    return out;
  }

  private fromRows(level: ColumnDeque, bucket: number, k: number): void {
    const s = this.src.store;
    const O = s.cols[this.src.o]!, H = s.cols[this.src.h]!, L = s.cols[this.src.l]!, C = s.cols[this.src.c]!;
    const COL = this.src.color === undefined ? undefined : s.cols[this.src.color]!;
    const off = s.head - s.first;
    const r0 = Math.max(bucket << k, s.first);
    const r1 = Math.min((bucket + 1) << k, s.end);
    let o = Number.NaN, h = Number.NEGATIVE_INFINITY, l = Number.POSITIVE_INFINITY, c = Number.NaN, color = 0;
    for (let r = r0; r < r1; r++) {
      const p = off + r;
      const ro = O[p]!;
      if (ro !== ro) continue; // hole
      if (o !== o) o = ro;
      const rh = H[p]!;
      if (rh > h) {
        h = rh;
        if (COL) color = COL[p]!;
      }
      const rl = L[p]!;
      if (rl < l) l = rl;
      c = C[p]!;
    }
    write(level, bucket, o, h, l, c, color);
  }

  private fromChildren(level: ColumnDeque, child: ColumnDeque, bucket: number): void {
    let o = Number.NaN, h = Number.NEGATIVE_INFINITY, l = Number.POSITIVE_INFINITY, c = Number.NaN, color = 0;
    const CO = child.cols[LOD_O]!, CH = child.cols[LOD_H]!, CL = child.cols[LOD_L]!, CC = child.cols[LOD_C]!;
    const CCOL = child.cols[LOD_COLOR];
    for (let cb = bucket << 1; cb <= (bucket << 1) + 1; cb++) {
      if (!child.has(cb)) continue;
      const p = child.pos(cb);
      const co = CO[p]!;
      if (co !== co) continue;
      if (o !== o) o = co;
      const ch = CH[p]!;
      if (ch > h) {
        h = ch;
        if (CCOL) color = CCOL[p]!;
      }
      const cl = CL[p]!;
      if (cl < l) l = cl;
      c = CC[p]!;
    }
    write(level, bucket, o, h, l, c, color);
  }
}

function write(level: ColumnDeque, bucket: number, o: number, h: number, l: number, c: number, color: number): void {
  const p = level.pos(bucket);
  const empty = o !== o;
  level.cols[LOD_O]![p] = o;
  level.cols[LOD_H]![p] = empty ? Number.NaN : h;
  level.cols[LOD_L]![p] = empty ? Number.NaN : l;
  level.cols[LOD_C]![p] = c;
  const COL = level.cols[LOD_COLOR];
  if (COL) COL[p] = color;
}
