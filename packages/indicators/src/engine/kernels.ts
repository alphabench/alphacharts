// Optional WASM kernels for the batch path. Where @alphacharts/wasm's
// benchmark shows a win at both 1M and 10M bars (running sum, variance and
// standard deviation, rolling highest/lowest and their bar offsets, linear
// regression) a node may hand a full-range run to a kernel that is bit-for-bit
// the same computation as its own loop (asserted by test/wasm.test.ts), so
// enabling it never changes a value. Recursive smoothing and WMA are not here:
// the benchmark shows no win for them.

import type { Kernels } from "@alphacharts/wasm";

export type BatchKernels = Pick<Kernels, "sumState" | "variance" | "highest" | "lowest" | "highestBars" | "lowestBars" | "linreg">;

let active: BatchKernels | null = null;

/** Route eligible batch runs through `k`; null restores the JS loops. */
export function setKernels(k: BatchKernels | null): void {
  active = k;
}

export function kernels(): BatchKernels | null {
  return active;
}

/** Below this many bars the call overhead beats the win. */
export const KERNEL_MIN_BARS = 4096;

/** A kernel run needs the whole series from bar 0 and no absent values. */
export function eligible(x: Float64Array, from: number, to: number): boolean {
  if (!active || from !== 0 || to < KERNEL_MIN_BARS) return false;
  for (let i = 0; i < to; i++) if (x[i]! !== x[i]!) return false;
  return true;
}
