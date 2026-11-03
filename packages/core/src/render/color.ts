// Colours as packed 0xRRGGBBAA. Only hex and rgb()/rgba() are accepted: the
// library has no DOM-free way to resolve named or computed colours, and a
// colour it cannot read must fail loudly rather than render as black.

// Bounded: per-point colours from live data can be unbounded strings.
const cache = new Map<string, number>();
const CACHE_MAX = 4096;

export function parseColor(css: string): number {
  const hit = cache.get(css);
  if (hit !== undefined) return hit;
  const v = parse(css.trim().toLowerCase());
  if (v === undefined) throw new TypeError(`unsupported colour "${css}": use #rgb, #rrggbb, #rrggbbaa, rgb() or rgba()`);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(css, v);
  return v;
}

function parse(s: string): number | undefined {
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return undefined;
    if (h.length === 3 || h.length === 4) {
      const e = [...h].map((c) => c + c).join("");
      return parse("#" + (h.length === 3 ? e + "ff" : e));
    }
    if (h.length === 6) return (parseInt(h, 16) * 256 + 255) >>> 0;
    if (h.length === 8) return parseInt(h, 16) >>> 0;
    return undefined;
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return undefined;
  const ch = (x: string) => Math.max(0, Math.min(255, Math.round(+x)));
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
  return ((ch(m[1]!) << 24) | (ch(m[2]!) << 16) | (ch(m[3]!) << 8) | Math.round(Math.max(0, Math.min(1, a)) * 255)) >>> 0;
}

/** Unpack to premultiplied-free [r, g, b, a] in 0..1. */
export function rgba(c: number, out: Float32Array = new Float32Array(4)): Float32Array {
  out[0] = ((c >>> 24) & 255) / 255;
  out[1] = ((c >>> 16) & 255) / 255;
  out[2] = ((c >>> 8) & 255) / 255;
  out[3] = (c & 255) / 255;
  return out;
}

export function cssColor(c: number): string {
  return `rgba(${(c >>> 24) & 255},${(c >>> 16) & 255},${(c >>> 8) & 255},${((c & 255) / 255).toFixed(3)})`;
}
