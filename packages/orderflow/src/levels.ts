// Per-bar price levels: volume by tick-size price level, split by aggressor.
//
// A level is an integer tick index k = price / tickSize. Rows are dense over
// the bar's own price range and stored as one Float64Array with a stride of 4:
// [buy, sell, unknown, count]. "buy" is volume where the buyer was the
// aggressor (traded at the ask), "sell" where the seller was (traded at the
// bid). Volume with side "unknown" is never assigned to either; it has its own
// column everywhere.

export const L_BUY = 0, L_SELL = 1, L_UNK = 2, L_CNT = 3, STRIDE = 4;

export class LevelGrid {
  /** Lowest and highest tick index with a trade, valid when `used`. */
  lo = 0;
  hi = -1;
  /** Tick index of row 0 of `data`; the array covers [alo, alo + cap). */
  private alo = 0;
  private cap = 0;
  private data = new Float64Array(0);

  get used(): boolean {
    return this.hi >= this.lo;
  }
  /** Rows in [lo, hi], touched or not. */
  get span(): number {
    return this.used ? this.hi - this.lo + 1 : 0;
  }

  /** Make tick `k` addressable. */
  private ensure(k: number): void {
    if (this.cap === 0) {
      this.cap = 16;
      this.alo = k - 8;
      this.data = new Float64Array(this.cap * STRIDE);
      return;
    }
    if (k >= this.alo && k < this.alo + this.cap) return;
    const lo = Math.min(k, this.lo), hi = Math.max(k, this.hi);
    const need = hi - lo + 1;
    const cap = Math.max(this.cap * 2, need * 2);
    const alo = lo - Math.floor((cap - need) / 2);
    const data = new Float64Array(cap * STRIDE);
    data.set(this.data.subarray((this.lo - this.alo) * STRIDE, (this.hi - this.alo + 1) * STRIDE), (this.lo - alo) * STRIDE);
    this.data = data;
    this.cap = cap;
    this.alo = alo;
  }

  /** side: +1 buy, -1 sell, 0 unknown. */
  add(k: number, side: number, size: number): void {
    this.ensure(k);
    if (!this.used) {
      this.lo = this.hi = k;
    } else {
      if (k < this.lo) this.lo = k;
      if (k > this.hi) this.hi = k;
    }
    const i = (k - this.alo) * STRIDE;
    this.data[i + (side > 0 ? L_BUY : side < 0 ? L_SELL : L_UNK)]! += size;
    this.data[i + L_CNT]! += 1;
  }

  /** Add volume with no side and no trade count (bar-level approximation). */
  addUnknownVolume(k: number, size: number): void {
    this.ensure(k);
    if (!this.used) this.lo = this.hi = k;
    else {
      if (k < this.lo) this.lo = k;
      if (k > this.hi) this.hi = k;
    }
    this.data[(k - this.alo) * STRIDE + L_UNK]! += size;
  }

  /** Column `col` at tick k; 0 outside the grid. */
  get(k: number, col: number): number {
    if (!this.used || k < this.lo || k > this.hi) return 0;
    return this.data[(k - this.alo) * STRIDE + col]!;
  }

  total(k: number): number {
    if (!this.used || k < this.lo || k > this.hi) return 0;
    const i = (k - this.alo) * STRIDE;
    return this.data[i]! + this.data[i + 1]! + this.data[i + 2]!;
  }

  /** True when the level carries any volume or trade. */
  touched(k: number): boolean {
    if (!this.used || k < this.lo || k > this.hi) return false;
    const i = (k - this.alo) * STRIDE;
    return this.data[i]! + this.data[i + 1]! + this.data[i + 2]! + this.data[i + 3]! > 0;
  }

  /** Visit touched rows, ascending price. */
  each(fn: (k: number, buy: number, sell: number, unknown: number, count: number) => void): void {
    for (let k = this.lo; k <= this.hi; k++) {
      const i = (k - this.alo) * STRIDE;
      const b = this.data[i]!, s = this.data[i + 1]!, u = this.data[i + 2]!, c = this.data[i + 3]!;
      if (b + s + u + c > 0) fn(k, b, s, u, c);
    }
  }
}
