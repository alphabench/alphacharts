// Pure-JS kernels: always present, the fallback when WebAssembly (or its SIMD)
// is unavailable, and the oracle the wasm kernels are tested against bit for
// bit. Each function mirrors rust/src/lib.rs line by line, including the order
// of floating-point operations; when you change one, change the other.
//
// Memory: plain typed arrays, no shared state; every call allocates its outputs.

import {
  assertDense,
  checkAlpha,
  checkLod,
  checkPeriod,
  checkProfile,
  checkSameLength,
  type KernelOptions,
  type Kernels,
  type LinReg,
  type LodLevel,
  type SplitProfile,
  type SumState,
} from "./kernels.js";

const NaN_ = Number.NaN;

function filled(n: number): Float64Array {
  return new Float64Array(n).fill(NaN_);
}

function sumInto(x: Float64Array, p: number, out: Float64Array, state: Float64Array | undefined): void {
  const n = x.length;
  let t = 0;
  for (let i = 0; i < n; i++) {
    let r = t + x[i]!;
    if (i + 1 > p) r -= x[i - p]!;
    t = r;
    if (state) state[i] = r;
    // p === 1 returns x itself: t + x - x' would otherwise leak rounding into a window of one.
    out[i] = p === 1 ? x[i]! : i + 1 >= p ? r : NaN_;
  }
}

/** Mean-centred two-pass variance per window (see rust k_variance). */
function variance(x: Float64Array, p: number, root: boolean): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN_);
  let t = 0;
  for (let i = 0; i < n; i++) {
    let r = t + x[i]!;
    if (i + 1 > p) r -= x[i - p]!;
    t = r;
    if (i + 1 < p) continue;
    const mean = p === 1 ? x[i]! / p : r / p;
    let s = 0;
    for (let j = i + 1 - p; j <= i; j++) {
      const d = x[j]! - mean;
      s += d * d;
    }
    const v = s / p;
    out[i] = root ? Math.sqrt(v) : v;
  }
  return out;
}

/** Windows up to this length scan back from each bar in JS; longer ones use the block scan (the wasm threshold is its own, 16; results are exact either way). */
export const BRUTE_MAX = 10;

/**
 * Scan each window newest to oldest; the first of equal values (the newest)
 * stays. Four specialised loops: V8 keeps each monomorphic and unboxed, which a
 * single loop choosing `bars ? at : best` per bar does not.
 */
function extremeBrute(x: Float64Array, p: number, isMax: boolean, bars: boolean): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN_);
  if (!bars) {
    if (isMax) {
      for (let i = p - 1; i < n; i++) {
        let best = x[i]!;
        for (let j = i - 1; j > i - p; j--) if (x[j]! > best) best = x[j]!;
        out[i] = best;
      }
    } else {
      for (let i = p - 1; i < n; i++) {
        let best = x[i]!;
        for (let j = i - 1; j > i - p; j--) if (x[j]! < best) best = x[j]!;
        out[i] = best;
      }
    }
  } else if (isMax) {
    for (let i = p - 1; i < n; i++) {
      let best = x[i]!, at = i;
      for (let j = i - 1; j > i - p; j--) if (x[j]! > best) { best = x[j]!; at = j; }
      out[i] = i - at;
    }
  } else {
    for (let i = p - 1; i < n; i++) {
      let best = x[i]!, at = i;
      for (let j = i - 1; j > i - p; j--) if (x[j]! < best) { best = x[j]!; at = j; }
      out[i] = i - at;
    }
  }
  return out;
}

/**
 * van Herk / Gil-Werman: a window is a suffix of one block of p plus a prefix of
 * the next; pre/suf hold the index of the extreme. Equal values: the newer index
 * wins (>= forward, strict > backward), which is the engine's tie rule.
 */
function extremeBlock(x: Float64Array, p: number, isMax: boolean, bars: boolean): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN_);
  if (n === 0) return out;
  const pre = new Uint32Array(n), suf = new Uint32Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) {
    if (i % p === 0) run = i;
    else {
      const v = x[i]!, b = x[run]!;
      if (isMax ? v >= b : v <= b) run = i;
    }
    pre[i] = run;
  }
  run = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    if (i === n - 1 || (i + 1) % p === 0) run = i;
    else {
      const v = x[i]!, b = x[run]!;
      if (isMax ? v > b : v < b) run = i;
    }
    suf[i] = run;
  }
  for (let i = p - 1; i < n; i++) {
    const a = pre[i]!, b = suf[i + 1 - p]!;
    const va = x[a]!, vb = x[b]!;
    const at = (isMax ? va >= vb : va <= vb) ? a : b;
    out[i] = bars ? i - at : x[at]!;
  }
  return out;
}

function extreme(x: Float64Array, p: number, isMax: boolean, bars: boolean): Float64Array {
  return p <= BRUTE_MAX ? extremeBrute(x, p, isMax, bars) : extremeBlock(x, p, isMax, bars);
}

export function createJsKernels(opts: KernelOptions = {}): Kernels {
  const dense = (x: Float64Array, name = "x"): void => {
    if (opts.checkInput) assertDense(x, name);
  };
  return {
    kind: "js",

    sum(x, p) {
      checkPeriod(p);
      dense(x);
      const out = new Float64Array(x.length);
      sumInto(x, p, out, undefined);
      return out;
    },

    sumState(x, p): SumState {
      checkPeriod(p);
      dense(x);
      const sum = new Float64Array(x.length), state = new Float64Array(x.length);
      sumInto(x, p, sum, state);
      return { sum, state };
    },

    mean(x, p) {
      checkPeriod(p);
      dense(x);
      const n = x.length;
      const out = new Float64Array(n);
      let t = 0;
      for (let i = 0; i < n; i++) {
        let r = t + x[i]!;
        if (i + 1 > p) r -= x[i - p]!;
        t = r;
        out[i] = p === 1 ? x[i]! / p : i + 1 >= p ? r / p : NaN_;
      }
      return out;
    },

    variance(x, p) {
      checkPeriod(p);
      dense(x);
      return variance(x, p, false);
    },

    stdev(x, p) {
      checkPeriod(p);
      dense(x);
      return variance(x, p, true);
    },

    smooth(x, p, alpha) {
      checkPeriod(p);
      checkAlpha(alpha);
      dense(x);
      const n = x.length;
      const out = new Float64Array(n);
      let prev = NaN_;
      for (let i = 0; i < n; i++) {
        let v: number;
        if (prev === prev) v = prev + alpha * (x[i]! - prev);
        else if (i + 1 >= p) {
          let t = 0;
          for (let j = i + 1 - p; j <= i; j++) t += x[j]!;
          v = t / p;
        } else v = NaN_;
        out[i] = v;
        prev = v;
      }
      return out;
    },

    wma(x, p) {
      checkPeriod(p);
      dense(x);
      const n = x.length;
      const out = new Float64Array(n);
      const den = (p * (p + 1)) / 2;
      let s = 0, w = 0;
      for (let i = 0; i < n; i++) {
        const x1 = x[i]!;
        const k = i + 1;
        if (k <= p) {
          s += x1;
          w += k * x1;
          out[i] = k === p ? w / den : NaN_;
        } else {
          const s0 = s;
          w = w - s0 + p * x1;
          s = s0 - x[i - p]! + x1;
          out[i] = w / den;
        }
      }
      return out;
    },

    highest(x, p) {
      checkPeriod(p);
      dense(x);
      return extreme(x, p, true, false);
    },
    lowest(x, p) {
      checkPeriod(p);
      dense(x);
      return extreme(x, p, false, false);
    },
    highestBars(x, p) {
      checkPeriod(p);
      dense(x);
      return extreme(x, p, true, true);
    },
    lowestBars(x, p) {
      checkPeriod(p);
      dense(x);
      return extreme(x, p, false, true);
    },

    linreg(x, p): LinReg {
      checkPeriod(p, 2);
      dense(x);
      const n = x.length;
      const value = filled(n), slope = filled(n), intercept = filled(n);
      const sumX = (p * (p - 1)) / 2;
      const sumXSqr = (p * (p - 1) * (2 * p - 1)) / 6;
      const div = p * sumXSqr - sumX * sumX;
      for (let i = p - 1; i < n; i++) {
        let sy = 0, sxy = 0;
        const base = i + 1 - p;
        for (let j = 0; j < p; j++) {
          const y = x[base + j]!;
          sy += y;
          sxy += j * y;
        }
        const m = (p * sxy - sumX * sy) / div;
        const bb = (sy - m * sumX) / p;
        slope[i] = m;
        intercept[i] = bb;
        value[i] = bb + m * (p - 1);
      }
      return { value, slope, intercept };
    },

    lodRows(o, h, l, c, k, first = 0, color): LodLevel {
      const n = o.length;
      checkSameLength(n, "h", h.length);
      checkSameLength(n, "l", l.length);
      checkSameLength(n, "c", c.length);
      if (color) checkSameLength(n, "color", color.length);
      checkLod(n, k, first);
      if (n === 0) {
        const e = new Float32Array(0);
        return color ? { firstBucket: 0, o: e, h: e, l: e, c: e, color: new Uint32Array(0) } : { firstBucket: 0, o: e, h: e, l: e, c: e };
      }
      const size = 2 ** k;
      const b0 = Math.floor(first / size);
      const b1 = Math.floor((first + n - 1) / size);
      const nb = b1 - b0 + 1;
      const oo = new Float32Array(nb), oh = new Float32Array(nb), ol = new Float32Array(nb), oc = new Float32Array(nb);
      const ocol = color ? new Uint32Array(nb) : undefined;
      for (let b = b0; b <= b1; b++) {
        const r0 = Math.max(b * size - first, 0);
        const r1 = Math.min((b + 1) * size - first, n);
        let ro = NaN_, rh = Number.NEGATIVE_INFINITY, rl = Number.POSITIVE_INFINITY, rc = NaN_, col = 0;
        for (let r = r0; r < r1; r++) {
          const vo = o[r]!;
          if (vo !== vo) continue; // hole
          if (ro !== ro) ro = vo;
          const vh = h[r]!;
          if (vh > rh) {
            rh = vh;
            if (color) col = color[r]!;
          }
          const vl = l[r]!;
          if (vl < rl) rl = vl;
          rc = c[r]!;
        }
        const slot = b - b0;
        const empty = ro !== ro;
        oo[slot] = ro;
        oh[slot] = empty ? NaN_ : rh;
        ol[slot] = empty ? NaN_ : rl;
        oc[slot] = rc;
        if (ocol) ocol[slot] = col;
      }
      return ocol ? { firstBucket: b0, o: oo, h: oh, l: ol, c: oc, color: ocol } : { firstBucket: b0, o: oo, h: oh, l: ol, c: oc };
    },

    volumeProfile(price, volume, lo, hi, bins) {
      checkSameLength(price.length, "volume", volume.length);
      const scale = checkProfile(lo, hi, bins);
      const up = new Float64Array(bins);
      for (let i = 0; i < price.length; i++) {
        const p = price[i]!;
        if (p >= lo && p <= hi) {
          let b = ((p - lo) * scale) | 0;
          if (b >= bins) b = bins - 1;
          up[b]! += volume[i]!;
        }
      }
      return up;
    },

    volumeProfileSplit(price, volume, side, lo, hi, bins): SplitProfile {
      checkSameLength(price.length, "volume", volume.length);
      checkSameLength(price.length, "side", side.length);
      const scale = checkProfile(lo, hi, bins);
      const up = new Float64Array(bins), down = new Float64Array(bins);
      for (let i = 0; i < price.length; i++) {
        const p = price[i]!;
        if (p >= lo && p <= hi) {
          let b = ((p - lo) * scale) | 0;
          if (b >= bins) b = bins - 1;
          if (side[i] !== 0) up[b]! += volume[i]!;
          else down[b]! += volume[i]!;
        }
      }
      return { up, down };
    },
  };
}

/** The default pure-JS kernels (no input scan). */
export const jsKernels: Kernels = createJsKernels();
