// Shallow option diffing shared by every component.
//
// A prop object is usually an inline literal, so its identity changes on every
// render. Only keys whose value changed (one level deep for the nested option
// groups like `crosshair`) reach `applyOptions`, so a re-render that changes
// nothing costs nothing. Keys that disappear from the props are not reset:
// core merges options and has no "unset".

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k) || !Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** The entries of `next` that differ from `prev`; undefined when none. */
export function diffOptions<T extends object>(prev: T | undefined, next: T | undefined): Partial<T> | undefined {
  if (!next) return undefined;
  let out: Partial<T> | undefined;
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (next[k] === undefined) continue;
    if (prev && shallowEqual(prev[k], next[k])) continue;
    (out ??= {} as Partial<T>)[k] = next[k];
  }
  return out;
}

/**
 * A plain copy of `options` one nested group deep. Reading it inside a Vue
 * watch getter tracks every top-level key and every key of a nested group
 * (so `options.crosshair.mode = "x"` on a reactive object is seen), and hands
 * core plain objects rather than reactive proxies.
 */
export function snapshot<T extends object>(options: T | undefined): T | undefined {
  if (!options) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(options)) {
    out[k] = v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype ? { ...v } : v;
  }
  return out as T;
}
