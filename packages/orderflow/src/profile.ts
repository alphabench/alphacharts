// Volume profile: volume by price row over a set of trades or bars.
//
// Rows are `rowTicks` ticks tall and anchored on the absolute tick grid
// (row r covers ticks [r·rowTicks, (r+1)·rowTicks)), so a row keeps its price
// when the range changes. Row size is given in ticks, or as a row count, from
// which the tick count is derived (ceil(span / rows)).
//
// Definitions (all computed from the exact row sums):
// - Volume of a row = buy + sell + unknown. POC = the row with the most volume;
//   a tie goes to the row nearest the middle of the profile, then the lower one.
// - Value area (default 70% of total volume): from the POC, repeatedly compare
//   the volume of the next two rows above with the next two below and take the
//   larger pair (a tie takes the upper pair; at an end only the other side is
//   available) until the area holds at least `valueAreaPct` of the volume.
// - HVN: a row that is the maximum within ±peakWindow rows (a plateau counts at
//   its first row) and holds at least `hvnFraction` of the POC's volume.
//   LVN: the minimum within ±peakWindow rows, with that window fully inside the
//   profile, holding at most `lvnFraction` of the POC's volume. The POC is
//   neither.
// - Up/down split: `buy` (aggressive buyers) and `sell` per row; `unknown` is
//   volume with no side and is shown separately, never split.
//
// `approximate` is copied from the flow: true when the volume was spread over
// bar ranges instead of summed from trades.

import type { FlowBars } from "./bars.js";
import { LevelGrid } from "./levels.js";
import type { OrderFlow } from "./flow.js";

export interface ProfileOptions {
  /** Row height in ticks (default 1). Ignored when `rows` is given. */
  rowTicks?: number;
  /** Aim for this many rows: rowTicks = ceil(span / rows). */
  rows?: number;
  /** Share of volume in the value area, in (0, 1]. Default 0.7. */
  valueAreaPct?: number;
  hvnFraction?: number;
  lvnFraction?: number;
  peakWindow?: number;
}

const DEFAULTS = { valueAreaPct: 0.7, hvnFraction: 0.6, lvnFraction: 0.3, peakWindow: 2 };

export interface Profile {
  readonly tickSize: number;
  readonly rowTicks: number;
  /** Tick index of row 0's lowest tick. */
  readonly firstTick: number;
  readonly rowCount: number;
  readonly buy: Float64Array;
  readonly sell: Float64Array;
  readonly unknown: Float64Array;
  readonly total: Float64Array;
  /** Totals over all rows. */
  readonly sum: { buy: number; sell: number; unknown: number; total: number; delta: number };
  /** Row indices; -1 when the profile is empty. */
  readonly poc: number;
  readonly vaLow: number;
  readonly vaHigh: number;
  readonly hvn: readonly number[];
  readonly lvn: readonly number[];
  readonly approximate: boolean;
  /** Price of row i's lowest tick. */
  rowPrice(i: number): number;
  /** Price of row i's highest tick. */
  rowTopPrice(i: number): number;
}

/** Dense volume by tick; add/subtract bars, trades or whole grids. */
export class LevelAccumulator {
  private lo = 0;
  private cap = 0;
  private data = new Float64Array(0);
  private minK = Number.POSITIVE_INFINITY;
  private maxK = Number.NEGATIVE_INFINITY;

  private ensure(k: number): void {
    if (this.cap === 0) {
      this.cap = 64;
      this.lo = k - 32;
      this.data = new Float64Array(this.cap * 3);
      return;
    }
    if (k >= this.lo && k < this.lo + this.cap) return;
    const a = Math.min(k, this.minK), b = Math.max(k, this.maxK);
    const need = b - a + 1;
    const cap = Math.max(this.cap * 2, need * 2);
    const lo = a - Math.floor((cap - need) / 2);
    const data = new Float64Array(cap * 3);
    if (this.maxK >= this.minK) data.set(this.data.subarray((this.minK - this.lo) * 3, (this.maxK - this.lo + 1) * 3), (this.minK - lo) * 3);
    this.data = data;
    this.cap = cap;
    this.lo = lo;
  }

  add(k: number, side: number, size: number): void {
    this.ensure(k);
    if (k < this.minK) this.minK = k;
    if (k > this.maxK) this.maxK = k;
    this.data[(k - this.lo) * 3 + (side > 0 ? 0 : side < 0 ? 1 : 2)]! += size;
  }

  addGrid(g: LevelGrid, sign: 1 | -1 = 1, priceLoK = Number.NEGATIVE_INFINITY, priceHiK = Number.POSITIVE_INFINITY): void {
    g.each((k, b, s, u) => {
      if (k < priceLoK || k > priceHiK) return;
      this.ensure(k);
      if (k < this.minK) this.minK = k;
      if (k > this.maxK) this.maxK = k;
      const i = (k - this.lo) * 3;
      this.data[i]! += sign * b;
      this.data[i + 1]! += sign * s;
      this.data[i + 2]! += sign * u;
    });
  }

  clear(): void {
    this.data.fill(0);
    this.minK = Number.POSITIVE_INFINITY;
    this.maxK = Number.NEGATIVE_INFINITY;
  }

  /** Build the profile; empty when no tick holds volume. */
  build(bars: FlowBars, o: ProfileOptions = {}): Profile {
    const kMin0 = this.minK, kMax0 = this.maxK;
    let kMin = Number.POSITIVE_INFINITY, kMax = Number.NEGATIVE_INFINITY;
    for (let k = kMin0; k <= kMax0; k++) {
      const i = (k - this.lo) * 3;
      if (this.data[i]! + this.data[i + 1]! + this.data[i + 2]! > 0) {
        if (k < kMin) kMin = k;
        kMax = k;
      }
    }
    const rowTicks = resolveRowTicks(o, kMax - kMin + 1);
    const empty = kMax < kMin;
    const r0 = empty ? 0 : Math.floor(kMin / rowTicks), r1 = empty ? -1 : Math.floor(kMax / rowTicks);
    const n = r1 - r0 + 1;
    const buy = new Float64Array(n), sell = new Float64Array(n), unknown = new Float64Array(n), total = new Float64Array(n);
    for (let k = kMin; k <= kMax; k++) {
      const i = (k - this.lo) * 3, r = Math.floor(k / rowTicks) - r0;
      buy[r]! += this.data[i]!;
      sell[r]! += this.data[i + 1]!;
      unknown[r]! += this.data[i + 2]!;
    }
    return finishProfile(bars, rowTicks, r0 * rowTicks, buy, sell, unknown, total, o);
  }
}

function resolveRowTicks(o: ProfileOptions, spanTicks: number): number {
  if (o.rows !== undefined) {
    if (!Number.isInteger(o.rows) || o.rows < 1) throw new RangeError(`orderflow: rows ${o.rows} must be a positive integer`);
    return Math.max(1, Math.ceil(spanTicks / o.rows));
  }
  const r = o.rowTicks ?? 1;
  if (!Number.isInteger(r) || r < 1) throw new RangeError(`orderflow: rowTicks ${r} must be a positive integer`);
  return r;
}

export function finishProfile(bars: FlowBars, rowTicks: number, firstTick: number, buy: Float64Array, sell: Float64Array, unknown: Float64Array, total: Float64Array, o: ProfileOptions): Profile {
  const { valueAreaPct, hvnFraction, lvnFraction, peakWindow } = { ...DEFAULTS, ...stripUndefined(o) };
  if (!(valueAreaPct > 0 && valueAreaPct <= 1)) throw new RangeError(`orderflow: valueAreaPct ${valueAreaPct} must be in (0, 1]`);
  if (!Number.isInteger(peakWindow) || peakWindow < 1) throw new RangeError(`orderflow: peakWindow ${peakWindow} must be a positive integer`);
  const n = buy.length;
  let sb = 0, ss = 0, su = 0;
  for (let i = 0; i < n; i++) {
    total[i] = buy[i]! + sell[i]! + unknown[i]!;
    sb += buy[i]!;
    ss += sell[i]!;
    su += unknown[i]!;
  }
  const all = sb + ss + su;
  let poc = -1, vaLow = -1, vaHigh = -1;
  const hvn: number[] = [], lvn: number[] = [];
  if (n > 0 && all > 0) {
    poc = pocOf(total);
    [vaLow, vaHigh] = valueArea(total, poc, valueAreaPct);
    const pocVol = total[poc]!;
    for (let i = 0; i < n; i++) {
      if (i === poc) continue;
      const v = total[i]!;
      let isMax = v >= hvnFraction * pocVol, isMin = v <= lvnFraction * pocVol && i >= peakWindow && i < n - peakWindow;
      for (let j = Math.max(0, i - peakWindow); j <= Math.min(n - 1, i + peakWindow) && (isMax || isMin); j++) {
        if (j === i) continue;
        const w = total[j]!;
        // Left side strict, right side loose: a plateau reports its first row once.
        if (isMax && (j < i ? w >= v : w > v)) isMax = false;
        if (isMin && (j < i ? w <= v : w < v)) isMin = false;
      }
      if (isMax) hvn.push(i);
      if (isMin) lvn.push(i);
    }
  }
  return {
    tickSize: bars.tickSize,
    rowTicks,
    firstTick,
    rowCount: n,
    buy, sell, unknown, total,
    sum: { buy: sb, sell: ss, unknown: su, total: all, delta: sb - ss },
    poc, vaLow, vaHigh, hvn, lvn,
    approximate: bars.approximate,
    rowPrice: (i) => bars.priceOf(firstTick + i * rowTicks),
    rowTopPrice: (i) => bars.priceOf(firstTick + i * rowTicks + rowTicks - 1),
  };
}

/** Row with the most volume; a tie goes to the row nearest the middle, then the lower one. */
export function pocOf(total: ArrayLike<number>): number {
  const n = total.length, mid = (n - 1) / 2;
  let poc = 0;
  for (let i = 1; i < n; i++) {
    const d = total[i]! - total[poc]!;
    if (d > 0 || (d === 0 && Math.abs(i - mid) < Math.abs(poc - mid))) poc = i;
  }
  return poc;
}

/** [low, high] row indices of the value area around `poc`: see the header for the rule. */
export function valueArea(total: ArrayLike<number>, poc: number, pct: number): [number, number] {
  const n = total.length;
  let all = 0;
  for (let i = 0; i < n; i++) all += total[i]!;
  let lo = poc, hi = poc, acc = total[poc]!;
  const target = all * pct;
  while (acc < target && (lo > 0 || hi < n - 1)) {
    const up1 = hi + 1 < n ? total[hi + 1]! : 0, up2 = hi + 2 < n ? total[hi + 2]! : 0;
    const dn1 = lo - 1 >= 0 ? total[lo - 1]! : 0, dn2 = lo - 2 >= 0 ? total[lo - 2]! : 0;
    if (hi < n - 1 && (lo === 0 || up1 + up2 >= dn1 + dn2)) {
      acc += up1 + up2;
      hi = Math.min(n - 1, hi + 2);
    } else {
      acc += dn1 + dn2;
      lo = Math.max(0, lo - 2);
    }
  }
  return [lo, hi];
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---- bar ranges ----------------------------------------------------------------

/** Profile over bars [lo, hi] inclusive (clamped); exact sums of their levels. */
export function profileOfBars(bars: FlowBars, lo: number, hi: number, o: ProfileOptions = {}): Profile {
  const acc = new LevelAccumulator();
  for (let i = Math.max(0, lo); i <= Math.min(bars.length - 1, hi); i++) acc.addGrid(bars.grids[i]!);
  return acc.build(bars, o);
}

export interface SessionProfile {
  /** bars.version when built; an open session is rebuilt when it differs. */
  readonly version: number;
  readonly session: number;
  /** UTC ms the session starts. */
  readonly start: number;
  /** Bar index range [firstBar, lastBar] of the session. */
  readonly firstBar: number;
  readonly lastBar: number;
  readonly profile: Profile;
}

/**
 * One profile per session (flow.bars.sessions must be set). Sessions that have
 * ended never change (trades arrive in time order), so they are cached; the
 * last one is rebuilt when the flow changed.
 */
export class SessionProfiles {
  private cache = new Map<number, SessionProfile>();
  private key = "";

  constructor(private readonly flow: OrderFlow, private options: ProfileOptions = {}) {
    if (!flow.bars.sessions) throw new TypeError("orderflow: session profiles need `sessions` on the OrderFlow");
  }

  setOptions(o: ProfileOptions): void {
    this.options = o;
  }

  /** Profiles of every session intersecting bars [lo, hi]. */
  range(lo: number, hi: number): SessionProfile[] {
    const bars = this.flow.bars;
    const key = JSON.stringify(this.options);
    if (key !== this.key) {
      this.cache.clear();
      this.key = key;
    }
    const out: SessionProfile[] = [];
    const last = bars.length - 1;
    let i = Math.max(0, lo);
    // A session is always summed from its own first bar, whatever part of it is in view.
    while (i > 0 && bars.session[i - 1] === bars.session[i]) i--;
    const end = Math.min(last, hi);
    while (i <= end) {
      const sid = bars.session[i]!;
      let j = i;
      while (j < last && bars.session[j + 1] === sid) j++;
      const closed = j < last;
      let sp = this.cache.get(sid);
      if (!sp || sp.firstBar !== i || sp.lastBar !== j || (!closed && sp.version !== bars.version)) {
        sp = { version: bars.version, session: sid, start: bars.sessions!.start(bars.start[i]!), firstBar: i, lastBar: j, profile: profileOfBars(bars, i, j, this.options) };
        this.cache.set(sid, sp);
      }
      out.push(sp);
      i = j + 1;
    }
    return out;
  }
}

/**
 * Profile of the bars in view. Moving the view adds the bars that came in and
 * subtracts the ones that left instead of re-summing the range; that stays
 * exact because the sums are whole numbers (checked: `integerSizes`), otherwise
 * every change re-sums. The newest bar is never kept in the running sum (it
 * changes with every trade); it is added and removed around each build.
 */
export class VisibleProfile {
  private acc = new LevelAccumulator();
  private a = 0;
  private b = -1;
  private cached: Profile | null = null;
  private cachedKey = "";

  constructor(private readonly flow: OrderFlow, private options: ProfileOptions = {}) {}

  setOptions(o: ProfileOptions): void {
    this.options = o;
    this.cachedKey = "";
  }

  /** Profile of bars [lo, hi] inclusive. */
  update(lo: number, hi: number): Profile {
    const bars = this.flow.bars;
    lo = Math.max(0, lo);
    hi = Math.min(bars.length - 1, hi);
    const key = `${lo}:${hi}:${bars.version}:${JSON.stringify(this.options)}`;
    if (key === this.cachedKey && this.cached) return this.cached;
    const tail = bars.length - 1;
    const incl = Math.min(hi, tail - 1); // bars [lo, incl] live in the running sum
    if (!bars.integerSizes || this.b > tail - 1 || lo > hi) {
      this.acc.clear();
      this.a = 0;
      this.b = -1;
    }
    if (bars.integerSizes && lo <= hi) {
      if (this.b < this.a || incl < lo || lo > this.b || incl < this.a) {
        // Disjoint from what is summed: start over.
        this.acc.clear();
        for (let i = lo; i <= incl; i++) this.acc.addGrid(bars.grids[i]!);
      } else {
        for (let i = this.a; i < lo; i++) this.acc.addGrid(bars.grids[i]!, -1);
        for (let i = lo; i < this.a; i++) this.acc.addGrid(bars.grids[i]!);
        for (let i = incl + 1; i <= this.b; i++) this.acc.addGrid(bars.grids[i]!, -1);
        for (let i = this.b + 1; i <= incl; i++) this.acc.addGrid(bars.grids[i]!);
      }
      this.a = lo;
      this.b = incl;
      const withTail = hi === tail && tail >= lo;
      if (withTail) this.acc.addGrid(bars.grids[tail]!);
      this.cached = this.acc.build(bars, this.options);
      if (withTail) this.acc.addGrid(bars.grids[tail]!, -1);
    } else {
      const fresh = new LevelAccumulator();
      for (let i = lo; i <= hi; i++) fresh.addGrid(bars.grids[i]!);
      this.cached = fresh.build(bars, this.options);
    }
    this.cachedKey = key;
    return this.cached;
  }
}

export interface FixedRange {
  /** Trades with from <= time < to. */
  from: number;
  to: number;
  /** Only prices in [priceLow, priceHigh] (inclusive, on the tick grid) count; both optional. */
  priceLow?: number;
  priceHigh?: number;
}

/**
 * Profile of a time + price anchored range. With the raw trades kept it is
 * exact for any from/to; without them (or from bars) the range must start and
 * end on bar starts, or this throws rather than guess.
 */
export function fixedRangeProfile(flow: OrderFlow, r: FixedRange, o: ProfileOptions = {}): Profile {
  if (!(r.to > r.from)) throw new RangeError(`orderflow: fixed range [${r.from}, ${r.to}) is empty`);
  const bars = flow.bars;
  const kLo = r.priceLow === undefined ? Number.NEGATIVE_INFINITY : bars.tickOf(r.priceLow, "priceLow");
  const kHi = r.priceHigh === undefined ? Number.POSITIVE_INFINITY : bars.tickOf(r.priceHigh, "priceHigh");
  if (kHi < kLo) throw new RangeError("orderflow: fixed range priceHigh is below priceLow");
  const acc = new LevelAccumulator();
  const st = flow.store;
  if (st) {
    for (let i = st.lowerBound(r.from), n = st.lowerBound(r.to); i < n; i++) {
      const k = Math.round(st.price(i) / bars.tickSize);
      if (k >= kLo && k <= kHi) acc.add(k, st.side(i), st.size(i));
    }
  } else {
    if (bars.clock.barStart(r.from) !== r.from || bars.clock.barStart(r.to) !== r.to) {
      throw new RangeError("orderflow: without raw trades a fixed range must start and end on bar boundaries");
    }
    for (let i = bars.lowerBoundStart(r.from), n = bars.lowerBoundStart(r.to); i < n; i++) acc.addGrid(bars.grids[i]!, 1, kLo, kHi);
  }
  return acc.build(bars, o);
}
