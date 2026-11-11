// A chart theme from the page's own CSS variables, so a chart looks like the application around it.
//
// The names are shadcn/ui's: `--background`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--chart-1` …
// `--chart-5` (the data palette) and `--font-sans`, plus `--chart-up` and `--chart-down` for what shadcn has no token for. `--ring` colours the keyboard focus ring. A host that already themes its app with shadcn gets
// a matching chart with no further work; two parts of one page (the application and a research panel) differ simply by
// defining the variables differently under two selectors.
//
// Order, first one found wins:
//   1. `--ac-<token>`  an alphacharts override: the token's name with `--ac-` in front (`--ac-background`, `--ac-primary`,
//      `--ac-chart-up` ...), so a host can restyle the chart without touching its own tokens. Keys shadcn has no token for are
//      `--ac-grid`, `--ac-crosshair`, `--ac-label-background`, `--ac-label-text` and `--ac-extended-hours`.
//   2. the shadcn token above
//   3. the default Luma palette, light or dark by the page (a `.dark` class, `data-theme="dark"`, `color-scheme`, or the OS)
//
// Any CSS colour is read (`oklch()`, `hsl()`, `color-mix()`, a name ...) and written as sRGB, which is what the charts draw
// with. shadcn v3's bare `H S% L%` triples are read as `hsl()`. A variable that is set but is not a colour throws, naming it.

import { LUMA_DARK, LUMA_LIGHT, type Theme } from "./theme.js";
import { parseColor } from "../render/color.js";

export type ThemeSource = (name: string) => string | undefined;

/** The theme keys that are colours, with the shadcn token each one is read from, if it has one. */
const COLOUR_KEYS: ReadonlyArray<{ key: keyof Theme; ac: string; token?: string }> = [
  { key: "background", ac: "--ac-background", token: "--background" },
  { key: "text", ac: "--ac-foreground", token: "--foreground" },
  { key: "textMuted", ac: "--ac-muted-foreground", token: "--muted-foreground" },
  { key: "border", ac: "--ac-border", token: "--border" },
  { key: "accent", ac: "--ac-primary", token: "--primary" },
  { key: "focusRing", ac: "--ac-ring", token: "--ring" },
  { key: "up", ac: "--ac-chart-up", token: "--chart-up" },
  { key: "down", ac: "--ac-chart-down", token: "--chart-down" },
  { key: "grid", ac: "--ac-grid" },
  { key: "crosshair", ac: "--ac-crosshair" },
  { key: "labelBackground", ac: "--ac-label-background" },
  { key: "labelText", ac: "--ac-label-text" },
  { key: "extendedHours", ac: "--ac-extended-hours" },
];

/** Every CSS variable `themeFromCss` reads, in the order it tries them: for documentation and for tests. */
export const THEME_VARIABLES: readonly string[] = [
  ...COLOUR_KEYS.flatMap((c) => (c.token ? [c.ac, c.token] : [c.ac])),
  ...[1, 2, 3, 4, 5].flatMap((n) => [`--ac-chart-${n}`, `--chart-${n}`]),
  "--ac-font-sans", "--font-sans", "--ac-font-size",
];

const rgbaOf = (c: number): [number, number, number, number] => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, (c & 255) / 255];
const str = ([r, g, b, a]: [number, number, number, number]): string => (a >= 1 ? `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}` : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`);

/** `a` over `b`, the result opaque when `b` is. */
function over(a: number, b: number): [number, number, number, number] {
  const [ar, ag, ab, aa] = rgbaOf(a), [br, bg, bb, ba] = rgbaOf(b);
  const oa = aa + ba * (1 - aa);
  if (oa === 0) return [0, 0, 0, 0];
  const mix = (x: number, y: number) => (x * aa + y * ba * (1 - aa)) / oa;
  return [mix(ar, br), mix(ag, bg), mix(ab, bb), oa];
}

/** `t` of the way from `a` to `b`, per channel, on opaque colours. */
function blend(a: number, b: number, t: number): [number, number, number, number] {
  const [ar, ag, ab] = rgbaOf(a), [br, bg, bb] = rgbaOf(b);
  return [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t, 1];
}

/**
 * The theme a set of variables describes. `read` returns a variable's raw value (or undefined), `toRgb` turns any CSS colour
 * into one `parseColor` accepts, and `dark` picks the fallback palette. Pure: the DOM version below supplies the three.
 */
export function themeFromTokens(read: ThemeSource, toRgb: (css: string) => string, dark: boolean, overrides: Partial<Theme> = {}): Theme {
  const base = dark ? LUMA_DARK : LUMA_LIGHT;
  const out: Theme = { ...base };
  const found = new Set<keyof Theme>();
  const colour = (varName: string): string | undefined => {
    const raw = read(varName)?.trim();
    if (!raw) return undefined;
    const triple = /^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%$/.exec(raw); // shadcn v3: "0 0% 100%"
    try {
      return toRgb(triple ? `hsl(${raw})` : raw);
    } catch {
      throw new TypeError(`theme: ${varName} is "${raw}", which is not a colour`);
    }
  };
  for (const { key, ac, token } of COLOUR_KEYS) {
    const v = colour(ac) ?? (token ? colour(token) : undefined);
    if (v !== undefined) {
      (out as unknown as Record<string, string>)[key] = v;
      found.add(key);
    }
  }
  // Derived only from colours the host defined, so a custom palette never mixes with a Luma one and a host that defined nothing
  // gets the palette exactly. The border may be translucent (shadcn's dark border is white at 10%): flattened onto the background.
  const bg = parseColor(out.background);
  if (found.has("border")) out.border = str(over(parseColor(out.border), bg));
  if (!found.has("grid") && (found.has("background") || found.has("border"))) out.grid = str(blend(bg, parseColor(out.border), 0.5));
  if (!found.has("crosshair") && found.has("textMuted")) out.crosshair = out.textMuted;
  if (!found.has("labelBackground") && found.has("text")) out.labelBackground = out.text;
  if (!found.has("labelText") && (found.has("background") || found.has("text"))) out.labelText = out.background;
  if (!found.has("extendedHours") && found.has("accent")) {
    const [r, g, b] = rgbaOf(parseColor(out.accent));
    out.extendedHours = `rgba(${r},${g},${b},0.07)`;
  }
  // The data palette: shadcn's --chart-1 … --chart-5, each overridable; any one the host leaves out is the Luma one.
  const pal = [1, 2, 3, 4, 5].map((n) => colour(`--ac-chart-${n}`) ?? colour(`--chart-${n}`));
  if (pal.some((c) => c !== undefined)) out.palette = pal.map((c, i) => c ?? base.palette![i]!);
  const font = (read("--ac-font-sans") ?? read("--font-sans"))?.trim();
  if (font) out.fontFamily = font;
  const size = Number.parseFloat(read("--ac-font-size") ?? "");
  if (size > 0) out.fontSize = size;
  return { ...out, ...overrides };
}

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour as `#rrggbb` or `rgba()`, by drawing it: the browser's own parser reads `oklch()`, `color-mix()` and the rest. */
export function cssColorToRgb(css: string): string {
  if (typeof document === "undefined") throw new Error("cssColorToRgb needs a DOM");
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) throw new Error("a 2D canvas is needed to read CSS colours");
  // An unreadable colour leaves fillStyle as it was: set two different sentinels first, and a colour that is not one of them
  // ends up different each time.
  probe.fillStyle = "#010203";
  probe.fillStyle = css;
  const first = probe.fillStyle;
  probe.fillStyle = "#040506";
  probe.fillStyle = css;
  if (first !== probe.fillStyle) throw new TypeError(`"${css}" is not a CSS colour`);
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, al] = probe.getImageData(0, 0, 1, 1).data as unknown as [number, number, number, number];
  return str([r, g, b, al / 255]);
}

/** Whether the page asks for dark: a `.dark` class or `data-theme="dark"` on the element or above, a dark `color-scheme`, or the OS. */
export function pageIsDark(el: Element): boolean {
  if (el.closest(".dark, [data-theme='dark'], [data-mode='dark']")) return true;
  if (el.closest(".light, [data-theme='light'], [data-mode='light']")) return false;
  const scheme = typeof getComputedStyle === "function" ? getComputedStyle(el).colorScheme : "";
  if (scheme.includes("dark") && !scheme.includes("light")) return true;
  if (scheme.includes("light") && !scheme.includes("dark")) return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The chart theme the page's CSS variables describe at `el` (see the header for the variables). `overrides` win over everything. */
export function themeFromCss(el: Element, overrides: Partial<Theme> = {}): Theme {
  const cs = getComputedStyle(el);
  return themeFromTokens((name) => cs.getPropertyValue(name) || undefined, cssColorToRgb, pageIsDark(el), overrides);
}

/**
 * Call `onChange` when the page's theme may have changed: a class, style or theme attribute on the element or the document
 * element (shadcn toggles `.dark` there), or the OS colour scheme. Returns the function that stops watching.
 */
export function watchTheme(el: Element, onChange: () => void): () => void {
  const targets = new Set<Element>([el, document.documentElement]);
  for (let p = el.parentElement; p; p = p.parentElement) targets.add(p);
  let queued = false;
  const fire = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      onChange();
    });
  };
  const mo = new MutationObserver(fire);
  for (const t of targets) mo.observe(t, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-mode"] });
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener("change", fire);
  return () => {
    mo.disconnect();
    mq?.removeEventListener("change", fire);
  };
}
