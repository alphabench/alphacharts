// Plot theme: the core's tokens plus the colours a plot needs (a categorical
// palette and the ramps). The host passes resolved colours (hex or rgb()).

import { DARK, LIGHT, systemTheme, parseColor, type Theme } from "@alphacharts/core";

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

const PALETTE_LIGHT = ["#2962ff", "#f57c00", "#089981", "#d81b60", "#7b1fa2", "#00838f", "#689f38", "#6d4c41"] as const;
const PALETTE_DARK = ["#5c8dff", "#ffa726", "#26a69a", "#f06292", "#ba68c8", "#26c6da", "#9ccc65", "#a1887f"] as const;

export const PLOT_LIGHT: PlotTheme = {
  ...LIGHT,
  palette: PALETTE_LIGHT,
  sequential: ["#eef3ff", "#9db8ff", "#2962ff", "#0a2a8a"],
  diverging: ["#f23645", "#f4f5f8", "#089981"],
  tooltipBackground: "#ffffff",
  tooltipText: "#131722",
};

export const PLOT_DARK: PlotTheme = {
  ...DARK,
  palette: PALETTE_DARK,
  sequential: ["#1a2440", "#2f4fa8", "#5c8dff", "#c9d8ff"],
  diverging: ["#ef5350", "#1c2028", "#26a69a"],
  tooltipBackground: "#1c2028",
  tooltipText: "#e9eaee",
};

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
