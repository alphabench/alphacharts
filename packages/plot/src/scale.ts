// Position scales. Continuous ones map a domain to a pixel range and make nice
// ticks (the core's 1-2-2.5-5 steps; calendar boundaries for time); band and
// point scales map categories.

import { civilFromLocal, DAY_MS, localFromCivil, niceStep, niceTicks, TimeZone } from "@alphacharts/core";

export type ScaleKind = "linear" | "log" | "time" | "band" | "point";

export interface ContinuousScale {
  readonly kind: "linear" | "log" | "time";
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  map(v: number): number;
  invert(px: number): number;
  /** About `count` tick values inside the domain. */
  ticks(count: number): number[];
  withRange(range: readonly [number, number]): ContinuousScale;
  withDomain(domain: readonly [number, number]): ContinuousScale;
}

/** A domain rounded out to tick values (equal ends are opened up first). */
export function niceDomain(lo: number, hi: number, count: number): [number, number] {
  if (!(lo <= hi)) throw new RangeError(`domain [${lo}, ${hi}] is not ordered`);
  if (lo === hi) {
    const d = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= d;
    hi += d;
  }
  const step = niceStep((hi - lo) / Math.max(1, count), 0);
  const n0 = Math.floor(lo / step + 1e-9), n1 = Math.ceil(hi / step - 1e-9);
  return [round(n0 * step, step), round(n1 * step, step)];
}

function round(v: number, step: number): number {
  const d = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  return +v.toFixed(Math.min(d, 15));
}

export class LinearScale implements ContinuousScale {
  constructor(readonly domain: readonly [number, number], readonly range: readonly [number, number] = [0, 1], readonly kind: "linear" | "time" = "linear") {}
  map(v: number): number {
    const [d0, d1] = this.domain, [r0, r1] = this.range;
    return d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  }
  invert(px: number): number {
    const [d0, d1] = this.domain, [r0, r1] = this.range;
    return r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * (d1 - d0);
  }
  ticks(count: number): number[] {
    const [a, b] = this.domain;
    return niceTicks(Math.min(a, b), Math.max(a, b), count).ticks;
  }
  withRange(range: readonly [number, number]): ContinuousScale {
    return new LinearScale(this.domain, range);
  }
  withDomain(domain: readonly [number, number]): ContinuousScale {
    return new LinearScale(domain, this.range);
  }
}

export class LogScale implements ContinuousScale {
  readonly kind = "log";
  constructor(readonly domain: readonly [number, number], readonly range: readonly [number, number] = [0, 1], readonly base = 10) {
    if (!(domain[0] > 0) || !(domain[1] > 0)) throw new RangeError(`a log scale needs a positive domain, got [${domain[0]}, ${domain[1]}]`);
    if (!(base > 1)) throw new RangeError(`log base must exceed 1, got ${base}`);
  }
  private lg(v: number): number {
    return Math.log(v) / Math.log(this.base);
  }
  map(v: number): number {
    const a = this.lg(this.domain[0]), b = this.lg(this.domain[1]), [r0, r1] = this.range;
    return b === a ? (r0 + r1) / 2 : r0 + ((this.lg(v) - a) / (b - a)) * (r1 - r0);
  }
  invert(px: number): number {
    const a = this.lg(this.domain[0]), b = this.lg(this.domain[1]), [r0, r1] = this.range;
    return this.base ** (r1 === r0 ? a : a + ((px - r0) / (r1 - r0)) * (b - a));
  }
  ticks(count: number): number[] {
    const lo = Math.min(...this.domain), hi = Math.max(...this.domain);
    const decades = this.lg(hi) - this.lg(lo);
    const mantissas = this.base !== 10 ? [1] : decades * 9 <= count ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : decades * 3 <= count ? [1, 2, 5] : [1];
    const every = Math.max(1, Math.ceil(decades / Math.max(1, count)));
    const out: number[] = [];
    for (let e = Math.floor(this.lg(lo)); e <= Math.ceil(this.lg(hi)) && out.length < 200; e++) {
      if (mantissas.length === 1 && e % every !== 0) continue;
      for (const m of mantissas) {
        const v = +(m * this.base ** e).toPrecision(12);
        if (v >= lo * (1 - 1e-12) && v <= hi * (1 + 1e-12)) out.push(v);
      }
    }
    return out;
  }
  withRange(range: readonly [number, number]): ContinuousScale {
    return new LogScale(this.domain, range, this.base);
  }
  withDomain(domain: readonly [number, number]): ContinuousScale {
    return new LogScale(domain, this.range, this.base);
  }
}

// ---- time ------------------------------------------------------------------

type Step = { ms: number } | { months: number };

const LADDER: readonly Step[] = [
  { ms: 1000 }, { ms: 5000 }, { ms: 15_000 }, { ms: 30_000 },
  { ms: 60_000 }, { ms: 5 * 60_000 }, { ms: 15 * 60_000 }, { ms: 30 * 60_000 },
  { ms: 3_600_000 }, { ms: 3 * 3_600_000 }, { ms: 6 * 3_600_000 }, { ms: 12 * 3_600_000 },
  { ms: DAY_MS }, { ms: 2 * DAY_MS }, { ms: 7 * DAY_MS }, { ms: 14 * DAY_MS },
  { months: 1 }, { months: 3 }, { months: 6 }, { months: 12 }, { months: 24 }, { months: 60 }, { months: 120 }, { months: 240 }, { months: 600 },
];
const MONDAY_OFFSET = 4 * DAY_MS; // 1970-01-01 was a Thursday.

function stepMs(s: Step): number {
  return "ms" in s ? s.ms : s.months * 30.4375 * DAY_MS;
}

/** The ladder step whose tick count over `span` is closest to `count` from below. */
export function timeStep(span: number, count: number): Step {
  const want = span / Math.max(1, count);
  for (const s of LADDER) if (stepMs(s) >= want) return s;
  return LADDER[LADDER.length - 1]!;
}

/** Calendar tick instants (UTC ms) inside [t0, t1] on the zone's wall clock. */
export function timeTickValues(t0: number, t1: number, count: number, tz: TimeZone): number[] {
  if (!(t1 > t0)) return [];
  const step = timeStep(t1 - t0, count);
  const out: number[] = [];
  const l0 = t0 + tz.offset(t0), l1 = t1 + tz.offset(t1);
  if ("ms" in step) {
    const weekly = step.ms % (7 * DAY_MS) === 0;
    const origin = weekly ? MONDAY_OFFSET : 0;
    for (let l = Math.ceil((l0 - origin) / step.ms) * step.ms + origin; l <= l1 && out.length < 400; l += step.ms) {
      const t = tz.fromLocal(l);
      if (t >= t0 && t <= t1) out.push(t);
    }
    return out;
  }
  const c0 = civilFromLocal(l0);
  const n = step.months;
  // Months counted from year 0 so quarter, half-year and multi-year steps align to the calendar.
  let m = Math.ceil((c0.year * 12 + (c0.month - 1)) / n) * n;
  for (; out.length < 400; m += n) {
    const year = Math.floor(m / 12), month = (m % 12) + 1;
    const t = tz.fromLocal(localFromCivil(year, month, 1));
    if (t > t1) break;
    if (t >= t0) out.push(t);
  }
  return out;
}

export class TimeScale extends LinearScale {
  constructor(domain: readonly [number, number], range: readonly [number, number] = [0, 1], readonly tz: TimeZone = new TimeZone("UTC")) {
    super(domain, range, "time");
  }
  override ticks(count: number): number[] {
    return timeTickValues(Math.min(...this.domain), Math.max(...this.domain), count, this.tz);
  }
  override withRange(range: readonly [number, number]): ContinuousScale {
    return new TimeScale(this.domain, range, this.tz);
  }
  override withDomain(domain: readonly [number, number]): ContinuousScale {
    return new TimeScale(domain, this.range, this.tz);
  }
}

/** Axis text for a time tick: the year at a year boundary, the month at a month boundary, and so on. */
export function timeTickLabel(t: number, tz: TimeZone, locale: string | undefined, fmt: TimeFormats): string {
  const c = tz.civil(t);
  const midnight = c.hour === 0 && c.minute === 0 && c.second === 0;
  if (midnight && c.month === 1 && c.day === 1) return fmt.year.format(t);
  if (midnight && c.day === 1) return fmt.month.format(t);
  if (midnight) return fmt.day.format(t);
  return c.second === 0 ? fmt.hm.format(t) : fmt.hms.format(t);
}

export interface TimeFormats {
  year: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
  day: Intl.DateTimeFormat;
  hm: Intl.DateTimeFormat;
  hms: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  datetime: Intl.DateTimeFormat;
}

export function timeFormats(locale: string | undefined, tzId: string): TimeFormats {
  const timeZone = tzId;
  return {
    year: new Intl.DateTimeFormat(locale, { timeZone, year: "numeric" }),
    month: new Intl.DateTimeFormat(locale, { timeZone, month: "short" }),
    day: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }),
    hm: new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    hms: new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }),
    date: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }),
    datetime: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

// ---- band / point ----------------------------------------------------------

export interface BandOptions {
  /** Fraction of a step before the first and after the last band. */
  paddingOuter?: number;
  /** Fraction of a step between bands. */
  paddingInner?: number;
}

export class BandScale {
  readonly kind: "band" | "point";
  readonly step: number;
  readonly bandwidth: number;
  private readonly start: number;
  private readonly index = new Map<string, number>();
  /** Domain values that are all finite numbers, in order, or null. */
  private readonly numeric: number[] | null;

  constructor(readonly domain: readonly string[], readonly range: readonly [number, number], opts: BandOptions = {}, kind: "band" | "point" = "band", readonly reverse = false) {
    this.kind = kind;
    const n = domain.length;
    const inner = kind === "point" ? 1 : Math.min(1, Math.max(0, opts.paddingInner ?? 0.2));
    const outer = Math.max(0, opts.paddingOuter ?? (kind === "point" ? 0.5 : inner / 2));
    const [r0, r1] = range;
    const span = r1 - r0;
    const units = Math.max(1, n - inner + 2 * outer);
    this.step = span / units;
    this.bandwidth = this.step * (1 - inner);
    this.start = r0 + this.step * outer;
    domain.forEach((d, i) => this.index.set(d, reverse ? n - 1 - i : i));
    const nums = domain.map((d) => (d.trim() === "" ? NaN : Number(d)));
    this.numeric = nums.length > 1 && nums.every(Number.isFinite) ? nums : null;
  }

  has(cat: string): boolean {
    return this.index.has(cat);
  }
  /** Start of the band (its low edge in range direction). */
  map(cat: string): number {
    const i = this.index.get(cat);
    if (i === undefined) return NaN;
    return this.start + i * this.step;
  }
  center(cat: string): number {
    return this.map(cat) + this.bandwidth / 2;
  }
  /** Position of a number between numeric categories (interpolated between neighbours, clamped at the ends). */
  centerOfNumber(v: number): number {
    const nums = this.numeric;
    if (!nums) return NaN;
    const n = nums.length;
    const asc = nums[n - 1]! >= nums[0]!;
    const at = (i: number) => this.center(this.domain[i]!);
    for (let i = 0; i < n - 1; i++) {
      const a = nums[i]!, b = nums[i + 1]!;
      if ((asc && v >= a && v <= b) || (!asc && v <= a && v >= b)) return b === a ? at(i) : at(i) + ((v - a) / (b - a)) * (at(i + 1) - at(i));
    }
    const first = asc ? v < nums[0]! : v > nums[0]!;
    return first ? at(0) : at(n - 1);
  }
  /** Category whose band contains (or is nearest to) the pixel. */
  invert(px: number): string | undefined {
    const n = this.domain.length;
    if (n === 0) return undefined;
    const i = Math.min(n - 1, Math.max(0, Math.floor((px - this.start + (this.step - this.bandwidth) / 2) / this.step)));
    return this.domain[this.reverse ? n - 1 - i : i];
  }
}
