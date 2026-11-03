import type { Trade } from "@alphacharts/core";

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Seeded trade stream: random walk on a 0.05 grid, bursts, ~10% unknown side. */
export function randomTrades(n: number, seed: number, t0 = Date.UTC(2026, 9, 20, 4, 0), tick = 0.05, fractional = false): Trade[] {
  const r = rng(seed);
  const out: Trade[] = [];
  let k = Math.round(25_000 / tick), t = t0;
  for (let i = 0; i < n; i++) {
    t += r() < 0.3 ? 0 : Math.floor(r() * 4000); // equal times allowed
    k += Math.floor(r() * 5) - 2;
    const u = r();
    out.push({
      time: t,
      price: Number((k * tick).toFixed(2)),
      size: fractional ? Math.round((0.1 + r() * 20) * 1000) / 1000 : 1 + Math.floor(r() * 50),
      side: u < 0.1 ? "unknown" : u < 0.55 ? "buy" : "sell",
    });
  }
  return out;
}

/** One trade per (price, side) with the given size, in a single instant. */
export function levelTrades(time: number, levels: Record<number, [number, number, number]>): Trade[] {
  const out: Trade[] = [];
  for (const [p, [b, s, u]] of Object.entries(levels)) {
    if (b) out.push({ time, price: +p, size: b, side: "buy" });
    if (s) out.push({ time, price: +p, size: s, side: "sell" });
    if (u) out.push({ time, price: +p, size: u, side: "unknown" });
  }
  return out;
}
