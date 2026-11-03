// Seeded data and bit-exact comparison for the kernel tests.

/** mulberry32: small, fast, seedable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A price-like random walk (continuous values). */
export function walk(n: number, seed: number): Float64Array {
  const r = rng(seed);
  const x = new Float64Array(n);
  let v = 100;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * 2 + (r() - 0.5) * (r() < 0.01 ? 40 : 0.3);
    x[i] = v;
  }
  return x;
}

/** Quantised values with many ties, both zeros and negatives: the nasty case for extremes. */
export function ticks(n: number, seed: number): Float64Array {
  const r = rng(seed);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = Math.floor(r() * 7) - 3;
    x[i] = q === 0 ? (r() < 0.5 ? 0 : -0) : q * 0.25;
  }
  return x;
}

/** Wide dynamic range (1e-8 .. 1e8), signs mixed. */
export function wild(n: number, seed: number): Float64Array {
  const r = rng(seed);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (r() - 0.5) * 10 ** Math.floor(r() * 16 - 8);
  return x;
}

export const DATASETS: ReadonlyArray<readonly [string, (n: number, seed: number) => Float64Array]> = [
  ["walk", walk],
  ["ticks", ticks],
  ["wild", wild],
];

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** First index where two columns differ (NaN equals NaN; -0 differs from +0), or -1. */
export function firstDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!, q = b[i]!;
    if (p !== p || q !== q) {
      if (p === p || q === q) return i;
      continue;
    }
    if (p !== q) return i;
    if (p === 0 && !Object.is(p, q)) return i;
  }
  return -1;
}

export function describeDiff(name: string, a: ArrayLike<number>, b: ArrayLike<number>): string | undefined {
  const i = firstDiff(a, b);
  if (i < 0) return undefined;
  if (a.length !== b.length) return `${name}: length ${a.length} vs ${b.length}`;
  f64[0] = a[i]!;
  const ha = `${u32[1]!.toString(16)}:${u32[0]!.toString(16)}`;
  f64[0] = b[i]!;
  const hb = `${u32[1]!.toString(16)}:${u32[0]!.toString(16)}`;
  return `${name}[${i}]: ${a[i]} (${ha}) vs ${b[i]} (${hb})`;
}
