// Test helpers: a seeded PRNG, random price paths, and store comparison.

import type { OhlcBar, Trade } from "@alphacharts/core";
import type { BarStore } from "../src/store.js";

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Random-walk closed bars at 1-minute steps. */
export function randomBars(n: number, seed: number, start = 100, vol = 1): OhlcBar[] {
  const r = rng(seed);
  const out: OhlcBar[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(1, o + (r() - 0.5) * 2 * vol);
    out.push({ time: 1_000 + i * 60_000, open: o, high: Math.max(o, c) + r() * vol, low: Math.max(0.5, Math.min(o, c) - r() * vol), close: c });
    p = c;
  }
  return out;
}

/** Random-walk trades, equal times allowed. */
export function randomTrades(n: number, seed: number, start = 100, vol = 0.3): Trade[] {
  const r = rng(seed);
  const out: Trade[] = [];
  let p = start, t = 1_000;
  for (let i = 0; i < n; i++) {
    p = Math.max(1, p + (r() - 0.5) * 2 * vol);
    if (r() < 0.7) t += 1 + Math.floor(r() * 50);
    out.push({ time: t, price: p, size: 1 + Math.floor(r() * 20), side: "unknown" });
  }
  return out;
}

export function rows(s: BarStore): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < s.length; i++) {
    out.push([s.time[i]!, s.open[i]!, s.high[i]!, s.low[i]!, s.close[i]!, s.fromTime[i]!, s.toTime[i]!, ...(s.volume ? [s.volume[i]!] : [])]);
  }
  return out;
}

/** Split `a` into random chunks of 1..max. */
export function chunks<T>(a: readonly T[], seed: number, max = 7): T[][] {
  const r = rng(seed);
  const out: T[][] = [];
  for (let i = 0; i < a.length; ) {
    const k = 1 + Math.floor(r() * max);
    out.push(a.slice(i, i + k));
    i += k;
  }
  return out;
}
