// Everything the shell keeps in a LayoutStore, under one prefix:
//   ui/prefs                  favourites, recent symbols, last settings
//   ui/layout/<name>          a saved multi-chart layout
//   ui/template/<name>        a chart template (studies + style)
// Drawing templates are the drawings package's own (TemplateStore).
// Every failure rejects; nothing is swallowed.

import type { LayoutStore } from "@alphacharts/core";

export const LAYOUT_SCHEMA = 1;

export interface Prefs {
  version: 1;
  favouriteIntervals: string[];
  favouriteStudies: string[];
  favouriteChartTypes: string[];
  recentSymbols: string[];
  /** The last-used tool of each tool group, to open its flyout on it. */
  lastTool: Record<string, string>;
  favouriteTools: string[];
  customIntervals: string[];
}

export const EMPTY_PREFS: Prefs = {
  version: 1, favouriteIntervals: [], favouriteStudies: [], favouriteChartTypes: [], recentSymbols: [], lastTool: {}, favouriteTools: [], customIntervals: [],
};

export const MAX_RECENT = 10;

export class PrefsStore {
  private cache: Prefs | null = null;
  constructor(private readonly store: LayoutStore) {}

  async get(): Promise<Prefs> {
    if (this.cache) return this.cache;
    const raw = (await this.store.load("ui/prefs")) as Prefs | undefined;
    if (raw !== undefined && raw.version !== 1) throw new RangeError(`ui prefs: version ${String(raw.version)} is not understood`);
    this.cache = { ...EMPTY_PREFS, ...raw };
    return this.cache;
  }

  async update(fn: (p: Prefs) => Prefs): Promise<Prefs> {
    const next = fn(await this.get());
    await this.store.save("ui/prefs", next);
    this.cache = next;
    return next;
  }
}

export function toggled(list: readonly string[], item: string, on?: boolean): string[] {
  const has = list.includes(item);
  const want = on ?? !has;
  if (want === has) return [...list];
  return want ? [...list, item] : list.filter((x) => x !== item);
}

export function pushRecent(list: readonly string[], symbol: string): string[] {
  return [symbol, ...list.filter((s) => s !== symbol)].slice(0, MAX_RECENT);
}

// ---- named documents ---------------------------------------------------------

export interface Named<T> {
  version: typeof LAYOUT_SCHEMA;
  name: string;
  savedAt: number;
  body: T;
}

/** Names become store keys; "/" would split them, so it is refused (like the drawings templates). */
export function checkName(name: string): string {
  const n = name.trim();
  if (!n) throw new RangeError("name must not be empty");
  if (n.includes("/")) throw new RangeError(`name must not contain "/", got "${name}"`);
  return n;
}

/** Saved documents of one kind: layouts or chart templates. */
export class NamedStore<T> {
  constructor(private readonly store: LayoutStore, private readonly kind: "layout" | "template" | "script") {}

  private key(name: string): string {
    return `ui/${this.kind}/${checkName(name)}`;
  }

  async list(): Promise<Array<{ name: string; savedAt: number }>> {
    const p = `ui/${this.kind}/`;
    const keys = (await this.store.keys()).filter((k) => k.startsWith(p));
    const out: Array<{ name: string; savedAt: number }> = [];
    for (const k of keys) {
      const d = await this.load(k.slice(p.length));
      out.push({ name: d.name, savedAt: d.savedAt });
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  async load(name: string): Promise<Named<T>> {
    const raw = (await this.store.load(this.key(name))) as Named<T> | undefined;
    if (!raw) throw new Error(`no ${this.kind} named "${name}"`);
    if (raw.version !== LAYOUT_SCHEMA) throw new RangeError(`${this.kind} "${name}": version ${String(raw.version)} is not understood`);
    return raw;
  }

  async exists(name: string): Promise<boolean> {
    return (await this.store.load(this.key(name))) !== undefined;
  }

  async save(name: string, body: T, now = Date.now()): Promise<void> {
    const n = checkName(name);
    await this.store.save(this.key(n), { version: LAYOUT_SCHEMA, name: n, savedAt: now, body } satisfies Named<T>);
  }

  async remove(name: string): Promise<void> {
    await this.store.remove(this.key(name));
  }

  /** Save under the new name, then remove the old; refuses when the new name is taken. */
  async rename(from: string, to: string): Promise<void> {
    const f = checkName(from), t = checkName(to);
    if (f === t) return;
    if (await this.exists(t)) throw new Error(`a ${this.kind} named "${t}" already exists`);
    const d = await this.load(f);
    await this.save(t, d.body, d.savedAt);
    await this.remove(f);
  }
}
