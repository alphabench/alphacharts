// The kernel interface shared by the pure-JS implementation (`jsKernels`, the
// fallback and the test oracle) and the WebAssembly one (`loadKernels`).
//
// Contract
// - Inputs are dense Float64Array columns without NaN. Warm-up outputs are NaN,
//   never 0. The exceptions are stated per kernel (LOD holes, volume-profile
//   prices). A NaN in a dense column is a contract violation: results are then
//   unspecified (but identical in both implementations), and `assertDense`
//   or the `checkInput` option turns it into an error.
// - Every call returns fresh typed arrays the caller owns. Inputs are never
//   modified or retained.
// - Both implementations perform the same floating-point operations in the
//   same order, so equal inputs give equal outputs bit for bit (NaN positions
//   included). The order is that of the study engine's graph nodes
//   (packages/indicators/src/engine/graph.ts).
// - Argument errors (period, alpha, lengths, ranges) throw RangeError.

/** Output of the running-sum kernel with its state column. */
export interface SumState {
  /** Sum over the last p values; NaN while fewer than p values exist. */
  readonly sum: Float64Array;
  /** The running sum itself at every index, warm-up included. */
  readonly state: Float64Array;
}

export interface LinReg {
  /** The fitted line at the newest bar of each window. */
  readonly value: Float64Array;
  /** Slope per bar. */
  readonly slope: Float64Array;
  /** Intercept at the oldest bar of each window. */
  readonly intercept: Float64Array;
}

/** Bucket columns (Float32, as the chart's LOD pyramid stores them). */
export interface LodLevel {
  /** Absolute index of bucket 0 (= first >> k). */
  readonly firstBucket: number;
  readonly o: Float32Array;
  readonly h: Float32Array;
  readonly l: Float32Array;
  readonly c: Float32Array;
  /** Colour of the row that made each bucket's high, when `color` was given. */
  readonly color?: Uint32Array;
}

export interface SplitProfile {
  /** Volume of bars whose side is non-zero. */
  readonly up: Float64Array;
  /** Volume of bars whose side is zero. */
  readonly down: Float64Array;
}

export interface Kernels {
  /** Which implementation answers. */
  readonly kind: "js" | "wasm";

  /** Running-sum window: add the new value, subtract the one leaving (p = 1 returns x itself). p >= 1. */
  sum(x: Float64Array, p: number): Float64Array;
  /** `sum` plus the running-sum state column. */
  sumState(x: Float64Array, p: number): SumState;
  /** Rolling mean (running sum / p). */
  mean(x: Float64Array, p: number): Float64Array;
  /** Population variance: the window's squared deviations from its rolling mean (mean-centred two-pass, as the engine's), / p. */
  variance(x: Float64Array, p: number): Float64Array;
  /** Square root of `variance`. */
  stdev(x: Float64Array, p: number): Float64Array;
  /**
   * y = y' + alpha (x - y'), seeded with the simple mean of the first p values.
   * EMA is alpha = 2 / (p + 1), Wilder's RMA alpha = 1 / p (`emaAlpha`, `rmaAlpha`).
   */
  smooth(x: Float64Array, p: number, alpha: number): Float64Array;
  /** Linearly weighted mean, newest bar weighted p. */
  wma(x: Float64Array, p: number): Float64Array;
  /** Highest value of the last p bars. */
  highest(x: Float64Array, p: number): Float64Array;
  lowest(x: Float64Array, p: number): Float64Array;
  /** Bars since the highest/lowest of the last p bars (0 = this bar; ties pick the most recent). */
  highestBars(x: Float64Array, p: number): Float64Array;
  lowestBars(x: Float64Array, p: number): Float64Array;
  /** Least-squares line over each window of p >= 2 bars (x = 0..p-1, oldest..newest). */
  linreg(x: Float64Array, p: number): LinReg;
  /**
   * Level-of-detail buckets of 2^k rows (0 <= k <= 30), aligned to absolute row
   * index: row r of the input is absolute row `first + r`, so bucket b covers
   * absolute rows [b·2^k, (b+1)·2^k). Open-first, high-max, low-min, close-last
   * of the rows in the bucket, rounded to Float32. A row whose open is NaN is a
   * hole and is skipped; an all-hole bucket is NaN in o/h/l/c. `color`
   * (optional, per row) is carried from the first row that made the high.
   * The four columns must have equal length; first + length must stay below 2^31.
   */
  lodRows(
    o: Float64Array,
    h: Float64Array,
    l: Float64Array,
    c: Float64Array,
    k: number,
    first?: number,
    color?: Uint32Array,
  ): LodLevel;
  /**
   * Volume per price bin: `bins` equal bins over [lo, hi] (lo < hi), a price
   * equal to hi in the last bin; NaN and out-of-range prices are skipped.
   */
  volumeProfile(price: Float64Array, volume: Float64Array, lo: number, hi: number, bins: number): Float64Array;
  /** `volumeProfile` split by a per-bar side (non-zero = up, zero = down). */
  volumeProfileSplit(
    price: Float64Array,
    volume: Float64Array,
    side: Uint8Array,
    lo: number,
    hi: number,
    bins: number,
  ): SplitProfile;
}

/** The wasm kernels additionally own linear memory. */
export interface WasmKernels extends Kernels {
  readonly kind: "wasm";
  /** Bytes of linear memory currently reserved (the arena's high-water mark; wasm memory never shrinks). */
  memoryBytes(): number;
  /** Drop the instance and its memory; every later call throws. */
  dispose(): void;
}

export interface KernelOptions {
  /** Scan dense inputs for NaN and throw a RangeError naming the first one (an extra O(n) pass). Default false. */
  readonly checkInput?: boolean;
}

export const emaAlpha = (p: number): number => 2 / (p + 1);
export const rmaAlpha = (p: number): number => 1 / p;

// ---- argument checks (shared so both implementations fail identically) ------------

export function checkPeriod(p: number, min = 1): void {
  if (!Number.isInteger(p) || p < min) throw new RangeError(`period must be an integer >= ${min}, got ${p}`);
}

export function checkAlpha(alpha: number): void {
  if (!Number.isFinite(alpha)) throw new RangeError(`alpha must be finite, got ${alpha}`);
}

export function checkSameLength(n: number, what: string, other: number): void {
  if (n !== other) throw new RangeError(`${what} has ${other} rows, expected ${n}`);
}

/** Throws a RangeError naming the first NaN (or non-array) in a column that must be dense. */
export function assertDense(x: Float64Array, name = "input"): void {
  if (!(x instanceof Float64Array)) throw new TypeError(`${name} must be a Float64Array`);
  for (let i = 0; i < x.length; i++) {
    if (x[i]! !== x[i]!) throw new RangeError(`${name}[${i}] is NaN: this kernel needs a dense column`);
  }
}

export function checkLod(n: number, k: number, first: number): void {
  if (!Number.isInteger(k) || k < 0 || k > 30) throw new RangeError(`bucket exponent must be an integer in [0, 30], got ${k}`);
  if (!Number.isInteger(first) || first < 0 || first + n > 0x7fffffff) {
    throw new RangeError(`first must be an integer >= 0 with first + rows < 2^31, got ${first} (+${n})`);
  }
}

export function checkProfile(lo: number, hi: number, bins: number): number {
  if (!Number.isInteger(bins) || bins < 1 || bins > 1 << 24) throw new RangeError(`bins must be an integer in [1, 2^24], got ${bins}`);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) throw new RangeError(`need finite lo < hi, got [${lo}, ${hi}]`);
  const scale = bins / (hi - lo);
  if (!Number.isFinite(scale)) throw new RangeError(`price range [${lo}, ${hi}] is too narrow or too wide for ${bins} bins`);
  return scale;
}
