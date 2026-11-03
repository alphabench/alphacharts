// Intervals: the shell's strings are the core's resolution strings ("5m",
// "75m", "3h", "2D", "1W", "3M"; "m" is a minute, "M" a month). parseResolution
// is the only parser; this module adds the canonical form, the limits of a
// custom value, labels, and the identifier drawings use for per-interval
// visibility.

import { parseResolution, type Resolution, type ResolutionUnit } from "@alphacharts/core";

export const PRESET_INTERVALS: readonly string[] = ["1s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "45m", "1h", "2h", "4h", "1D", "1W", "1M"];
export const DEFAULT_FAVOURITE_INTERVALS: readonly string[] = ["1m", "5m", "15m", "1h", "1D"];

/** Largest custom count per unit. */
export const MAX_COUNT: Readonly<Record<ResolutionUnit, number>> = { s: 59, m: 1439, h: 23, D: 365, W: 52, M: 12 };
export const UNITS: readonly ResolutionUnit[] = ["s", "m", "h", "D", "W", "M"];

const UNIT_KEY = { s: "second", m: "minute", h: "hour", D: "day", W: "week", M: "month" } as const;

/** Canonical text of a resolution: "75" -> "75m", "D" -> "1D". Throws on anything parseResolution or the limits refuse. */
export function normalizeInterval(text: string): string {
  const r = parseResolution(text);
  if (r.n > MAX_COUNT[r.unit]) throw new RangeError(`interval "${text}": at most ${MAX_COUNT[r.unit]} for the unit ${r.unit}`);
  return `${r.n}${r.unit}`;
}

/** Validates the two fields of the custom-interval form. Returns the interval or the message key's maximum. */
export function customInterval(value: string, unit: ResolutionUnit): { ok: true; interval: string } | { ok: false; max: number } {
  const max = MAX_COUNT[unit];
  if (!/^\d+$/.test(value.trim())) return { ok: false, max };
  const n = Number(value);
  if (!(n >= 1) || n > max) return { ok: false, max };
  return { ok: true, interval: `${n}${unit}` };
}

export function parseInterval(i: string): Resolution {
  return parseResolution(i);
}

export function unitKey(u: ResolutionUnit): "second" | "minute" | "hour" | "day" | "week" | "month" {
  return UNIT_KEY[u];
}

const MS = { s: 1000, m: 60_000, h: 3_600_000, D: 86_400_000, W: 7 * 86_400_000, M: 30 * 86_400_000 } as const;

/**
 * An identifier for the interval in the unit the drawings plugin keys
 * visibility on (bar length in ms). A month is 30 days here: it only has to be
 * the same number every time for the same interval, it is never shown or used
 * as a duration.
 */
export function intervalId(i: string): number {
  const r = parseResolution(i);
  return r.n * MS[r.unit];
}

/** True for intervals built from trades-free time buckets the core can resample (all of them). */
export function isIntraday(i: string): boolean {
  const u = parseResolution(i).unit;
  return u === "s" || u === "m" || u === "h";
}

export function sortIntervals(list: readonly string[]): string[] {
  return [...list].sort((a, b) => intervalId(a) - intervalId(b));
}
