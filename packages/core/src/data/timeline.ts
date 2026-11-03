// The chart's shared time axis: the sorted union of every series' bar times,
// addressed by absolute logical index. The x axis is this index, not time, so
// gaps (nights, weekends, holidays) take no space. Prepending history lowers
// `first` instead of renumbering, so existing bars, LOD buckets and the view
// keep their indices.

import { ColumnDeque, F64_NAN } from "./deque.js";

export class Timeline {
  private readonly q = new ColumnDeque([F64_NAN]);

  get first(): number {
    return this.q.first;
  }
  /** One past the last index. */
  get end(): number {
    return this.q.end;
  }
  get length(): number {
    return this.q.length;
  }

  timeAt(index: number): number {
    if (!this.q.has(index)) throw new RangeError(`timeline index ${index} outside [${this.first}, ${this.end})`);
    return this.q.cols[0]![this.q.pos(index)]!;
  }

  /** Raw view for hot loops: element `index` is at `buf[offset + index]`. */
  raw(): { buf: Float64Array; offset: number } {
    return { buf: this.q.cols[0] as Float64Array, offset: this.q.head - this.q.first };
  }

  /** Smallest index whose time is >= t (`end` if none). */
  lowerBound(t: number): number {
    const buf = this.q.cols[0]!;
    let lo = this.q.head;
    let hi = this.q.head + this.q.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (buf[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    return lo - this.q.head + this.q.first;
  }

  /**
   * The bar containing t: the last index whose time is <= t (bar times are
   * period starts). Undefined when t is before the first bar.
   */
  indexAtOrBefore(t: number): number | undefined {
    if (this.length === 0) return undefined;
    const i = this.lowerBound(t);
    if (i < this.end && this.timeAt(i) === t) return i;
    return i > this.first ? i - 1 : undefined;
  }

  /** Index whose time is exactly t, or undefined. */
  indexOf(t: number): number | undefined {
    const i = this.lowerBound(t);
    return i < this.end && this.timeAt(i) === t ? i : undefined;
  }

  /** Replace the whole axis with strictly increasing `times`, the first at `firstIndex`. */
  replace(times: ArrayLike<number>, firstIndex: number): void {
    assertIncreasing(times, "timeline");
    this.q.clear(firstIndex);
    if (times.length === 0) return;
    this.q.cover(firstIndex, firstIndex + times.length);
    const buf = this.q.cols[0]!;
    const h = this.q.head;
    for (let i = 0; i < times.length; i++) buf[h + i] = times[i]!;
  }

  /** Add strictly increasing times, all earlier than the current first. Returns the new first. */
  prepend(times: ArrayLike<number>): number {
    if (times.length === 0) return this.first;
    assertIncreasing(times, "prepended times");
    if (this.length > 0 && times[times.length - 1]! >= this.timeAt(this.first)) {
      throw new RangeError("prepended times must be earlier than the timeline's first time");
    }
    const lo = this.first - times.length;
    this.q.cover(lo, this.end);
    const buf = this.q.cols[0]!;
    const h = this.q.head;
    for (let i = 0; i < times.length; i++) buf[h + i] = times[i]!;
    return lo;
  }

  /** Append one time later than the current last. Returns its index. */
  append(t: number): number {
    if (this.length > 0 && t <= this.timeAt(this.end - 1)) {
      throw new RangeError("appended time must be later than the timeline's last time");
    }
    const i = this.end;
    this.q.cover(this.first, i + 1);
    this.q.cols[0]![this.q.pos(i)] = t;
    return i;
  }
}

export function assertIncreasing(times: ArrayLike<number>, what: string): void {
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (!Number.isFinite(t)) throw new TypeError(`${what}: time at ${i} is not a finite number`);
    if (i > 0 && t <= times[i - 1]!) {
      throw new RangeError(`${what}: times must be strictly increasing (row ${i}: ${t} after ${times[i - 1]})`);
    }
  }
}
