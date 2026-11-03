import { beforeAll, describe, expect, it } from "vitest";
import {
  assertDense,
  createJsKernels,
  emaAlpha,
  jsKernels,
  loadKernels,
  rmaAlpha,
  supportsSimd,
  type Kernels,
  type WasmKernels,
} from "../src/index.js";
import { DATASETS, describeDiff, rng, ticks, walk } from "./helpers.js";

let wasm: WasmKernels;
beforeAll(async () => {
  wasm = await loadKernels();
});

function same(name: string, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const d = describeDiff(name, a, b);
  if (d) throw new Error(d);
}

// Every dense-column kernel as (kernels, x, p) -> named output columns.
type Run = (k: Kernels, x: Float64Array, p: number) => Record<string, ArrayLike<number>>;
const COLUMN_KERNELS: ReadonlyArray<{ name: string; minP: number; run: Run }> = [
  { name: "sum", minP: 1, run: (k, x, p) => ({ sum: k.sum(x, p) }) },
  { name: "sumState", minP: 1, run: (k, x, p) => ({ ...k.sumState(x, p) }) },
  { name: "mean", minP: 1, run: (k, x, p) => ({ mean: k.mean(x, p) }) },
  { name: "variance", minP: 1, run: (k, x, p) => ({ variance: k.variance(x, p) }) },
  { name: "stdev", minP: 1, run: (k, x, p) => ({ stdev: k.stdev(x, p) }) },
  { name: "ema", minP: 1, run: (k, x, p) => ({ ema: k.smooth(x, p, emaAlpha(p)) }) },
  { name: "rma", minP: 1, run: (k, x, p) => ({ rma: k.smooth(x, p, rmaAlpha(p)) }) },
  { name: "wma", minP: 1, run: (k, x, p) => ({ wma: k.wma(x, p) }) },
  { name: "highest", minP: 1, run: (k, x, p) => ({ highest: k.highest(x, p) }) },
  { name: "lowest", minP: 1, run: (k, x, p) => ({ lowest: k.lowest(x, p) }) },
  { name: "highestBars", minP: 1, run: (k, x, p) => ({ highestBars: k.highestBars(x, p) }) },
  { name: "lowestBars", minP: 1, run: (k, x, p) => ({ lowestBars: k.lowestBars(x, p) }) },
  { name: "linreg", minP: 2, run: (k, x, p) => ({ ...k.linreg(x, p) }) },
];

function sizesFor(p: number): number[] {
  return [...new Set([0, 1, 2, p - 1, p, p + 1, p + 2, 2 * p, 2 * p + 1, 7, 333, 1001])].filter((n) => n >= 0);
}

describe("wasm == js, bit for bit", () => {
  it("probes SIMD", () => {
    expect(supportsSimd()).toBe(true);
    expect(wasm.kind).toBe("wasm");
  });

  for (const { name, minP, run } of COLUMN_KERNELS) {
    for (const [dsName, gen] of DATASETS) {
      it(`${name} on ${dsName}: windows 1..1000, edge sizes`, () => {
        const windows = [1, 2, 3, 4, 5, 8, 9, 14, 16, 17, 31, 63, 100, 255, 1000].filter((p) => p >= minP);
        let seed = 1;
        for (const p of windows) {
          for (const n of sizesFor(p)) {
            const x = gen(n, seed++);
            const a = run(jsKernels, x, p), b = run(wasm, x, p);
            expect(Object.keys(b)).toEqual(Object.keys(a));
            for (const key of Object.keys(a)) same(`${name}.${key} p=${p} n=${n}`, a[key]!, b[key]!);
          }
        }
      });

      it(`${name} on ${dsName}: 100k bars`, () => {
        const x = gen(100_000, 99);
        for (const p of [1, 2, 7, 14, 200, 1000].filter((q) => q >= minP)) {
          const a = run(jsKernels, x, p), b = run(wasm, x, p);
          for (const key of Object.keys(a)) same(`${name}.${key} p=${p} n=100k`, a[key]!, b[key]!);
        }
      });
    }
  }

  it("every window length 1..80 on a tie-heavy series (deque vs SIMD scan boundary)", () => {
    const x = ticks(500, 5);
    for (let p = 1; p <= 80; p++) {
      for (const f of ["highest", "lowest", "highestBars", "lowestBars"] as const) {
        same(`${f} p=${p}`, jsKernels[f](x, p), wasm[f](x, p));
      }
    }
  });

  it("lodRows: all bucket exponents, offsets, holes, colour", () => {
    const r = rng(7);
    for (const n of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 63, 64, 65, 1000, 4099]) {
      for (const k of [0, 1, 2, 3, 4, 5, 8, 12]) {
        for (const first of [0, 1, 5, 8, 13, 1000]) {
          const o = walk(n, n + k + first), h = new Float64Array(n), l = new Float64Array(n), c = walk(n, n + 1);
          const color = new Uint32Array(n);
          for (let i = 0; i < n; i++) {
            h[i] = o[i]! + r() * (r() < 0.2 ? 0 : 2); // ties between rows happen
            l[i] = o[i]! - r() * 2;
            if (r() < 0.1) o[i] = Number.NaN; // hole
            if (r() < 0.02) h[i] = Number.NaN;
            color[i] = (r() * 0xffffffff) >>> 0;
          }
          for (const withColor of [false, true]) {
            const a = jsKernels.lodRows(o, h, l, c, k, first, withColor ? color : undefined);
            const b = wasm.lodRows(o, h, l, c, k, first, withColor ? color : undefined);
            expect(b.firstBucket).toBe(a.firstBucket);
            for (const key of ["o", "h", "l", "c"] as const) same(`lod.${key} n=${n} k=${k} first=${first}`, a[key], b[key]);
            if (withColor) same(`lod.color n=${n} k=${k}`, a.color!, b.color!);
            else expect(b.color).toBeUndefined();
          }
        }
      }
    }
  });

  it("lodRows: hole-free ±0 ties across SIMD lanes fall back to the first row", () => {
    // lanes (even/odd rows) hold +0 and -0 highs: the engine keeps the first one.
    for (const [h0, h1] of [[0, -0], [-0, 0]] as const) {
      const o = new Float64Array([1, 1, 1, 1]), l = new Float64Array([-5, -5, -5, -5]), c = new Float64Array([1, 2, 3, 4]);
      const h = new Float64Array([h0, h1, -1, -1]);
      const a = jsKernels.lodRows(o, h, l, c, 2), b = wasm.lodRows(o, h, l, c, 2);
      same("lod.h", a.h, b.h);
    }
    for (const [l0, l1] of [[0, -0], [-0, 0]] as const) {
      const o = new Float64Array([1, 1, 1, 1]), h = new Float64Array([9, 9, 9, 9]), c = new Float64Array([1, 2, 3, 4]);
      const l = new Float64Array([l0, l1, 5, 5]);
      same("lod.l", jsKernels.lodRows(o, h, l, c, 2).l, wasm.lodRows(o, h, l, c, 2).l);
    }
  });

  it("volume profile (total and split): ranges, out-of-range, NaN prices, bins", () => {
    const r = rng(11);
    for (const n of [0, 1, 2, 17, 1000, 100_000]) {
      const price = walk(n, n + 3), volume = new Float64Array(n), side = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        volume[i] = Math.floor(r() * 1000) + r();
        side[i] = r() < 0.5 ? 1 : 0;
        if (r() < 0.01) price[i] = Number.NaN;
      }
      let lo = Infinity, hi = -Infinity;
      for (const p of price) if (p === p) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
      if (!(hi > lo)) { lo = 90; hi = 110; }
      for (const bins of [1, 2, 7, 24, 100, 1000]) {
        for (const [a0, b0] of [[lo, hi], [lo + (hi - lo) * 0.25, hi - (hi - lo) * 0.25]] as const) {
          same(`vp n=${n} bins=${bins}`, jsKernels.volumeProfile(price, volume, a0, b0, bins), wasm.volumeProfile(price, volume, a0, b0, bins));
          const s = jsKernels.volumeProfileSplit(price, volume, side, a0, b0, bins);
          const t = wasm.volumeProfileSplit(price, volume, side, a0, b0, bins);
          same("vp.up", s.up, t.up);
          same("vp.down", s.down, t.down);
        }
      }
    }
  });
});

describe("the js kernels match their definitions", () => {
  it("highest/lowest/bars equal a brute-force scan", () => {
    for (const x of [walk(400, 3), ticks(400, 4)]) {
      for (const p of [1, 2, 5, 13, 50]) {
        const hi = jsKernels.highest(x, p), lo = jsKernels.lowest(x, p), hb = jsKernels.highestBars(x, p), lb = jsKernels.lowestBars(x, p);
        for (let i = 0; i < x.length; i++) {
          if (i < p - 1) { expect(hi[i]).toBeNaN(); expect(lb[i]).toBeNaN(); continue; }
          let bh = x[i]!, ah = 0, bl = x[i]!, al = 0;
          for (let j = 1; j < p; j++) {
            if (x[i - j]! > bh) { bh = x[i - j]!; ah = j; }
            if (x[i - j]! < bl) { bl = x[i - j]!; al = j; }
          }
          expect(Object.is(hi[i], bh)).toBe(true);
          expect(Object.is(lo[i], bl)).toBe(true);
          expect(hb[i]).toBe(ah);
          expect(lb[i]).toBe(al);
        }
      }
    }
  });

  it("sum / mean / variance / wma / linreg agree with direct window formulas", () => {
    const x = walk(300, 8);
    const p = 11;
    const sum = jsKernels.sum(x, p), mean = jsKernels.mean(x, p), v = jsKernels.variance(x, p), w = jsKernels.wma(x, p), lr = jsKernels.linreg(x, p);
    for (let i = 0; i < x.length; i++) {
      if (i < p - 1) { expect(sum[i]).toBeNaN(); expect(w[i]).toBeNaN(); expect(lr.value[i]).toBeNaN(); continue; }
      const win = Array.from(x.subarray(i - p + 1, i + 1));
      const s = win.reduce((a, b) => a + b, 0), m = s / p;
      expect(sum[i]).toBeCloseTo(s, 8);
      expect(mean[i]).toBeCloseTo(m, 9);
      expect(v[i]).toBeCloseTo(win.reduce((a, b) => a + (b - m) ** 2, 0) / p, 6);
      expect(w[i]).toBeCloseTo(win.reduce((a, b, j) => a + b * (j + 1), 0) / ((p * (p + 1)) / 2), 8);
      // the line passes through the mean at the window's centre
      expect(lr.intercept[i]! + lr.slope[i]! * ((p - 1) / 2)).toBeCloseTo(m, 7);
      expect(lr.value[i]).toBeCloseTo(lr.intercept[i]! + lr.slope[i]! * (p - 1), 9);
    }
  });

  it("smooth is seeded with the SMA, then recursive", () => {
    const x = walk(50, 2);
    const p = 5, a = emaAlpha(p);
    const e = jsKernels.smooth(x, p, a);
    for (let i = 0; i < 4; i++) expect(e[i]).toBeNaN();
    expect(e[4]).toBeCloseTo((x[0]! + x[1]! + x[2]! + x[3]! + x[4]!) / 5, 12);
    for (let i = 5; i < 50; i++) expect(e[i]).toBeCloseTo(e[i - 1]! + a * (x[i]! - e[i - 1]!), 12);
  });

  it("lodRows follows the pyramid's rules", () => {
    // rows 0..9 at first = 6, k = 2: buckets cover absolute [4,8) [8,12) [12,16)
    const n = 10;
    const o = Float64Array.from({ length: n }, (_, i) => 10 + i);
    const h = Float64Array.from({ length: n }, (_, i) => 20 + (i === 3 ? 5 : i));
    const l = Float64Array.from({ length: n }, (_, i) => 1 + (i === 6 ? -4 : i));
    const c = Float64Array.from({ length: n }, (_, i) => 100 + i);
    o[4] = Number.NaN; // hole
    const r = jsKernels.lodRows(o, h, l, c, 2, 6);
    expect(r.firstBucket).toBe(1);
    expect(Array.from(r.o)).toEqual([10, 12, 16]);
    expect(Array.from(r.h)).toEqual([21, 25, 29]);
    expect(Array.from(r.l)).toEqual([1, 3, -3]);
    expect(Array.from(r.c)).toEqual([101, 105, 109]);
  });

  it("volume profile puts price == hi in the last bin", () => {
    const vp = jsKernels.volumeProfile(Float64Array.of(10, 15, 20, 25, Number.NaN, 9.99), Float64Array.of(1, 2, 3, 4, 5, 6), 10, 20, 2);
    expect(Array.from(vp)).toEqual([1, 5]);
  });
});

describe("contract checks", () => {
  const x = walk(20, 1);
  for (const [name, k] of [["js", jsKernels], ["wasm", () => wasm]] as const) {
    const kernels = (): Kernels => (typeof k === "function" ? k() : k);
    it(`${name}: bad arguments throw RangeError`, () => {
      const K = kernels();
      expect(() => K.sum(x, 0)).toThrow(RangeError);
      expect(() => K.sum(x, 1.5)).toThrow(/period/);
      expect(() => K.highest(x, -1)).toThrow(RangeError);
      expect(() => K.linreg(x, 1)).toThrow(RangeError);
      expect(() => K.smooth(x, 3, Number.NaN)).toThrow(/alpha/);
      expect(() => K.volumeProfile(x, x.subarray(1), 0, 1, 4)).toThrow(/volume has 19 rows/);
      expect(() => K.volumeProfile(x, x, 1, 1, 4)).toThrow(/lo < hi/);
      expect(() => K.volumeProfile(x, x, 0, 1, 0)).toThrow(/bins/);
      expect(() => K.lodRows(x, x, x, x, 31)).toThrow(/exponent/);
      expect(() => K.lodRows(x, x, x, x.subarray(1), 3)).toThrow(/c has 19 rows/);
    });
    it(`${name}: checkInput names the first NaN`, () => {
      const K = name === "js" ? createJsKernels({ checkInput: true }) : checked;
      const bad = Float64Array.from(x);
      bad[7] = Number.NaN;
      expect(() => K.sum(bad, 3)).toThrow(/x\[7\] is NaN/);
      expect(() => K.linreg(bad, 3)).toThrow(RangeError);
      expect(() => K.highest(bad, 3)).toThrow(RangeError);
      expect(K.sum(x, 3).length).toBe(20);
    });
  }
  let checked: Kernels;
  beforeAll(async () => {
    checked = await loadKernels(undefined, { checkInput: true });
  });

  it("assertDense rejects NaN and non-Float64Array", () => {
    expect(() => assertDense(Float64Array.of(1, Number.NaN), "col")).toThrow(/col\[1\]/);
    expect(() => assertDense([1, 2] as unknown as Float64Array)).toThrow(TypeError);
  });
});

describe("wasm memory and loading", () => {
  it("reuses its arena: repeating a call does not grow memory; a bigger call grows once", async () => {
    const k = await loadKernels();
    const x = walk(10_000, 1);
    k.sumState(x, 10);
    const after = k.memoryBytes();
    for (let i = 0; i < 50; i++) k.sumState(x, 10);
    expect(k.memoryBytes()).toBe(after);
    k.sumState(walk(200_000, 1), 10);
    expect(k.memoryBytes()).toBeGreaterThan(after);
    const big = k.memoryBytes();
    for (let i = 0; i < 20; i++) k.sumState(x, 10);
    expect(k.memoryBytes()).toBe(big);
  });

  it("returns fresh arrays that stay valid after memory grows", async () => {
    const k = await loadKernels();
    const first = k.sum(walk(100, 1), 5);
    const copy = Float64Array.from(first);
    k.sum(walk(500_000, 2), 5); // grows memory, detaching the old buffer
    same("first", first, copy);
    expect(first.buffer).not.toBe(wasmBufferOf(k));
  });

  it("dispose makes later calls fail loudly", async () => {
    const k = await loadKernels();
    k.dispose();
    expect(() => k.sum(walk(10, 1), 3)).toThrow(/disposed/);
  });

  it("rejects garbage bytes and modules without the exports, with a clear message", async () => {
    await expect(loadKernels(new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not instantiate/);
    // (module) is valid but exports nothing
    await expect(loadKernels(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).rejects.toThrow(/lacks the export/);
    await expect(loadKernels(Promise.reject(new Error("nope")))).rejects.toThrow(/could not read/);
  });

  it("accepts a Response and a promise of bytes", async () => {
    const { KERNELS_WASM_BASE64 } = await import("../src/kernels.wasm.js");
    const bytes = Uint8Array.from(atob(KERNELS_WASM_BASE64), (c) => c.charCodeAt(0));
    const x = walk(100, 1);
    const viaPromise = await loadKernels(Promise.resolve(bytes));
    const viaResponse = await loadKernels(new Response(bytes, { headers: { "content-type": "application/wasm" } }));
    same("promise", viaPromise.mean(x, 4), jsKernels.mean(x, 4));
    same("response", viaResponse.mean(x, 4), jsKernels.mean(x, 4));
  });
});

function wasmBufferOf(k: WasmKernels): ArrayBufferLike {
  return k.sum(Float64Array.of(1), 1).buffer;
}
