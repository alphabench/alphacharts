// Shared test helpers: the seeded datasets, a seeded PRNG and comparison.

import main from "../fixtures/dataset.json";
import type { BarColumns } from "../src/types.js";

export function toColumns(d: { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }): Required<BarColumns> {
  return {
    time: Float64Array.from(d.time), open: Float64Array.from(d.open), high: Float64Array.from(d.high),
    low: Float64Array.from(d.low), close: Float64Array.from(d.close), volume: Float64Array.from(d.volume),
  };
}

export const MAIN = toColumns(main);

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Seeded random-walk bars of length n (valid OHLC), for property tests. */
export function randomBars(n: number, seed: number): Required<BarColumns> {
  const r = rng(seed);
  const time = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = Math.max(1, o + (r() - 0.5) * 2);
    time[i] = 1_700_000_000_000 + i * 60_000;
    open[i] = o; close[i] = c;
    high[i] = Math.max(o, c) + r();
    low[i] = Math.max(0.5, Math.min(o, c) - r());
    volume[i] = Math.round(1000 + r() * 9000);
    p = c;
  }
  return { time, open, high, low, close, volume };
}

/** Relative 1e-9 with a small absolute floor for values near zero. */
export function close(a: number, b: number, rel = 1e-9, abs = 1e-12): boolean {
  if (a !== a || b !== b) return a !== a && b !== b;
  return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b)) + abs;
}
