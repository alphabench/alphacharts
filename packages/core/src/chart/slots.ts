// Colour slots: a data colour named by its role instead of its value, drawn with the chart's current theme. A study line is
// "chart-2", a bearish bar "chart-down", a reference line "muted", so the same definition follows the page between the
// application's theme and another panel's, light and dark, and changes the moment the theme does.
//
//   chart-1 … chart-5   the theme's palette (shadcn's --chart-1 … --chart-5)
//   chart-up, chart-down  the theme's up and down colours
//   muted               the theme's muted text colour (reference lines, levels 0 and 1)
//   foreground          the theme's text colour
// Any of them may carry an opacity: "chart-2/0.35". Everything else is an ordinary colour and passes through unchanged.

import { LUMA_DARK, LUMA_LIGHT, type Theme } from "./theme.js";
import { parseColor } from "../render/color.js";

const SLOT = /^(chart-[1-5]|chart-up|chart-down|muted|foreground)(?:\/(0|1|0?\.\d+))?$/;

/** Whether `color` names a slot (see the header) rather than a colour. */
export function isColorSlot(color: string): boolean {
  return SLOT.test(color);
}

/** WCAG relative luminance of a colour, 0 (black) … 1 (white). */
function luminance(css: string): number {
  const c = parseColor(css);
  const ch = [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** The theme's five data colours: its own, or the Luma greys for its background. */
export function paletteOf(t: Theme): readonly string[] {
  if (t.palette) {
    if (t.palette.length < 5) throw new RangeError(`theme palette has ${t.palette.length} colours; it needs 5 (chart-1 … chart-5)`);
    return t.palette;
  }
  return (luminance(t.background) < 0.18 ? LUMA_DARK : LUMA_LIGHT).palette!;
}

/** `color` with an opacity, as rgba(). */
export function colorWithAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  const a = ((c & 255) / 255) * alpha;
  return `rgba(${(c >>> 24) & 255},${(c >>> 16) & 255},${(c >>> 8) & 255},${+a.toFixed(3)})`;
}

/** The colour a slot names under theme `t`; any other colour unchanged. */
export function resolveColor(color: string, t: Theme): string {
  const m = SLOT.exec(color);
  if (!m) return color;
  const name = m[1]!;
  const base =
    name === "chart-up" ? t.up : name === "chart-down" ? t.down : name === "muted" ? t.textMuted : name === "foreground" ? t.text : paletteOf(t)[Number(name.slice(6)) - 1]!;
  return m[2] === undefined ? base : colorWithAlpha(base, Number(m[2]));
}

/** A slot with an opacity ("chart-2/0.35"), or an ordinary colour made translucent. */
export function slotAlpha(color: string, alpha: number): string {
  const m = SLOT.exec(color);
  if (!m) return colorWithAlpha(color, alpha);
  const a = m[2] === undefined ? alpha : Number(m[2]) * alpha;
  return `${m[1]}/${+a.toFixed(3)}`;
}

/** `o` with every `*Color` option that names a slot replaced by the theme's colour (the same object when none does). */
export function resolveColors<O extends object>(o: O, theme: Theme): O {
  let out: O | null = null;
  for (const [k, v] of Object.entries(o)) {
    if (!/color$/i.test(k) || typeof v !== "string" || !isColorSlot(v)) continue;
    (out ??= { ...o } as O)[k as keyof O] = resolveColor(v, theme) as never;
  }
  return out ?? o;
}

/** Whether two themes draw alike: every key, the palette by its colours. */
export function sameTheme(a: Theme, b: Theme): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Theme)[]);
  for (const k of keys) {
    if (k === "palette") {
      const x = a.palette, y = b.palette;
      if (x === y) continue;
      if (!x || !y || x.length !== y.length || x.some((c, i) => c !== y[i])) return false;
    } else if (a[k] !== b[k]) return false;
  }
  return true;
}
