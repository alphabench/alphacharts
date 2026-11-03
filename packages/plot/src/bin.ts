// Histogram binning.

import type { Num } from "./spec.js";

export interface Bin {
  x0: number;
  x1: number;
  count: number;
  /** count / (n * width): the bars' areas sum to 1. */
  density: number;
}

export type BinRule = number | "fd" | "sturges" | readonly number[];

const MAX_BINS = 400;

function quantile(sorted: Float64Array, p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** The 1-2-2.5-5 x 10^k width nearest (in ratio) to `raw`. */
function nearestNice(raw: number): number {
  const e = Math.floor(Math.log10(raw));
  let best = raw, err = Infinity;
  for (const k of [e - 1, e, e + 1]) {
    for (const f of [1, 2, 2.5, 5, 10]) {
      const c = f * 10 ** k;
      const d = Math.abs(Math.log(c / raw));
      if (d < err) [best, err] = [c, d];
    }
  }
  return best;
}

/** Freedman-Diaconis width 2 * IQR * n^(-1/3); undefined when the IQR is 0. */
export function freedmanDiaconisWidth(sorted: Float64Array): number | undefined {
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const w = 2 * iqr * sorted.length ** (-1 / 3);
  return w > 0 ? w : undefined;
}

/**
 * Bin `values` (NaN and infinities are skipped). An array rule gives the edges;
 * a number gives that many equal bins over the extent; "fd" and "sturges" pick
 * a width and align the edges to multiples of it, so they read as round numbers.
 * The last bin includes its upper edge.
 */
export function histogram(values: Num, rule: BinRule = "fd", extent?: readonly [number, number]): Bin[] {
  const clean: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) clean.push(v);
  }
  const n = clean.length;
  if (n === 0) return [];
  const sorted = Float64Array.from(clean).sort();
  const lo = extent?.[0] ?? sorted[0]!;
  let hi = extent?.[1] ?? sorted[n - 1]!;
  if (!(hi >= lo)) throw new RangeError(`histogram extent [${lo}, ${hi}] is not ordered`);

  let edges: number[];
  if (typeof rule !== "string" && typeof rule !== "number") {
    if (rule.length < 2) throw new RangeError("histogram edges need at least two values");
    for (let i = 1; i < rule.length; i++) if (!(rule[i]! > rule[i - 1]!)) throw new RangeError("histogram edges must increase");
    edges = [...rule];
  } else {
    if (hi === lo) hi = lo + 1;
    if (typeof rule === "number") {
      if (!Number.isInteger(rule) || rule < 1 || rule > MAX_BINS) throw new RangeError(`histogram bins must be an integer in 1..${MAX_BINS}, got ${rule}`);
      edges = Array.from({ length: rule + 1 }, (_, i) => lo + ((hi - lo) * i) / rule);
    } else {
      const raw = rule === "fd" ? (freedmanDiaconisWidth(sorted) ?? (hi - lo) / (Math.ceil(Math.log2(n)) + 1)) : (hi - lo) / (Math.ceil(Math.log2(n)) + 1);
      const w = nearestNice(Math.max(raw, (hi - lo) / MAX_BINS));
      const first = Math.floor(lo / w + 1e-9), last = Math.ceil(hi / w - 1e-9);
      const d = Math.max(0, -Math.floor(Math.log10(w)) + 2);
      edges = [];
      for (let k = first; k <= Math.max(last, first + 1); k++) edges.push(+(k * w).toFixed(Math.min(d, 15)));
    }
  }

  const bins: Bin[] = [];
  for (let i = 0; i + 1 < edges.length; i++) bins.push({ x0: edges[i]!, x1: edges[i + 1]!, count: 0, density: 0 });
  const last = bins.length - 1;
  let total = 0;
  for (const v of sorted) {
    if (v < edges[0]! || v > edges[last + 1]!) continue;
    // Binary search for the bin with x0 <= v < x1 (the last bin closes on its right edge).
    let a = 0, b = last;
    while (a < b) {
      const m = (a + b + 1) >> 1;
      if (v >= bins[m]!.x0) a = m;
      else b = m - 1;
    }
    bins[a]!.count++;
    total++;
  }
  for (const b of bins) b.density = total > 0 ? b.count / (total * (b.x1 - b.x0)) : 0;
  return bins;
}
