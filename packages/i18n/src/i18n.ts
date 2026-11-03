// The message catalogue runtime: typed keys, ICU formatting, lazy locales,
// locale-change events.
//
// English is the schema and is always loaded. Everything else is a Catalogue
// registered up front (`messages`) or fetched on demand (`load`, see
// `setLocale`). Failure policy:
//
// - A key that is not in the English schema always throws (a typo).
// - A key missing from the active locale's catalogue throws, unless the
//   `fallback` locale option was given. Falling back is explicit and visible:
//   `onFallback` is called for every message served from the fallback.
// - Using a locale that was never loaded throws; load it with setLocale first.

import { en, type Catalogue, type MessageKey } from "./locales/en.js";
import { formatNodes, parseMessage, type MessageValues, type Node } from "./icu.js";
import {
  dir as dirOf, formatClock, formatDateTime, formatList, formatNumber, formatPercent, formatRelative, formatVolume, usesIndianNumbering,
  type DateTimeOptions, type Direction, type NumberOptions,
} from "./format.js";

export type { Catalogue, MessageKey };
export type Messages = Partial<Record<MessageKey, string>>;

export class UnknownMessageKeyError extends Error {
  constructor(readonly key: string) {
    super(`i18n: unknown message key "${key}" (not in the English catalogue)`);
    this.name = "UnknownMessageKeyError";
  }
}
export class MissingMessageError extends Error {
  constructor(readonly key: string, readonly locale: string) {
    super(`i18n: message "${key}" is missing in "${locale}" and no fallback locale was given`);
    this.name = "MissingMessageError";
  }
}
export class LocaleNotLoadedError extends Error {
  constructor(readonly locale: string) {
    super(`i18n: locale "${locale}" is not loaded; await setLocale("${locale}") or pass it in messages`);
    this.name = "LocaleNotLoadedError";
  }
}

export interface I18nOptions {
  /** Active locale (BCP 47). Must be English, in `messages`, or built in (then use `createI18nAsync`). */
  locale: string;
  /**
   * Locale to serve a message from when the active locale lacks it. Without
   * it a missing message throws. Normally "en" in production, unset in
   * development so gaps surface.
   */
  fallback?: string;
  /** Catalogues by locale. "en" is built in. */
  messages?: Readonly<Record<string, Messages>>;
  /** Fetches a catalogue for a locale not in `messages`, for setLocale. */
  load?: (locale: string) => Promise<Messages>;
  /** Called with (key, requestedLocale, servedLocale) whenever the fallback served a message. */
  onFallback?: (key: MessageKey, locale: string, served: string) => void;
  /** Native digits (Devanagari, Arabic-Indic, …) in formatted numbers. Default false: Latin. */
  nativeDigits?: boolean;
}

export interface LocaleChangeEvent {
  locale: string;
  previous: string;
  dir: Direction;
}

type Listener = (e: LocaleChangeEvent) => void;

// Suffix messages are appended to the number verbatim: a word suffix carries its own leading space.
const VOLUME_UNITS = { k: "unit.volume.k", l: "unit.volume.l", cr: "unit.volume.cr", m: "unit.volume.m", b: "unit.volume.b", t: "unit.volume.t" } as const;
const INDIAN_STEPS = ["k", "l", "cr"] as const, WESTERN_STEPS = ["k", "m", "b", "t"] as const;

export class I18n {
  private readonly catalogues = new Map<string, Messages>();
  private readonly compiled = new Map<string, Node[]>();
  private readonly listeners = new Set<Listener>();
  private active: string;
  private readonly nativeDigits: boolean;

  constructor(private readonly opts: I18nOptions) {
    for (const [loc, cat] of Object.entries(opts.messages ?? {})) this.catalogues.set(canon(loc), cat);
    this.catalogues.set("en", en);
    this.nativeDigits = opts.nativeDigits ?? false;
    this.active = canon(opts.locale);
    if (!this.hasCatalogue(this.active)) throw new LocaleNotLoadedError(this.active);
  }

  get locale(): string {
    return this.active;
  }
  get dir(): Direction {
    return dirOf(this.active);
  }
  get loadedLocales(): string[] {
    return [...this.catalogues.keys()];
  }

  /** Register or replace a catalogue (e.g. after your own fetch). */
  addMessages(locale: string, messages: Messages): void {
    const l = canon(locale);
    this.catalogues.set(l, messages);
    for (const k of [...this.compiled.keys()]) if (k.startsWith(`${l}\u0000`)) this.compiled.delete(k);
  }

  /** Switch locale, loading its catalogue first if needed; emits "localeChange". */
  async setLocale(locale: string): Promise<void> {
    const l = canon(locale);
    if (!this.hasCatalogue(l)) {
      if (!this.opts.load) throw new LocaleNotLoadedError(l);
      this.addMessages(l, await this.opts.load(l));
    }
    const previous = this.active;
    this.active = l;
    this.emit({ locale: l, previous, dir: dirOf(l) });
  }

  on(type: "localeChange", fn: Listener): () => void {
    if (type !== "localeChange") throw new Error(`i18n: unknown event "${type}"`);
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** The text for `key` in the active locale. */
  readonly t = (key: MessageKey, values: MessageValues = {}): string => {
    if (!Object.hasOwn(en, key)) throw new UnknownMessageKeyError(key);
    let served = this.active;
    let src = this.lookup(this.active, key);
    if (src === undefined) {
      const fb = this.opts.fallback;
      if (fb === undefined) throw new MissingMessageError(key, this.active);
      served = canon(fb);
      src = this.lookup(served, key);
      if (src === undefined) throw new MissingMessageError(key, served);
      this.opts.onFallback?.(key, this.active, served);
    }
    const ast = this.compile(served, key, src);
    return formatNodes(ast, values, { locale: served, number: (n) => formatNumber(n, served, { nativeDigits: this.nativeDigits }) }, key);
  };

  /** True when `key` is in the English schema. */
  hasKey(key: string): key is MessageKey {
    return Object.hasOwn(en, key);
  }

  /** The core's `messages` option: `createChart(el, { messages: i18n.chartMessages })`. */
  readonly chartMessages = (key: MessageKey, values?: MessageValues): string => this.t(key, values);

  // ---- locale-bound formatting (digits follow the nativeDigits option) ----

  readonly number = (v: number, o: NumberOptions = {}): string => formatNumber(v, this.active, { nativeDigits: this.nativeDigits, ...o });
  readonly percent = (v: number, o: NumberOptions = {}): string => formatPercent(v, this.active, { nativeDigits: this.nativeDigits, ...o });
  readonly volume = (v: number): string => {
    const suffixes: Record<string, string> = {};
    // Only the suffixes this locale's steps use, so a catalogue need not carry the others.
    for (const k of usesIndianNumbering(this.active) ? INDIAN_STEPS : WESTERN_STEPS) suffixes[k] = this.t(VOLUME_UNITS[k]);
    return formatVolume(v, this.active, { nativeDigits: this.nativeDigits, suffixes });
  };
  readonly dateTime = (ms: number, o: DateTimeOptions): string => formatDateTime(ms, this.active, { nativeDigits: this.nativeDigits, ...o });
  readonly relative = (seconds: number): string => formatRelative(seconds, this.active, { nativeDigits: this.nativeDigits });
  readonly clock = (seconds: number): string => formatClock(seconds, this.active, { nativeDigits: this.nativeDigits });
  readonly list = (items: readonly string[], type?: "conjunction" | "disjunction" | "unit"): string => formatList(items, this.active, type);

  // ---- internals ----

  /** Catalogue locales to try for `locale`: itself, then its language ("hi-IN" → "hi"). */
  private chain(locale: string): string[] {
    const lang = new Intl.Locale(locale).language;
    return lang === locale ? [locale] : [locale, lang];
  }
  private hasCatalogue(locale: string): boolean {
    return this.chain(locale).some((l) => this.catalogues.has(l));
  }
  private lookup(locale: string, key: MessageKey): string | undefined {
    for (const l of this.chain(locale)) {
      const m = this.catalogues.get(l)?.[key];
      if (m !== undefined) return m;
    }
    return undefined;
  }
  private compile(locale: string, key: string, src: string): Node[] {
    const k = `${locale}\u0000${key}\u0000${src}`;
    let ast = this.compiled.get(k);
    if (!ast) {
      try {
        ast = parseMessage(src);
      } catch (e) {
        throw new Error(`i18n: message "${key}" in "${locale}": ${(e as Error).message}`);
      }
      this.compiled.set(k, ast);
    }
    return ast;
  }
  private emit(e: LocaleChangeEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }
}

function canon(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0]!;
  } catch {
    throw new RangeError(`i18n: invalid locale "${locale}"`);
  }
}

export function createI18n(options: I18nOptions): I18n {
  return new I18n(options);
}

/** Lazy built-in catalogues; each is its own chunk in a bundled build. */
export const builtInLoaders: Readonly<Record<string, () => Promise<Catalogue>>> = {
  hi: async () => (await import("./locales/hi.js")).hi,
};

/** Locales with a built-in catalogue (English and Hindi). */
export const BUILT_IN_LOCALES: readonly string[] = ["en", ...Object.keys(builtInLoaders)];

/**
 * createI18n for a locale whose built-in catalogue is fetched first:
 * `await createI18nAsync({ locale: "hi-IN" })`. setLocale on the result also
 * loads built-in catalogues on demand.
 */
export async function createI18nAsync(options: I18nOptions): Promise<I18n> {
  const lang = new Intl.Locale(options.locale).language;
  const messages = { ...options.messages };
  const loader = builtInLoaders[lang];
  if (loader && !(lang in messages)) messages[lang] = await loader();
  const load = options.load ?? (async (loc: string) => {
    const l = builtInLoaders[new Intl.Locale(loc).language];
    if (!l) throw new LocaleNotLoadedError(loc);
    return l();
  });
  return new I18n({ ...options, messages, load });
}
