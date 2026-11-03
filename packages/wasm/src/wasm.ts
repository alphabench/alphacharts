// WebAssembly loader and wrapper for the kernels in rust/src/lib.rs.
//
// Module: ~7 KB, no imports, no allocator, built for wasm32 with SIMD128. It is
// embedded as base64 (kernels.wasm.ts), so `loadKernels()` needs no fetch and
// works in Node, workers and browsers. A different build can be passed as
// bytes, a Response or a promise of either.
//
// Failure is loud: no WebAssembly, no SIMD, a corrupt module or a module
// missing an export rejects with an Error that says which. Nothing silently
// falls back; the caller chooses `jsKernels` when `loadKernels` rejects.
//
// Memory ownership
// - The wrapper owns the module's linear memory. Callers never see a pointer.
// - One arena sits above the module's `__heap_base`. Every call resets it, bump
//   allocates 16-byte-aligned regions for that call's inputs, outputs and
//   scratch, copies inputs in, runs the kernel, copies outputs out into fresh
//   typed arrays (`slice`), and leaves the arena logically empty. Nothing
//   survives a call, so nothing can leak; calls are synchronous, so there is no
//   re-entrancy.
// - Linear memory grows on demand (`memory.grow`, whole 64 KiB pages) and never
//   shrinks: it stays at the largest call's footprint until `dispose()` drops
//   the instance. After a grow the old `memory.buffer` is detached, so views
//   are created only after the last allocation of a call and never kept.
// - Cost model: a call pays one memcpy per input column in and per output
//   column out. Kernels that are memory-bound do not win against JS; see
//   bench-results.json.

import { KERNELS_WASM_BASE64 } from "./kernels.wasm.js";
import {
  assertDense,
  checkAlpha,
  checkLod,
  checkPeriod,
  checkProfile,
  checkSameLength,
  type KernelOptions,
  type LinReg,
  type LodLevel,
  type SplitProfile,
  type SumState,
  type WasmKernels,
} from "./kernels.js";

const PAGE = 65536;

// (module (func (result v128) i32.const 0  i8x16.splat  i8x16.popcnt)): validates only where SIMD128 exists.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

/** True when this runtime can run the SIMD128 module. */
export function supportsSimd(): boolean {
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

interface Exports {
  memory: WebAssembly.Memory;
  __heap_base: WebAssembly.Global;
  k_sum(x: number, n: number, p: number, out: number, state: number): void;
  k_mean(x: number, n: number, p: number, out: number): void;
  k_variance(x: number, n: number, p: number, out: number, root: number): void;
  k_smooth(x: number, n: number, p: number, alpha: number, out: number): void;
  k_wma(x: number, n: number, p: number, out: number): void;
  k_brute_max(): number;
  k_extreme(x: number, n: number, p: number, out: number, scratch: number, max: number, bars: number): void;
  k_linreg(x: number, n: number, p: number, value: number, slope: number, icpt: number): void;
  k_lod_rows(
    o: number, h: number, l: number, c: number, n: number, k: number, first: number,
    oo: number, oh: number, ol: number, oc: number, colorIn: number, colorOut: number,
  ): void;
  k_volume_profile(
    price: number, volume: number, side: number, n: number, lo: number, hi: number, scale: number,
    bins: number, up: number, down: number,
  ): void;
}

const REQUIRED = [
  "memory", "__heap_base", "k_sum", "k_mean", "k_variance", "k_smooth", "k_wma", "k_extreme", "k_brute_max", "k_linreg",
  "k_lod_rows", "k_volume_profile",
] as const;

/** Bump arena over the instance's memory; see the file header for the rules. */
class Arena {
  private top: number;
  constructor(private readonly mem: WebAssembly.Memory, private readonly base: number) {
    this.top = base;
  }

  reset(): void {
    this.top = this.base;
  }

  /** Reserve `bytes` (16-byte aligned), growing memory if needed; returns the byte offset. */
  alloc(bytes: number): number {
    const ptr = (this.top + 15) & ~15;
    const end = ptr + bytes;
    if (end > 0x7fff_fff0) throw new RangeError(`wasm kernels: ${end} bytes exceed the 2 GiB linear-memory budget; use jsKernels for inputs this large`);
    const have = this.mem.buffer.byteLength;
    if (end > have) {
      try {
        this.mem.grow(Math.ceil((end - have) / PAGE));
      } catch (e) {
        throw new Error(`wasm kernels: cannot grow linear memory to ${end} bytes`, { cause: e });
      }
    }
    this.top = end;
    return ptr;
  }

  putF64(x: Float64Array): number {
    const ptr = this.alloc(x.length * 8);
    new Float64Array(this.mem.buffer, ptr, x.length).set(x);
    return ptr;
  }

  putU8(x: Uint8Array): number {
    const ptr = this.alloc(x.length);
    new Uint8Array(this.mem.buffer, ptr, x.length).set(x);
    return ptr;
  }

  putU32(x: Uint32Array): number {
    const ptr = this.alloc(x.length * 4);
    new Uint32Array(this.mem.buffer, ptr, x.length).set(x);
    return ptr;
  }

  zeroF64(n: number): number {
    const ptr = this.alloc(n * 8);
    new Float64Array(this.mem.buffer, ptr, n).fill(0);
    return ptr;
  }

  takeF64(ptr: number, n: number): Float64Array {
    return new Float64Array(this.mem.buffer, ptr, n).slice();
  }

  takeF32(ptr: number, n: number): Float32Array {
    return new Float32Array(this.mem.buffer, ptr, n).slice();
  }

  takeU32(ptr: number, n: number): Uint32Array {
    return new Uint32Array(this.mem.buffer, ptr, n).slice();
  }

  get bytes(): number {
    return this.mem.buffer.byteLength;
  }
}

type Source = BufferSource | Response | Promise<BufferSource | Response>;

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Instantiate the kernels. Rejects (never falls back) when WebAssembly or SIMD
 * is missing or the module is invalid. `source` defaults to the embedded build.
 */
export async function loadKernels(source?: Source, opts: KernelOptions = {}): Promise<WasmKernels> {
  if (typeof WebAssembly !== "object") throw new Error("@alphacharts/wasm: WebAssembly is not available in this runtime");
  if (!supportsSimd()) throw new Error("@alphacharts/wasm: this runtime lacks WebAssembly SIMD128; use jsKernels");
  let bytes: BufferSource;
  try {
    const src = source === undefined ? decodeBase64(KERNELS_WASM_BASE64) : await source;
    bytes = typeof Response !== "undefined" && src instanceof Response ? await src.arrayBuffer() : (src as BufferSource);
  } catch (e) {
    throw new Error("@alphacharts/wasm: could not read the wasm module", { cause: e });
  }
  let instance: WebAssembly.Instance;
  try {
    instance = (await WebAssembly.instantiate(bytes, {})).instance;
  } catch (e) {
    throw new Error("@alphacharts/wasm: could not instantiate the wasm module", { cause: e });
  }
  const ex = instance.exports as unknown as Partial<Exports>;
  for (const name of REQUIRED) {
    if (ex[name] === undefined) throw new Error(`@alphacharts/wasm: module lacks the export "${name}"`);
  }
  return wrap(ex as Exports, opts);
}

function wrap(ex0: Exports, opts: KernelOptions): WasmKernels {
  let ex: Exports | undefined = ex0;
  let arena: Arena | undefined = new Arena(ex0.memory, Number(ex0.__heap_base.value));
  const bruteMax = ex0.k_brute_max();

  /** Start a call: the live arena + exports, or a clear error after dispose(). */
  const begin = (): { a: Arena; e: Exports } => {
    if (!arena || !ex) throw new Error("@alphacharts/wasm: kernels were disposed");
    arena.reset();
    return { a: arena, e: ex };
  };
  const dense = (x: Float64Array, name = "x"): void => {
    if (opts.checkInput) assertDense(x, name);
  };
  const window = (x: Float64Array, p: number, run: (e: Exports, a: Arena, px: number, n: number) => Float64Array): Float64Array => {
    checkPeriod(p);
    dense(x);
    const n = x.length;
    if (n === 0) return new Float64Array(0);
    const { a, e } = begin();
    return run(e, a, a.putF64(x), n);
  };
  const extreme = (x: Float64Array, p: number, max: number, bars: number): Float64Array =>
    window(x, p, (e, a, px, n) => {
      const out = a.alloc(n * 8);
      const scratch = p <= bruteMax ? 0 : a.alloc(n * 8); // block scan: two u32 index columns
      e.k_extreme(px, n, p, out, scratch, max, bars);
      return a.takeF64(out, n);
    });

  return {
    kind: "wasm",

    sum: (x, p) =>
      window(x, p, (e, a, px, n) => {
        const out = a.alloc(n * 8);
        e.k_sum(px, n, p, out, 0);
        return a.takeF64(out, n);
      }),

    sumState(x, p): SumState {
      checkPeriod(p);
      dense(x);
      const n = x.length;
      if (n === 0) return { sum: new Float64Array(0), state: new Float64Array(0) };
      const { a, e } = begin();
      const px = a.putF64(x);
      const out = a.alloc(n * 8);
      const state = a.alloc(n * 8);
      e.k_sum(px, n, p, out, state);
      return { sum: a.takeF64(out, n), state: a.takeF64(state, n) };
    },

    mean: (x, p) =>
      window(x, p, (e, a, px, n) => {
        const out = a.alloc(n * 8);
        e.k_mean(px, n, p, out);
        return a.takeF64(out, n);
      }),

    variance: (x, p) =>
      window(x, p, (e, a, px, n) => {
        const out = a.alloc(n * 8);
        e.k_variance(px, n, p, out, 0);
        return a.takeF64(out, n);
      }),

    stdev: (x, p) =>
      window(x, p, (e, a, px, n) => {
        const out = a.alloc(n * 8);
        e.k_variance(px, n, p, out, 1);
        return a.takeF64(out, n);
      }),

    smooth(x, p, alpha) {
      checkAlpha(alpha);
      return window(x, p, (e, a, px, n) => {
        const out = a.alloc(n * 8);
        e.k_smooth(px, n, p, alpha, out);
        return a.takeF64(out, n);
      });
    },

    wma: (x, p) =>
      window(x, p, (e, a, px, n) => {
        const out = a.alloc(n * 8);
        e.k_wma(px, n, p, out);
        return a.takeF64(out, n);
      }),

    highest: (x, p) => extreme(x, p, 1, 0),
    lowest: (x, p) => extreme(x, p, 0, 0),
    highestBars: (x, p) => extreme(x, p, 1, 1),
    lowestBars: (x, p) => extreme(x, p, 0, 1),

    linreg(x, p): LinReg {
      checkPeriod(p, 2);
      dense(x);
      const n = x.length;
      if (n === 0) return { value: new Float64Array(0), slope: new Float64Array(0), intercept: new Float64Array(0) };
      const { a, e } = begin();
      const px = a.putF64(x);
      const value = a.alloc(n * 8), slope = a.alloc(n * 8), icpt = a.alloc(n * 8);
      e.k_linreg(px, n, p, value, slope, icpt);
      return { value: a.takeF64(value, n), slope: a.takeF64(slope, n), intercept: a.takeF64(icpt, n) };
    },

    lodRows(o, h, l, c, k, first = 0, color): LodLevel {
      const n = o.length;
      checkSameLength(n, "h", h.length);
      checkSameLength(n, "l", l.length);
      checkSameLength(n, "c", c.length);
      if (color) checkSameLength(n, "color", color.length);
      checkLod(n, k, first);
      if (n === 0) {
        const e0 = new Float32Array(0);
        return color ? { firstBucket: 0, o: e0, h: e0, l: e0, c: e0, color: new Uint32Array(0) } : { firstBucket: 0, o: e0, h: e0, l: e0, c: e0 };
      }
      const size = 2 ** k;
      const b0 = Math.floor(first / size);
      const nb = Math.floor((first + n - 1) / size) - b0 + 1;
      const { a, e } = begin();
      const po = a.putF64(o), ph = a.putF64(h), pl = a.putF64(l), pc = a.putF64(c);
      const pcol = color ? a.putU32(color) : 0;
      const oo = a.alloc(nb * 4), oh = a.alloc(nb * 4), ol = a.alloc(nb * 4), oc = a.alloc(nb * 4);
      const ocol = color ? a.alloc(nb * 4) : 0;
      e.k_lod_rows(po, ph, pl, pc, n, k, first, oo, oh, ol, oc, pcol, ocol);
      const base = { firstBucket: b0, o: a.takeF32(oo, nb), h: a.takeF32(oh, nb), l: a.takeF32(ol, nb), c: a.takeF32(oc, nb) };
      return color ? { ...base, color: a.takeU32(ocol, nb) } : base;
    },

    volumeProfile(price, volume, lo, hi, bins) {
      checkSameLength(price.length, "volume", volume.length);
      const scale = checkProfile(lo, hi, bins);
      const n = price.length;
      const { a, e } = begin();
      const pp = a.putF64(price), pv = a.putF64(volume);
      const up = a.zeroF64(bins);
      if (n > 0) e.k_volume_profile(pp, pv, 0, n, lo, hi, scale, bins, up, 0);
      return a.takeF64(up, bins);
    },

    volumeProfileSplit(price, volume, side, lo, hi, bins): SplitProfile {
      checkSameLength(price.length, "volume", volume.length);
      checkSameLength(price.length, "side", side.length);
      const scale = checkProfile(lo, hi, bins);
      const n = price.length;
      const { a, e } = begin();
      const pp = a.putF64(price), pv = a.putF64(volume), ps = a.putU8(side);
      const up = a.zeroF64(bins), down = a.zeroF64(bins);
      if (n > 0) e.k_volume_profile(pp, pv, ps, n, lo, hi, scale, bins, up, down);
      return { up: a.takeF64(up, bins), down: a.takeF64(down, bins) };
    },

    memoryBytes: () => arena?.bytes ?? 0,

    dispose() {
      ex = undefined;
      arena = undefined;
    },
  };
}
