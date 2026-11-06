// What a script's `outside(...)` calls mean to its host: the outside series it reads, named by an opaque symbol and a
// timeframe, and how each is joined onto the chart's bars (see @alphacharts/indicators engine/feed.ts for the join).
//
// The package never resolves a symbol or fetches a bar: `symbol` is a string the host understands (or none: this
// chart's own instrument), `timeframe` is a length written `<n><unit>` (or none: this chart's own). The host reads
// `compile().plan.dependencies`, loads each distinct (symbol, timeframe) as bars, and hands them over with
// `handle.setSeries(key, bars)`.

import type { FeedAlign, FeedField } from "@alphacharts/indicators";

export type { FeedField };

/** One `outside(symbol, field, timeframe)` call: `symbol` / `timeframe` are null when the script left them out (this chart's). */
export interface Dependency {
  symbol: string | null;
  field: FeedField;
  timeframe: string | null;
}

/** One outside series the host must load: a distinct (symbol, timeframe), carrying every field the script reads from it. */
export interface FeedRef {
  /** Pass to `handle.setSeries` / `handle.pushSeries`. */
  key: string;
  symbol: string | null;
  timeframe: string | null;
  fields: FeedField[];
}

const UNITS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
const TIMEFRAME = /^([1-9][0-9]{0,2})([mhdw])$/;

/** Length in ms of a timeframe like "5m", "1h", "1d", "1w", or null when it is not written that way. */
export function parseTimeframe(tf: string): number | null {
  const m = TIMEFRAME.exec(tf);
  return m ? Number(m[1]) * UNITS[m[2]!]! : null;
}

/** The key of an outside series: symbol and timeframe, either empty for "this chart's". Symbols are opaque, so the separator is an unprintable one. */
export function feedKey(symbol: string | null, timeframe: string | null): string {
  return `${symbol ?? ""}\u0001${timeframe ?? ""}`;
}

/** The distinct outside series a script reads, in order of first use, each with its fields. */
export function feedsOf(deps: readonly Dependency[]): FeedRef[] {
  const out = new Map<string, FeedRef>();
  for (const d of deps) {
    const key = feedKey(d.symbol, d.timeframe);
    let f = out.get(key);
    if (!f) out.set(key, (f = { key, symbol: d.symbol, timeframe: d.timeframe, fields: [] }));
    if (!f.fields.includes(d.field)) f.fields.push(d.field);
  }
  return [...out.values()];
}

/**
 * How an outside series on `timeframe` (null: the chart's own) joins a chart whose bars last `intervalMs`:
 * the same length joins on exact time ("same"); a longer one joins on the bar that has finished ("closed", its
 * length is the nominal bar length); a shorter one is refused, since it would have to be aggregated and a
 * silent choice of how would be a number nobody asked for.
 */
export function alignFor(timeframe: string | null, intervalMs: number): { align: FeedAlign; spanMs: number } {
  if (!(Number.isFinite(intervalMs) && intervalMs > 0)) throw new RangeError(`the chart's bar length must be a positive number of milliseconds, got ${String(intervalMs)}`);
  if (timeframe === null) return { align: "same", spanMs: intervalMs };
  const span = parseTimeframe(timeframe);
  if (span === null) throw new RangeError(`timeframe "${timeframe}" is not written like 5m, 1h, 1d or 1w`);
  if (span < intervalMs) throw new RangeError(`timeframe "${timeframe}" is shorter than the chart's bars; an outside series must be on the chart's timeframe or a longer one`);
  return span === intervalMs ? { align: "same", spanMs: span } : { align: "closed", spanMs: span };
}
