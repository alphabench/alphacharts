// Stacking around zero: positive values stack up from zero and negative values
// stack down from zero, each apart from the other, so a series that changes sign
// never overlaps itself ("diverging" stacks, flows bars).

export interface StackInput {
  /** Which x (category or time) each value belongs to. Series stack where keys are equal. */
  keys: readonly string[];
  /** Values; NaN stays NaN and takes no space. */
  values: ArrayLike<number>;
}
export interface Stacked {
  /** Lower and upper edge of each value's segment (NaN where the value is NaN). */
  lo: Float64Array;
  hi: Float64Array;
}

export function stack(series: readonly StackInput[]): Stacked[] {
  const pos = new Map<string, number>();
  const neg = new Map<string, number>();
  return series.map((s) => {
    const n = s.values.length;
    if (s.keys.length !== n) throw new RangeError(`stack: ${s.keys.length} keys for ${n} values`);
    const lo = new Float64Array(n), hi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = s.values[i]!, k = s.keys[i]!;
      if (v !== v) {
        lo[i] = hi[i] = NaN;
        continue;
      }
      const m = v >= 0 ? pos : neg;
      const base = m.get(k) ?? 0;
      lo[i] = base;
      hi[i] = base + v;
      m.set(k, base + v);
    }
    return { lo, hi };
  });
}
