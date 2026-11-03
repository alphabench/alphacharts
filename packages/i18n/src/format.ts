// Locale formatting on top of Intl. Rules that hold for every helper here:
//
// - Numbers are never altered. Only digits, grouping and separators change by
//   locale, and `parseNumber(formatNumber(x))` gives back x exactly.
// - Latin digits by default, in every locale (traders compare figures across
//   screens and brokers); native digits are an explicit option.
// - Dates use the Gregorian calendar whatever the locale's default (ar-SA
//   would otherwise print Hijri dates against Gregorian bars).
// - Non-finite numbers throw; a chart never wants "NaN" in a price label.

export type Direction = "ltr" | "rtl";

const RTL_LANGUAGES = new Set(["ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"]);
const RTL_SCRIPTS = new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm"]);

/** Text direction of a locale: "rtl" for Arabic, Hebrew, Persian, Urdu (and kin). */
export function dir(locale: string): Direction {
  let loc: Intl.Locale;
  try {
    loc = new Intl.Locale(locale);
  } catch {
    throw new RangeError(`i18n: invalid locale "${locale}"`);
  }
  if (loc.script) return RTL_SCRIPTS.has(loc.script) ? "rtl" : "ltr";
  if (RTL_LANGUAGES.has(loc.language)) return "rtl";
  return RTL_SCRIPTS.has(loc.maximize().script ?? "") ? "rtl" : "ltr";
}

/** True for locales that group and abbreviate the Indian way (lakh, crore). */
export function usesIndianNumbering(locale: string): boolean {
  const l = new Intl.Locale(locale);
  return l.region === "IN" || l.language === "hi";
}

// Numbering system a language writes its own digits in. Only used when asked for.
const NATIVE_DIGITS: Record<string, string> = {
  ar: "arab", fa: "arabext", ur: "arabext", ps: "arabext", hi: "deva", mr: "deva", ne: "deva",
  bn: "beng", gu: "gujr", pa: "guru", ta: "tamldec", te: "telu", kn: "knda", ml: "mlym", my: "mymr", th: "thai",
};

export function nativeNumberingSystem(locale: string): string {
  return NATIVE_DIGITS[new Intl.Locale(locale).language] ?? "latn";
}

export interface NumberOptions {
  /** Native digits of the locale's language (Devanagari, Arabic-Indic, …) instead of Latin. */
  nativeDigits?: boolean;
  /** Group digits (default true). */
  grouping?: boolean;
  /** Fixed number of fraction digits. Default: exactly as many as the value needs. */
  fractionDigits?: number;
  /** Cap on fraction digits; the value is rounded to it (lossy by request). */
  maxFractionDigits?: number;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(o);
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, o);
    if (nfCache.size > 500) nfCache.clear();
    nfCache.set(key, f);
  }
  return f;
}

/** Fraction digits needed to write v exactly (from its shortest round-trip text). */
export function fractionDigitsOf(v: number): number {
  const s = Math.abs(v).toExponential(); // shortest digits: "1.2345e-7"
  const [mant, exp] = s.split("e") as [string, string];
  const mantDecimals = (mant.split(".")[1] ?? "").length;
  return Math.max(0, mantDecimals - Number(exp));
}

function numbering(locale: string, native: boolean | undefined): string {
  return native ? nativeNumberingSystem(locale) : "latn";
}

export function formatNumber(value: number, locale: string, o: NumberOptions = {}): string {
  if (!Number.isFinite(value)) throw new RangeError(`i18n: cannot format ${value}`);
  const exact = o.fractionDigits === undefined && o.maxFractionDigits === undefined;
  const fd = o.fractionDigits ?? Math.min(o.maxFractionDigits ?? Infinity, fractionDigitsOf(value));
  if (fd > 100) throw new RangeError("i18n: at most 100 fraction digits");
  return nf(locale, {
    numberingSystem: numbering(locale, o.nativeDigits),
    useGrouping: o.grouping ?? true,
    minimumFractionDigits: o.fractionDigits !== undefined ? fd : exact ? fd : 0,
    maximumFractionDigits: fd,
  }).format(value);
}

interface Symbols {
  group: string;
  decimal: string;
  minus: string[];
}
const symCache = new Map<string, Symbols>();

function symbolsFor(locale: string, system: string): Symbols {
  const key = `${locale}\u0000${system}`;
  let s = symCache.get(key);
  if (s) return s;
  let group = "", decimal = ".";
  const minus = ["-", "\u2212"];
  for (const p of new Intl.NumberFormat(locale, { numberingSystem: system, maximumFractionDigits: 1 }).formatToParts(-1234567.5)) {
    if (p.type === "group") group += p.value;
    else if (p.type === "decimal") decimal = p.value;
    else if (p.type === "minusSign") minus.push(p.value);
  }
  s = { group, decimal, minus };
  symCache.set(key, s);
  return s;
}

let digitMap: Map<string, string> | undefined;
/** Every digit character of every numbering system we write natively → its Latin digit. */
function digits(): Map<string, string> {
  if (digitMap) return digitMap;
  digitMap = new Map();
  for (const sys of new Set(["latn", ...Object.values(NATIVE_DIGITS)])) {
    const f = new Intl.NumberFormat("en", { numberingSystem: sys, useGrouping: false });
    for (let d = 0; d < 10; d++) digitMap.set(f.format(d), String(d));
  }
  return digitMap;
}

/** Inverse of formatNumber: Latin or native digits, the locale's grouping and decimal marks. Throws on anything else. */
export function parseNumber(text: string, locale: string): number {
  const bad = (): never => {
    throw new RangeError(`i18n: cannot parse "${text}" as a number in ${locale}`);
  };
  const dm = digits();
  // Native digits bring the locale's native separators; Latin digits the Latin ones.
  const native = [...text].some((c) => dm.has(c) && !/[0-9]/.test(c));
  const sym = symbolsFor(locale, native ? nativeNumberingSystem(locale) : "latn");
  // Bidi marks are layout, not content.
  const t = text.replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, "").trim();
  let out = "";
  let sign = "";
  for (const ch of t) {
    const d = dm.get(ch);
    if (d !== undefined) out += d;
    else if (ch === sym.decimal) out += ".";
    else if (sym.group.includes(ch) || /\s/.test(ch)) continue;
    else if (sym.minus.includes(ch) && out === "" && sign === "") sign = "-";
    else bad();
  }
  if (!/^\d+(\.\d+)?$/.test(out)) bad();
  return Number(sign + out);
}

export interface VolumeOptions {
  nativeDigits?: boolean;
  /** Suffix text per step (catalogue: unit.volume.*). Defaults to K/L/Cr and K/M/B/T. */
  suffixes?: Partial<Record<"k" | "l" | "cr" | "m" | "b" | "t", string>>;
}

/** Abbreviated volume: K/L/Cr for Indian locales (as the core writes them), K/M/B/T elsewhere. Lossy by design: 2 fraction digits. */
export function formatVolume(value: number, locale: string, o: VolumeOptions = {}): string {
  if (!Number.isFinite(value)) throw new RangeError(`i18n: cannot format ${value}`);
  const sfx = { k: "K", l: "L", cr: "Cr", m: "M", b: "B", t: "T", ...o.suffixes };
  const steps: [number, string][] = usesIndianNumbering(locale)
    ? [[1e7, sfx.cr], [1e5, sfx.l], [1e3, sfx.k]]
    : [[1e12, sfx.t], [1e9, sfx.b], [1e6, sfx.m], [1e3, sfx.k]];
  const a = Math.abs(value);
  for (const [div, suffix] of steps) {
    if (a >= div) return `${formatNumber(value / div, locale, { maxFractionDigits: 2, nativeDigits: o.nativeDigits === true })}${suffix}`;
  }
  return formatNumber(value, locale, { maxFractionDigits: 2, nativeDigits: o.nativeDigits === true });
}

/** A value that is already a percentage (12.5 → "12.5%"); not divided by 100. */
export function formatPercent(value: number, locale: string, o: NumberOptions = {}): string {
  if (!Number.isFinite(value)) throw new RangeError(`i18n: cannot format ${value}`);
  const fd = o.fractionDigits ?? Math.min(o.maxFractionDigits ?? Infinity, fractionDigitsOf(value));
  return nf(locale, {
    style: "unit",
    unit: "percent",
    numberingSystem: numbering(locale, o.nativeDigits),
    useGrouping: o.grouping ?? true,
    minimumFractionDigits: o.fractionDigits !== undefined ? fd : fd,
    maximumFractionDigits: fd,
  }).format(value);
}

export type DateStyle = "none" | "short" | "medium" | "long" | "weekday";
export type TimeStyle = "none" | "minutes" | "seconds";

export interface DateTimeOptions {
  /** "UTC" or an IANA zone. Required: a time without a zone is a bug. */
  timeZone: string;
  date?: DateStyle;
  time?: TimeStyle;
  /** Default: the locale's. */
  hourCycle?: "h12" | "h23";
  nativeDigits?: boolean;
}

const dfCache = new Map<string, Intl.DateTimeFormat>();

/** `ms` is UTC milliseconds, as everywhere in the charts. */
export function formatDateTime(ms: number, locale: string, o: DateTimeOptions): string {
  if (!Number.isFinite(ms)) throw new RangeError(`i18n: cannot format time ${ms}`);
  const date = o.date ?? "medium", time = o.time ?? "minutes";
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: o.timeZone,
    calendar: "gregory",
    numberingSystem: numbering(locale, o.nativeDigits),
  };
  if (date === "short") Object.assign(opts, { day: "2-digit", month: "2-digit", year: "numeric" });
  else if (date === "medium") Object.assign(opts, { day: "numeric", month: "short", year: "numeric" });
  else if (date === "long") Object.assign(opts, { day: "numeric", month: "long", year: "numeric" });
  else if (date === "weekday") Object.assign(opts, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (time !== "none") Object.assign(opts, { hour: "2-digit", minute: "2-digit", ...(time === "seconds" ? { second: "2-digit" } : {}) });
  if (time !== "none") {
    if (o.hourCycle) opts.hourCycle = o.hourCycle;
  }
  if (date === "none" && time === "none") throw new RangeError("i18n: formatDateTime needs a date or a time");
  const key = locale + JSON.stringify(opts);
  let f = dfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    if (dfCache.size > 200) dfCache.clear();
    dfCache.set(key, f);
  }
  return f.format(ms);
}

/** "in 5 minutes", "2 hours ago": the largest unit that keeps the count at 1 or more. */
export function formatRelative(seconds: number, locale: string, o: { nativeDigits?: boolean } = {}): string {
  if (!Number.isFinite(seconds)) throw new RangeError(`i18n: cannot format ${seconds}`);
  const a = Math.abs(seconds);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    a >= 86_400 ? [seconds / 86_400, "day"] : a >= 3600 ? [seconds / 3600, "hour"] : a >= 60 ? [seconds / 60, "minute"] : [seconds, "second"];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto", numberingSystem: numbering(locale, o.nativeDigits) } as Intl.RelativeTimeFormatOptions).format(Math.trunc(value), unit);
}

/** The countdown clock under the last price: "05:09", "1:02:03", digits per option, zero-padded. */
export function formatClock(totalSeconds: number, locale: string, o: { nativeDigits?: boolean } = {}): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) throw new RangeError(`i18n: cannot format a clock of ${totalSeconds} seconds`);
  const sec = Math.floor(totalSeconds);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const two = nf(locale, { numberingSystem: numbering(locale, o.nativeDigits), minimumIntegerDigits: 2, useGrouping: false });
  const one = nf(locale, { numberingSystem: numbering(locale, o.nativeDigits), useGrouping: false });
  return hh > 0 ? `${one.format(hh)}:${two.format(mm)}:${two.format(ss)}` : `${two.format(mm)}:${two.format(ss)}`;
}

export function formatList(items: readonly string[], locale: string, type: "conjunction" | "disjunction" | "unit" = "conjunction"): string {
  return new Intl.ListFormat(locale, { style: "long", type }).format(items);
}
