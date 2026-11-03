// The GPU-side copy of one series: a window of units around the visible range
// at one level of detail, not the whole series.
//
// A unit is a timeline index at level 0, or an LOD bucket above it. Each unit
// is one record [x, o, h, l, c, color], with x and prices relative to the
// window's `base` index and `priceBase` (Float64 subtraction, then Float32;
// log10 first on a log price scale),
// so a deep zoom near a large price keeps sub-pixel precision. Holes are
// records (x = HOLE_X); shaders collapse them.
//
// The window spans the visible units plus one screen on each side. Panning
// inside it changes only uniforms. Leaving it, or changing level, re-uploads
// (a few thousand to ~100k records). A live tick rewrites its one record with
// bufferSubData.
//
// Why a window rather than whole-series buffers: 10M bars × 24 B is 240 MB of
// GPU memory per series before any LOD level, for data that is never on
// screen at that level.

import { LOD_BASE, LOD_C, LOD_COLOR, LOD_H, LOD_L, LOD_O } from "../data/lod.js";
import type { DataChange, SeriesData } from "../data/model.js";
import { COL_C, COL_COLOR, COL_H, COL_L, COL_O, COL_V } from "../data/model.js";

export const RECORD_FLOATS = 6;
/**
 * x of a hole. GLSL ES isnan() is not reliable across drivers, so shaders
 * test `x < HOLE_TEST` instead of reading NaN prices.
 */
export const HOLE_X = -1e9;
export const HOLE_TEST = "-1e8";
export const RECORD_BYTES = RECORD_FLOATS * 4;

/** Below this many bars per device px, raw rows are drawn (overlap does the aggregation). */
const RAW_MAX_BARS_PER_PX = 8;

export function chooseLevel(data: SeriesData, spacingDev: number): number {
  const perPx = 1 / spacingDev;
  if (perPx <= RAW_MAX_BARS_PER_PX || data.lod.levels.length === 0) return 0;
  return Math.min(data.lod.topLevel, Math.max(LOD_BASE, Math.floor(Math.log2(perPx))));
}

export class InstanceWindow {
  readonly buffer: WebGLBuffer;
  level = -1;
  /** Units [lo, hi] are uploaded. */
  lo = 0;
  hi = -1;
  /** Index coordinate where x_rel = 0, and price where p_rel = 0. */
  base = 0;
  priceBase = 0;
  private f32 = new Float32Array(0);
  private u32 = new Uint32Array(0);
  private stale = true;
  private dirtyLo = Number.POSITIVE_INFINITY;
  private dirtyHi = Number.NEGATIVE_INFINITY;
  /** Records actually uploaded (fewer than units when compacted). */
  private uploaded = 0;
  /** Upload log10 of every price (log price scale). */
  private log = false;

  /**
   * `compact`: drop holes from the upload, so a pair renderer (line, area)
   * joins each present point to the next present one. A series whose times
   * are a subset of the shared timeline (another instrument's holidays, a
   * daily level on an intraday chart) has holes that are absence, not breaks.
   */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly data: SeriesData,
    private readonly zeroBase: boolean,
    private readonly compact = false,
  ) {
    this.buffer = gl.createBuffer();
  }

  get count(): number {
    return this.uploaded;
  }

  private get units(): number {
    return this.hi >= this.lo ? this.hi - this.lo + 1 : 0;
  }

  dataChanged(c: DataChange): void {
    if (c.kind === "replace" || c.reindexed) {
      this.stale = true;
      return;
    }
    if (this.level < 0) return;
    const k = this.level;
    const u0 = Math.max(this.lo, c.lo >> k);
    const u1 = Math.min(this.hi, (c.hi - 1) >> k);
    if (u0 > u1) return; // outside the window: picked up when the view gets there
    this.dirtyLo = Math.min(this.dirtyLo, u0);
    this.dirtyHi = Math.max(this.dirtyHi, u1);
  }

  /** Make the visible index range [visLo, visHi] drawable at `level`. Binds the buffer. */
  ensure(level: number, visLo: number, visHi: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const st = this.data.store;
    if (st.length === 0 || visHi < visLo) {
      this.hi = this.lo - 1;
      this.uploaded = 0;
      return;
    }
    const ua = visLo >> level;
    const ub = visHi >> level;
    // A compacted window with holes has no unit-to-record mapping to patch.
    const patchable = this.uploaded === this.units;
    if (!this.stale && level === this.level && ua >= this.lo && ub <= this.hi && (patchable || this.dirtyLo > this.dirtyHi)) {
      if (this.dirtyLo <= this.dirtyHi) {
        this.fill(this.dirtyLo, this.dirtyHi);
        const off = (this.dirtyLo - this.lo) * RECORD_FLOATS;
        const len = (this.dirtyHi - this.dirtyLo + 1) * RECORD_FLOATS;
        gl.bufferSubData(gl.ARRAY_BUFFER, off * 4, this.f32, off, len);
      }
      this.dirtyLo = Number.POSITIVE_INFINITY;
      this.dirtyHi = Number.NEGATIVE_INFINITY;
      return;
    }
    const firstUnit = st.first >> level;
    const lastUnit = (st.end - 1) >> level;
    const span = ub - ua + 1;
    this.level = level;
    this.lo = Math.max(firstUnit, ua - span);
    this.hi = Math.min(lastUnit, ub + span);
    this.base = this.lo << level;
    this.priceBase = this.zeroBase ? 0 : this.pickBase();
    let n = this.units;
    if (this.f32.length < n * RECORD_FLOATS) {
      const ab = new ArrayBuffer(Math.ceil(n * 1.5) * RECORD_BYTES);
      this.f32 = new Float32Array(ab);
      this.u32 = new Uint32Array(ab);
    }
    if (n > 0) this.fill(this.lo, this.hi);
    if (this.compact) n = this.squeeze(n);
    this.uploaded = n;
    gl.bufferData(gl.ARRAY_BUFFER, this.f32.subarray(0, n * RECORD_FLOATS), gl.DYNAMIC_DRAW);
    this.stale = false;
    this.dirtyLo = Number.POSITIVE_INFINITY;
    this.dirtyHi = Number.NEGATIVE_INFINITY;
  }

  /** Move present records to the front, in order. Returns how many there are. */
  private squeeze(n: number): number {
    const f = this.f32, u = this.u32;
    let w = 0;
    for (let r = 0; r < n; r++) {
      const src = r * RECORD_FLOATS;
      if (f[src]! === HOLE_X) continue;
      if (w !== r) {
        const dst = w * RECORD_FLOATS;
        for (let j = 0; j < RECORD_FLOATS - 1; j++) f[dst + j] = f[src + j]!;
        u[dst + RECORD_FLOATS - 1] = u[src + RECORD_FLOATS - 1]!;
      }
      w++;
    }
    return w;
  }

  /** Switch between price and log10(price) coordinates; re-uploads on change. */
  setLog(log: boolean): void {
    if (log !== this.log) {
      this.log = log;
      this.stale = true;
    }
  }

  /** Force a full upload on the next ensure() (context restored, options changed). */
  invalidate(): void {
    this.stale = true;
  }

  dispose(): void {
    this.gl.deleteBuffer(this.buffer);
  }

  private pickBase(): number {
    const d = this.data;
    const mid = ((this.lo + this.hi) >> 1) << this.level;
    const col = d.shape === "ohlc" ? COL_C : COL_V;
    const i = d.indexAtOrBefore(Math.min(mid, d.store.end - 1)) ?? d.firstIndex();
    const v = i === undefined ? 0 : d.get(i, col);
    const c = this.log ? Math.log10(v) : v;
    return Number.isFinite(c) ? c : 0;
  }

  private fill(u0: number, u1: number): void {
    const f = this.f32, u = this.u32, pb = this.priceBase, k = this.level, d = this.data, log = this.log;
    if (k === 0) {
      const st = d.store;
      const ohlc = d.shape === "ohlc";
      const O = st.cols[ohlc ? COL_O : COL_V]!, H = st.cols[ohlc ? COL_H : COL_V]!, L = st.cols[ohlc ? COL_L : COL_V]!, C = st.cols[ohlc ? COL_C : COL_V]!;
      const COL = ohlc ? undefined : st.cols[COL_COLOR]!;
      for (let i = u0; i <= u1; i++) {
        const r = (i - this.lo) * RECORD_FLOATS;
        const p = st.head + (i - st.first);
        let o = i >= st.first && i < st.end ? O[p]! : Number.NaN;
        let h = H[p]!, l = L[p]!, c = C[p]!;
        if (log) {
          o = lg(o);
          h = lg(h);
          l = lg(l);
          c = lg(c);
        }
        if (o !== o || h !== h || l !== l || c !== c) {
          hole(f, u, r);
          continue;
        }
        f[r] = i - this.base;
        f[r + 1] = o - pb;
        f[r + 2] = h - pb;
        f[r + 3] = l - pb;
        f[r + 4] = c - pb;
        u[r + 5] = COL ? COL[p]! : 0;
      }
      return;
    }
    const lv = d.lod.level(k)!;
    const O = lv.cols[LOD_O]!, H = lv.cols[LOD_H]!, L = lv.cols[LOD_L]!, C = lv.cols[LOD_C]!, COL = lv.cols[LOD_COLOR];
    const half = ((1 << k) - 1) / 2;
    for (let b = u0; b <= u1; b++) {
      const r = (b - this.lo) * RECORD_FLOATS;
      const p = lv.head + (b - lv.first);
      let o = lv.has(b) ? O[p]! : Number.NaN;
      let h = H[p]!, l = L[p]!, c = C[p]!;
      if (log) {
        o = lg(o);
        h = lg(h);
        l = lg(l);
        c = lg(c);
      }
      if (o !== o || h !== h || l !== l || c !== c) {
        hole(f, u, r);
        continue;
      }
      f[r] = (b << k) + half - this.base;
      f[r + 1] = o - pb;
      f[r + 2] = h - pb;
      f[r + 3] = l - pb;
      f[r + 4] = c - pb;
      u[r + 5] = COL ? COL[p]! : 0;
    }
  }
}

function hole(f: Float32Array, u: Uint32Array, r: number): void {
  f[r] = HOLE_X;
  f[r + 1] = f[r + 2] = f[r + 3] = f[r + 4] = 0;
  u[r + 5] = 0;
}

/** log10 for a log scale; a non-positive price has no position (a hole). */
function lg(v: number): number {
  return v > 0 ? Math.log10(v) : Number.NaN;
}
