// The bars drawings read: anchored VWAP, volume profile, bar counts, magnet
// snapping, bars pattern. The chart core has no public range iteration over
// series data, so the integrator, who owns the data, hands the plugin a
// BarSource. ArrayBarSource is one over columnar Float64Arrays that mirrors
// Series.setData / update / prepend.

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarSource {
  /** Bumps on every mutation: caches key on it. */
  readonly version: number;
  readonly length: number;
  /** Bar at array position i (0 = oldest). Throws when out of range. */
  at(i: number): Bar;
  /** Bar whose time is nearest to `time`, or undefined when empty. */
  nearest(time: number): Bar | undefined;
  /** Fractional position of `time` in the bar sequence: integer at a bar, linear between bars, extrapolated by the median interval outside. */
  logical(time: number): number;
  /** Inverse of logical(). */
  timeAtLogical(l: number): number;
  /** Index range [lo, hi) of bars with from <= time <= to. */
  range(from: number, to: number): [number, number];
  /** Median bar interval in ms. */
  readonly interval: number;
}

export interface ColumnarBars {
  time: ArrayLike<number>;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  volume?: ArrayLike<number> | undefined;
}

export class ArrayBarSource implements BarSource {
  private t: number[] = [];
  private o: number[] = [];
  private h: number[] = [];
  private l: number[] = [];
  private c: number[] = [];
  private v: number[] = [];
  private ver = 0;
  private cachedInterval = 0;

  constructor(data?: ColumnarBars) {
    if (data) this.setData(data);
  }

  get version(): number {
    return this.ver;
  }

  get length(): number {
    return this.t.length;
  }

  setData(d: ColumnarBars): void {
    const n = d.time.length;
    for (const k of ["open", "high", "low", "close"] as const) {
      if (d[k].length !== n) throw new RangeError(`ArrayBarSource: ${k} has ${d[k].length} rows, time has ${n}`);
    }
    if (d.volume && d.volume.length !== n) throw new RangeError(`ArrayBarSource: volume has ${d.volume.length} rows, time has ${n}`);
    for (let i = 1; i < n; i++) if (!(d.time[i]! > d.time[i - 1]!)) throw new RangeError(`ArrayBarSource: times must be strictly increasing (row ${i})`);
    this.t = Array.from(d.time);
    this.o = Array.from(d.open);
    this.h = Array.from(d.high);
    this.l = Array.from(d.low);
    this.c = Array.from(d.close);
    this.v = d.volume ? Array.from(d.volume) : new Array<number>(n).fill(0);
    this.touch();
  }

  /** Same time replaces the last bar; a later time appends. */
  update(b: Bar): void {
    const n = this.t.length;
    if (n > 0 && b.time < this.t[n - 1]!) throw new RangeError(`ArrayBarSource.update: time ${b.time} is before the last bar`);
    if (n > 0 && b.time === this.t[n - 1]) {
      this.o[n - 1] = b.open; this.h[n - 1] = b.high; this.l[n - 1] = b.low; this.c[n - 1] = b.close; this.v[n - 1] = b.volume;
    } else {
      this.t.push(b.time); this.o.push(b.open); this.h.push(b.high); this.l.push(b.low); this.c.push(b.close); this.v.push(b.volume);
    }
    this.touch();
  }

  /** Older history, all earlier than the first bar. */
  prepend(d: ColumnarBars): void {
    const n = d.time.length;
    if (n === 0) return;
    if (this.t.length && !(d.time[n - 1]! < this.t[0]!)) throw new RangeError("ArrayBarSource.prepend: bars must all be earlier than the first bar");
    const older = new ArrayBarSource(d);
    this.t = [...older.t, ...this.t];
    this.o = [...older.o, ...this.o];
    this.h = [...older.h, ...this.h];
    this.l = [...older.l, ...this.l];
    this.c = [...older.c, ...this.c];
    this.v = [...older.v, ...this.v];
    this.touch();
  }

  private touch(): void {
    this.ver++;
    this.cachedInterval = 0;
  }

  at(i: number): Bar {
    if (!(i >= 0 && i < this.t.length) || !Number.isInteger(i)) throw new RangeError(`ArrayBarSource.at: index ${i} outside 0..${this.t.length - 1}`);
    return { time: this.t[i]!, open: this.o[i]!, high: this.h[i]!, low: this.l[i]!, close: this.c[i]!, volume: this.v[i]! };
  }

  /** First index with time >= t. */
  private lower(t: number): number {
    let lo = 0, hi = this.t.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.t[m]! < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  nearest(time: number): Bar | undefined {
    const n = this.t.length;
    if (n === 0) return undefined;
    const i = this.lower(time);
    if (i === 0) return this.at(0);
    if (i === n) return this.at(n - 1);
    return time - this.t[i - 1]! <= this.t[i]! - time ? this.at(i - 1) : this.at(i);
  }

  get interval(): number {
    if (this.cachedInterval > 0) return this.cachedInterval;
    const n = this.t.length;
    if (n < 2) throw new RangeError("ArrayBarSource.interval: needs at least two bars");
    const d: number[] = [];
    for (let i = n - 1; i > 0 && d.length < 15; i--) d.push(this.t[i]! - this.t[i - 1]!);
    d.sort((a, b) => a - b);
    return (this.cachedInterval = d[d.length >> 1]!);
  }

  logical(time: number): number {
    const n = this.t.length;
    if (n === 0) throw new RangeError("ArrayBarSource.logical: no bars");
    if (n === 1) return 0;
    if (time <= this.t[0]!) return (time - this.t[0]!) / this.interval;
    if (time >= this.t[n - 1]!) return n - 1 + (time - this.t[n - 1]!) / this.interval;
    const i = this.lower(time);
    const ti = this.t[i]!;
    if (ti === time) return i;
    const tp = this.t[i - 1]!;
    return i - 1 + (time - tp) / (ti - tp);
  }

  timeAtLogical(l: number): number {
    const n = this.t.length;
    if (n === 0) throw new RangeError("ArrayBarSource.timeAtLogical: no bars");
    if (l <= 0) return this.t[0]! + l * this.interval;
    if (l >= n - 1) return this.t[n - 1]! + (l - (n - 1)) * this.interval;
    const i = Math.floor(l);
    return this.t[i]! + (l - i) * (this.t[i + 1]! - this.t[i]!);
  }

  range(from: number, to: number): [number, number] {
    const lo = this.lower(from);
    let hi = this.lower(to);
    if (hi < this.t.length && this.t[hi] === to) hi++;
    return [lo, Math.max(lo, hi)];
  }
}
