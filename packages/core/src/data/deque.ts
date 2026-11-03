// Double-ended growable typed-array columns over an absolute index range.
//
// Every column shares one range [first, first + length). Element `abs` of a
// column lives at buffer position `head + (abs - first)`. Growth at either end
// reserves headroom proportional to the current size, so a run of prepends
// (history paging) or appends (live bars) is amortised O(1) per element and
// never copies on every call. Hot loops read the raw buffers through `pos()`
// instead of per-element accessors.

export type TypedArray = Float64Array | Float32Array | Uint32Array | Int32Array | Uint8Array;
export type ColumnSpec = { readonly ctor: new (length: number) => TypedArray; readonly fill: number };

export const F64_NAN: ColumnSpec = { ctor: Float64Array, fill: Number.NaN };
export const F32_NAN: ColumnSpec = { ctor: Float32Array, fill: Number.NaN };
export const U32_ZERO: ColumnSpec = { ctor: Uint32Array, fill: 0 };
export const U8_ZERO: ColumnSpec = { ctor: Uint8Array, fill: 0 };

const MIN_CAPACITY = 64;

export class ColumnDeque {
  /** Raw buffers, one per column. Replaced on growth: never cache across a write. */
  cols: TypedArray[];
  /** Buffer position of `first`. */
  head = 0;
  /** Absolute index of the first element. */
  first = 0;
  length = 0;
  private capacity: number;

  constructor(private readonly specs: readonly ColumnSpec[], capacity = MIN_CAPACITY) {
    this.capacity = Math.max(MIN_CAPACITY, capacity);
    this.cols = specs.map((s) => filled(s, this.capacity));
  }

  /** One past the last absolute index. */
  get end(): number {
    return this.first + this.length;
  }

  /** Buffer position of absolute index `abs` (not bounds-checked). */
  pos(abs: number): number {
    return this.head + (abs - this.first);
  }

  has(abs: number): boolean {
    return abs >= this.first && abs < this.first + this.length;
  }

  clear(first = 0): void {
    for (let c = 0; c < this.cols.length; c++) {
      const col = this.cols[c]!;
      col.fill(this.specs[c]!.fill, this.head, this.head + this.length);
    }
    this.head = this.capacity >> 1;
    this.first = first;
    this.length = 0;
  }

  /**
   * Make [lo, hi) addressable, growing at either end. New slots hold the
   * column's fill value. Existing elements keep their absolute index.
   */
  cover(lo: number, hi: number): void {
    if (this.length === 0) {
      const n = hi - lo;
      // Grow to fit, or give memory back when a large series is replaced by a
      // much smaller one (10M bars → 1k would otherwise keep ~480 MB).
      if (n > this.capacity || this.capacity > Math.max(MIN_CAPACITY * 4, n * 4)) this.realloc(Math.max(MIN_CAPACITY, n + (n >> 1)), n >> 2);
      else this.head = Math.max(0, Math.min(this.capacity - n, (this.capacity - n) >> 1));
      this.first = lo;
      this.length = n;
      return;
    }
    const front = Math.max(0, this.first - lo);
    const back = Math.max(0, hi - this.end);
    if (front === 0 && back === 0) return;
    if (front > this.head || back > this.capacity - this.head - this.length) {
      const total = this.length + front + back;
      const spare = Math.max(MIN_CAPACITY, total >> 1);
      // Headroom goes to the side that is growing; both if both.
      const frontRoom = front > 0 ? (back > 0 ? spare >> 1 : spare) : 0;
      this.realloc(total + spare, frontRoom + front);
    }
    this.head -= front;
    this.first -= front;
    this.length += front + back;
  }

  /** Drop everything outside [lo, hi) (used when replacing a series' data). */
  truncate(lo: number, hi: number): void {
    const a = Math.max(lo, this.first);
    const b = Math.min(hi, this.end);
    if (b <= a) {
      this.clear(lo);
      return;
    }
    for (let c = 0; c < this.cols.length; c++) {
      const col = this.cols[c]!;
      const fill = this.specs[c]!.fill;
      col.fill(fill, this.head, this.pos(a));
      col.fill(fill, this.pos(b), this.head + this.length);
    }
    this.head = this.pos(a);
    this.first = a;
    this.length = b - a;
  }

  // Old elements land at `newHead`; `cover` then moves head back by `front`.
  private realloc(capacity: number, newHead: number): void {
    const next = this.specs.map((s) => filled(s, capacity));
    for (let c = 0; c < next.length; c++) {
      next[c]!.set(this.cols[c]!.subarray(this.head, this.head + this.length), newHead);
    }
    this.cols = next;
    this.capacity = capacity;
    this.head = newHead;
  }
}

function filled(spec: ColumnSpec, n: number): TypedArray {
  const a = new spec.ctor(n);
  if (spec.fill !== 0) a.fill(spec.fill);
  return a;
}
