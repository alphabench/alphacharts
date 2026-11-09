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
}

// The categorical palette is the core theme's (shadcn's --chart-1 … --chart-5, Luma's greys by default).
export const PLOT_LIGHT: PlotTheme = {
  ...LIGHT,
  palette: LIGHT.palette!,
  sequential: ["#f5f5f5", "#d4d4d4", "#737373", "#171717"],
  diverging: ["#ef4444", "#f5f5f5", "#10b981"],
  tooltipBackground: "#ffffff",
  tooltipText: "#0a0a0a",
};

export const PLOT_DARK: PlotTheme = {
  ...DARK,
  palette: DARK.palette!,
  sequential: ["#171717", "#404040", "#a3a3a3", "#fafafa"],
  diverging: ["#ef4444", "#171717", "#10b981"],
  tooltipBackground: "#171717",
  tooltipText: "#fafafa",
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
  return resolveTheme({
    ...t,
    palette: t.palette!,
    sequential: [mix(bg, fg, 0.04), mix(bg, fg, 0.2), mix(bg, fg, 0.55), fg],
    diverging: [t.down, mix(bg, fg, 0.06), t.up],
    tooltipBackground: token("popover") ?? bg,
    tooltipText: token("popover-foreground") ?? fg,
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
  if (out.palette.length === 0) throw new RangeError("alphacharts: theme.palette needs at least one colour");
  if (out.sequential.length < 2) throw new RangeError("alphacharts: theme.sequential needs at least two colours");
  return out;
}
