// Layout persistence: a chart's whole arrangement as versioned JSON, and the
// storage adapters that keep it.
//
// Saved: options and theme, panes (stretch, every scale's options and, when
// not autoscaling, its range), series (type, id, options), the view (bar
// spacing, right offset) and each plugin's toJSON(). Not saved: bar data, which
// belongs to the integrator's feed. A custom price formatter or `timeLabel` is
// a function and cannot be saved; restoring one needs it passed back (formatters
// by series id, `timeLabel` by name). The layout records that a `timeLabel` was
// set (`customOptions`), and restoring without one is refused, never silently
// drawn with the calendar labels instead.
//
// Restoring checks the version: older layouts are migrated step by step, a
// newer one is refused rather than half-applied.

export const LAYOUT_VERSION = 1;

export interface SeriesState {
  id: string;
  type: string;
  options: Record<string, unknown>;
}

export interface ScaleState {
  options: Record<string, unknown>;
  /** Display-unit range, saved when the scale is not autoscaling. */
  range?: { min: number; max: number };
}

export interface PaneState {
  stretch: number;
  scales: Record<string, ScaleState>;
}

export interface ChartState {
  version: typeof LAYOUT_VERSION;
  options: Record<string, unknown>;
  panes: PaneState[];
  series: SeriesState[];
  view: { spacing: number; rightOffset: number };
  plugins: Record<string, unknown>;
  /** Function-valued chart options that were set when saving; the caller re-supplies them on restore. Absent in older layouts. */
  customOptions?: CustomOption[];
}

/** Chart options that are functions, so not in the JSON. */
export type CustomOption = "timeLabel";

/** Throws, before anything is changed, when the layout needs a function the caller did not supply. */
export function checkCustomOptions(st: ChartState, supplied: Partial<Record<CustomOption, unknown>>): void {
  for (const name of st.customOptions ?? []) {
    if (typeof supplied[name] !== "function") {
      throw new Error(`alphacharts: the layout was saved with a custom ${name}, which is a function and not in the JSON; pass it to restoreState({ ${name} })`);
    }
  }
}

/** Migrations from version n to n + 1, keyed by n. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrate(raw: unknown): ChartState {
  if (typeof raw !== "object" || raw === null) throw new TypeError("layout: expected an object");
  let s = raw as Record<string, unknown>;
  let v = s.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new TypeError(`layout: invalid version ${String(v)}`);
  if (v > LAYOUT_VERSION) throw new RangeError(`layout: version ${v} is newer than this library understands (${LAYOUT_VERSION})`);
  while (v < LAYOUT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`layout: no migration from version ${v}`);
    s = step(s);
    v++;
  }
  for (const k of ["options", "panes", "series", "view", "plugins"]) {
    if (!(k in s)) throw new TypeError(`layout: missing "${k}"`);
  }
  return s as unknown as ChartState;
}

/** Where layouts are kept. Async so a server-backed store fits the same shape. */
export interface LayoutStore {
  load(key: string): Promise<unknown | undefined>;
  save(key: string, state: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryStore implements LayoutStore {
  private readonly map = new Map<string, string>();
  async load(key: string): Promise<unknown | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : JSON.parse(v);
  }
  async save(key: string, state: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(state));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/** localStorage under a prefix. Quota and privacy-mode failures reject. */
export class LocalStorageStore implements LayoutStore {
  constructor(private readonly prefix = "alphacharts:") {}
  async load(key: string): Promise<unknown | undefined> {
    const v = localStorage.getItem(this.prefix + key);
    return v === null ? undefined : JSON.parse(v);
  }
  async save(key: string, state: unknown): Promise<void> {
    localStorage.setItem(this.prefix + key, JSON.stringify(state));
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }
  async keys(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }
}

/** Options with functions removed (custom formatters are re-supplied on restore). */
export function plain(o: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "function" ? undefined : v))) as Record<string, unknown>;
}
