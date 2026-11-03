// TPO / market profile: one letter per price row per time period.
//
// A session is split into periods of `periodMs` (default 30 minutes) counted
// from the session start; period 0 is "A", 1 is "B" … 25 "Z", 26 "a" … 51 "z".
// A row holds a letter for every period in which it traded; the row's TPO
// count is how many such periods there are. Built from the flow's bars, so the
// flow's bar length must divide the period (checked: a bar that would straddle
// two periods throws) and the bars must carry level data.
//
// - Traded levels only: from trades, a row gets a letter only if it traded in
//   that period (no filling between the period's high and low). From bars
//   (`approximate`), every level from the bar's low to its high is assumed
//   touched, which the result says by `approximate: true`.
// - Initial balance: the price range of the first `ibPeriods` periods (default 2).
// - POC / value area: as in profile.ts but over TPO counts (70% default).
// - Single prints: runs of consecutive rows with exactly one TPO.
// - Split profiles: one TpoProfile per session. Merged: `mergeTpo` adds the
//   per-row counts of several sessions into one composite (counts only; letters
//   belong to one session's clock).

import type { FlowBars } from "./bars.js";
import type { OrderFlow } from "./flow.js";
import { pocOf, valueArea } from "./profile.js";

export const MIN_PERIOD_MS = 1000;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Letter of period p; periods past 52 have none and show "+". */
export function periodLetter(p: number): string {
  return p >= 0 && p < LETTERS.length ? LETTERS[p]! : "+";
}

export interface TpoOptions {
  periodMs?: number;
  /** Row height in ticks (default 1). */
  rowTicks?: number;
  ibPeriods?: number;
  valueAreaPct?: number;
}

export interface TpoProfile {
  readonly session: number;
  readonly start: number;
  readonly merged: boolean;
  readonly tickSize: number;
  readonly rowTicks: number;
  /** Tick index of row 0's lowest tick. */
  readonly firstTick: number;
  readonly rowCount: number;
  /** Periods in the session up to the last one with data (merged: 0). */
  readonly periods: number;
  /** TPO count per row. */
  readonly counts: Uint32Array;
  /** Period membership: rows × words bitset (split profiles only). */
  readonly bits: Uint32Array;
  readonly words: number;
  /** Row indices, -1 when empty. */
  readonly poc: number;
  readonly vaLow: number;
  readonly vaHigh: number;
  /** Initial balance prices (row edges), NaN when the session has no data. */
  readonly ibLow: number;
  readonly ibHigh: number;
  /** Runs of single-print rows as [firstRow, lastRow]. */
  readonly singlePrints: readonly (readonly [number, number])[];
  readonly approximate: boolean;
  /** Did period p put a letter on row r? */
  has(row: number, period: number): boolean;
  rowPrice(row: number): number;
  rowTopPrice(row: number): number;
}

function singles(counts: Uint32Array): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= counts.length; i++) {
    const one = i < counts.length && counts[i] === 1;
    if (one && s < 0) s = i;
    if (!one && s >= 0) {
      out.push([s, i - 1]);
      s = -1;
    }
  }
  return out;
}

function rowFns(bars: FlowBars, firstTick: number, rowTicks: number) {
  return {
    rowPrice: (r: number) => bars.priceOf(firstTick + r * rowTicks),
    rowTopPrice: (r: number) => bars.priceOf(firstTick + r * rowTicks + rowTicks - 1),
  };
}

/** TPO profile of the bars [firstBar, lastBar], which must be one session. */
export function tpoOfSession(flow: OrderFlow, firstBar: number, lastBar: number, o: TpoOptions = {}): TpoProfile {
  const bars = flow.bars;
  const sessions = bars.sessions;
  if (!sessions) throw new TypeError("orderflow: TPO needs `sessions` on the OrderFlow");
  const period = o.periodMs ?? 1_800_000;
  const rowTicks = o.rowTicks ?? 1;
  const ibPeriods = o.ibPeriods ?? 2;
  const pct = o.valueAreaPct ?? 0.7;
  if (!Number.isFinite(period) || period < MIN_PERIOD_MS) throw new RangeError(`orderflow: TPO periodMs ${period} must be >= ${MIN_PERIOD_MS}`);
  if (!Number.isInteger(rowTicks) || rowTicks < 1) throw new RangeError(`orderflow: TPO rowTicks ${rowTicks} must be a positive integer`);
  if (!Number.isInteger(ibPeriods) || ibPeriods < 1) throw new RangeError(`orderflow: TPO ibPeriods ${ibPeriods} must be a positive integer`);
  const barMs = bars.clock.periodMs;
  if (barMs === undefined) throw new TypeError("orderflow: TPO needs a fixed bar length (periodMs) to place bars in periods");
  if (period % barMs !== 0) throw new RangeError(`orderflow: TPO period ${period} ms is not a multiple of the bar length ${barMs} ms`);
  if (firstBar < 0 || lastBar >= bars.length || lastBar < firstBar) throw new RangeError(`orderflow: TPO bars [${firstBar}, ${lastBar}] outside [0, ${bars.length})`);
  const sid = bars.session[firstBar]!;
  const start = sessions.start(bars.start[firstBar]!);

  // Pass 1: row range and period count.
  let kMin = Number.POSITIVE_INFINITY, kMax = Number.NEGATIVE_INFINITY, periods = 0;
  const periodOf = (i: number): number => {
    if (bars.session[i] !== sid) throw new RangeError(`orderflow: bar ${i} is in another session than bar ${firstBar}`);
    const p = Math.floor((bars.start[i]! - start) / period);
    if (p < 0 || Math.floor((bars.start[i]! + barMs - 1 - start) / period) !== p) {
      throw new RangeError(`orderflow: bar ${i} (${bars.start[i]}) does not sit inside one ${period} ms TPO period of the session starting ${start}`);
    }
    return p;
  };
  for (let i = firstBar; i <= lastBar; i++) {
    const g = bars.grids[i]!;
    if (!g.used) continue;
    periods = Math.max(periods, periodOf(i) + 1);
    // Touched extent: the grid's own bounds are trade extremes; skip untouched edge rows.
    let lo = g.lo, hi = g.hi;
    while (lo <= hi && !g.touched(lo)) lo++;
    while (hi >= lo && !g.touched(hi)) hi--;
    if (lo < kMin) kMin = lo;
    if (hi > kMax) kMax = hi;
  }
  if (kMax < kMin) {
    return { session: sid, start, merged: false, tickSize: bars.tickSize, rowTicks, firstTick: 0, rowCount: 0, periods: 0, counts: new Uint32Array(0), bits: new Uint32Array(0), words: 0, poc: -1, vaLow: -1, vaHigh: -1, ibLow: Number.NaN, ibHigh: Number.NaN, singlePrints: [], approximate: bars.approximate, has: () => false, ...rowFns(bars, 0, rowTicks) };
  }
  const r0 = Math.floor(kMin / rowTicks), r1 = Math.floor(kMax / rowTicks), n = r1 - r0 + 1;
  const words = Math.ceil(periods / 32);
  const bits = new Uint32Array(n * words);
  let ibLo = Number.POSITIVE_INFINITY, ibHi = Number.NEGATIVE_INFINITY;
  // Pass 2: mark rows per period. An approximate bar touches every level of its range.
  for (let i = firstBar; i <= lastBar; i++) {
    const g = bars.grids[i]!;
    if (!g.used) continue;
    const p = periodOf(i), w = p >> 5, m = 1 << (p & 31);
    for (let k = g.lo; k <= g.hi; k++) {
      if (!(bars.approximate ? g.total(k) > 0 : g.touched(k))) continue;
      bits[(Math.floor(k / rowTicks) - r0) * words + w]! |= m;
      if (p < ibPeriods) {
        if (k < ibLo) ibLo = k;
        if (k > ibHi) ibHi = k;
      }
    }
  }
  const counts = new Uint32Array(n);
  for (let r = 0; r < n; r++) {
    let c = 0;
    for (let w = 0; w < words; w++) c += popcount(bits[r * words + w]!);
    counts[r] = c;
  }
  const poc = pocOf(counts);
  const [vaLow, vaHigh] = valueArea(counts, poc, pct);
  const firstTick = r0 * rowTicks;
  return {
    session: sid, start, merged: false, tickSize: bars.tickSize, rowTicks, firstTick, rowCount: n, periods, counts, bits, words,
    poc, vaLow, vaHigh,
    ibLow: ibLo <= ibHi ? bars.priceOf(ibLo) : Number.NaN,
    ibHigh: ibLo <= ibHi ? bars.priceOf(ibHi) : Number.NaN,
    singlePrints: singles(counts),
    approximate: bars.approximate,
    has: (row, period) => period < periods && row >= 0 && row < n && (bits[row * words + (period >> 5)]! & (1 << (period & 31))) !== 0,
    ...rowFns(bars, firstTick, rowTicks),
  };
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Every session in bars [lo, hi] as its own profile (the "split" view). */
export function tpoSessions(flow: OrderFlow, lo: number, hi: number, o: TpoOptions = {}): TpoProfile[] {
  const bars = flow.bars;
  const out: TpoProfile[] = [];
  const last = bars.length - 1;
  let i = Math.max(0, lo);
  // A session is always built from its own first bar, whatever part of it is in view.
  while (i > 0 && bars.session[i - 1] === bars.session[i]) i--;
  const end = Math.min(last, hi);
  while (i <= end) {
    const sid = bars.session[i]!;
    let j = i;
    while (j < last && bars.session[j + 1] === sid) j++;
    out.push(tpoOfSession(flow, i, j, o));
    i = j + 1;
  }
  return out;
}

/** The "merged" view: per-row counts of several sessions added into one composite. */
export function mergeTpo(flow: OrderFlow, parts: readonly TpoProfile[], o: TpoOptions = {}): TpoProfile {
  const bars = flow.bars;
  const live = parts.filter((p) => p.rowCount > 0);
  const rowTicks = o.rowTicks ?? parts[0]?.rowTicks ?? 1;
  for (const p of parts) if (p.rowTicks !== rowTicks) throw new RangeError("orderflow: mergeTpo needs profiles with the same rowTicks");
  if (live.length === 0) {
    return { session: -1, start: parts[0]?.start ?? Number.NaN, merged: true, tickSize: bars.tickSize, rowTicks, firstTick: 0, rowCount: 0, periods: 0, counts: new Uint32Array(0), bits: new Uint32Array(0), words: 0, poc: -1, vaLow: -1, vaHigh: -1, ibLow: Number.NaN, ibHigh: Number.NaN, singlePrints: [], approximate: bars.approximate, has: () => false, ...rowFns(bars, 0, rowTicks) };
  }
  const first = Math.min(...live.map((p) => p.firstTick));
  const top = Math.max(...live.map((p) => p.firstTick + p.rowCount * rowTicks));
  const n = (top - first) / rowTicks;
  const counts = new Uint32Array(n);
  for (const p of live) {
    const off = (p.firstTick - first) / rowTicks;
    for (let r = 0; r < p.rowCount; r++) counts[off + r]! += p.counts[r]!;
  }
  const poc = pocOf(counts);
  const [vaLow, vaHigh] = valueArea(counts, poc, o.valueAreaPct ?? 0.7);
  return {
    session: -1, start: live[0]!.start, merged: true, tickSize: bars.tickSize, rowTicks, firstTick: first, rowCount: n, periods: 0, counts, bits: new Uint32Array(0), words: 0,
    poc, vaLow, vaHigh, ibLow: Number.NaN, ibHigh: Number.NaN, singlePrints: singles(counts), approximate: bars.approximate,
    has: () => false,
    ...rowFns(bars, first, rowTicks),
  };
}
