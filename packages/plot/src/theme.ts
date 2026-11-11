// Plot theme: the core's tokens plus the colours a plot needs (a categorical
// palette and the ramps). The host passes resolved colours (hex or rgb()), or
// "inherit": the page's own shadcn variables, read like the chart reads them.

import { DARK, LIGHT, cssColorToRgb, parseColor, systemTheme, themeFromCss, type Theme } from "@alphacharts/core";

export interface PlotTheme extends Theme {
  /** Series colours in order, then repeated. */
  palette: readonly string[];
  /** Low to high: heatmap and treemap default ramp. */
  sequential: readonly string[];
  /** [negative, neutral, positive]. */
  diverging: readonly [string, string, string];
  /** Tooltip card. */
  tooltipBackground: string;
  tooltipText: string;
  // The keyboard focus outline is the core theme's `focusRing`; the plot falls back to `accent` (the brush colour) when it is unset.
  /** Tooltip corner radius, a CSS length. Default "4px". Under "inherit": `--ac-tooltip-radius`. */
  tooltipRadius?: string;
  /** Tooltip `box-shadow` (a CSS value, or "none"). Default a soft 8 px shadow. Under "inherit": `--ac-tooltip-shadow`. */
  tooltipShadow?: string;
  /** Tooltip text size in CSS px, used as is. Unset: `fontSize + 1`. Under "inherit": `--ac-tooltip-font-size`. */
  tooltipFontSize?: number;
}

/** The tooltip's shadow before a theme sets one. */
export const DEFAULT_TOOLTIP_SHADOW = "0 2px 8px rgba(0,0,0,.25)";

/** The tooltip's chrome from the theme: radius and shadow as given, text `tooltipFontSize` or else one px above the axis labels (12 px at the default 11). */
export function tooltipChrome(t: PlotTheme): { borderRadius: string; boxShadow: string; fontSize: string } {
  return { borderRadius: t.tooltipRadius ?? "4px", boxShadow: t.tooltipShadow ?? DEFAULT_TOOLTIP_SHADOW, fontSize: `${t.tooltipFontSize ?? t.fontSize + 1}px` };
}

// The categorical palette is the core theme's (shadcn's --chart-1 … --chart-5, Luma's greys by default).
export const PLOT_LIGHT: PlotTheme = {
  ...LIGHT,
  palette: LIGHT.palette!,
  sequential: ["#f5f5f5", "#d4d4d4", "#737373", "#171717"],
  diverging: ["#ef4444", "#f5f5f5", "#10b981"],
  tooltipBackground: "#ffffff",
  tooltipText: "#0a0a0a",
  tooltipRadius: "4px",
  tooltipShadow: DEFAULT_TOOLTIP_SHADOW,
};

export const PLOT_DARK: PlotTheme = {
  ...DARK,
  palette: DARK.palette!,
  sequential: ["#171717", "#404040", "#a3a3a3", "#fafafa"],
  diverging: ["#ef4444", "#171717", "#10b981"],
  tooltipBackground: "#171717",
  tooltipText: "#fafafa",
  tooltipRadius: "4px",
  tooltipShadow: DEFAULT_TOOLTIP_SHADOW,
};

const rgbOf = (css: string): [number, number, number] => {
  const c = parseColor(css);
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
};
/** `t` of the way from `a` to `b`, opaque. */
const mix = (a: string, b: string, t: number): string => {
  const x = rgbOf(a), y = rgbOf(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

/**
 * The plot theme the page's CSS variables describe at `el`: the chart's (see core's `themeFromCss`: `--background`,
 * `--foreground`, `--chart-1` … `--chart-5` …), the tooltip as shadcn's popover (`--popover`, `--popover-foreground`), and the
 * ramps mixed from the background to the foreground. `overrides` win over everything.
 */
export function plotThemeFromCss(el: Element, overrides: Partial<PlotTheme> = {}): PlotTheme {
  const t = themeFromCss(el);
  const cs = getComputedStyle(el);
  const token = (name: string): string | undefined => {
    const v = (cs.getPropertyValue(`--ac-${name}`) || cs.getPropertyValue(`--${name}`)).trim();
    return v ? cssColorToRgb(v) : undefined;
  };
  const bg = t.background, fg = t.text;
  const raw = (name: string): string | undefined => cs.getPropertyValue(`--ac-${name}`).trim() || undefined;
  return resolveTheme({
    ...t,
    palette: t.palette!,
    sequential: [mix(bg, fg, 0.04), mix(bg, fg, 0.2), mix(bg, fg, 0.55), fg],
    diverging: [t.down, mix(bg, fg, 0.06), t.up],
    tooltipBackground: token("popover") ?? bg,
    tooltipText: token("popover-foreground") ?? fg,
    ...(raw("tooltip-radius") !== undefined ? { tooltipRadius: raw("tooltip-radius")! } : {}),
    ...(Number.parseFloat(raw("tooltip-font-size") ?? "") > 0 ? { tooltipFontSize: Number.parseFloat(raw("tooltip-font-size")!) } : {}),
    ...(raw("tooltip-shadow") !== undefined ? { tooltipShadow: raw("tooltip-shadow")! } : {}),
    ...overrides,
  });
}

export function resolveTheme(t: "light" | "dark" | Partial<PlotTheme> | undefined): PlotTheme {
  let base: PlotTheme;
  let over: Partial<PlotTheme> = {};
  if (t === "light") base = PLOT_LIGHT;
  else if (t === "dark") base = PLOT_DARK;
  else {
    base = t === undefined ? (systemTheme().background === LIGHT.background ? PLOT_LIGHT : PLOT_DARK) : PLOT_LIGHT;
    if (t !== undefined) over = t;
  }
  const out: PlotTheme = { ...base };
  // exactOptionalPropertyTypes: copy only what was given.
  for (const k of Object.keys(over) as (keyof PlotTheme)[]) {
    const v = over[k];
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  // A colour the renderer cannot read must fail now, not as a black mark later.
  for (const k of ["background", "text", "textMuted", "grid", "border", "crosshair", "labelBackground", "labelText", "up", "down", "accent", "tooltipBackground", "tooltipText"] as const) parseColor(out[k]);
  for (const c of [...out.palette, ...out.sequential, ...out.diverging]) parseColor(c);
  if (out.focusRing !== undefined) parseColor(out.focusRing);
  if (out.tooltipFontSize !== undefined && !(typeof out.tooltipFontSize === "number" && out.tooltipFontSize > 0 && Number.isFinite(out.tooltipFontSize))) throw new RangeError(`alphacharts: theme.tooltipFontSize must be a positive number of px, got ${String(out.tooltipFontSize)}`);
  for (const k of ["tooltipRadius", "tooltipShadow"] as const) {
    const css = k === "tooltipRadius" ? "border-radius" : "box-shadow";
    // Where the engine can say (a browser), a value it would drop silently fails here instead.
    const v = out[k];
    const ok = typeof v === "string" && v.trim() !== "" && (typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports(css, v));
    if (!ok) throw new TypeError(`alphacharts: theme.${k} must be a CSS ${css} value such as ${k === "tooltipRadius" ? '"6px"' : '"none"'}, got ${String(out[k])}`);
  }
  if (out.palette.length === 0) throw new RangeError("alphacharts: theme.palette needs at least one colour");
  if (out.sequential.length < 2) throw new RangeError("alphacharts: theme.sequential needs at least two colours");
  return out;
}
