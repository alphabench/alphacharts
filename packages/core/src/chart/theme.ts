// Theme tokens. Everything visual the chart draws comes from here or from
// series options; nothing is branded. Switch live with chart.applyOptions({ theme }).

export interface Theme {
  background: string;
  text: string;
  /** Secondary text: axis labels. */
  textMuted: string;
  grid: string;
  border: string;
  crosshair: string;
  /** Background of crosshair/axis labels. */
  labelBackground: string;
  labelText: string;
  fontFamily: string;
  /** CSS px. */
  fontSize: number;
  up: string;
  down: string;
  accent: string;
  /** Shade behind bars outside regular trading hours. */
  extendedHours: string;
}

export const DARK: Theme = {
  background: "#0f1115",
  text: "#d1d4dc",
  textMuted: "#8b909a",
  grid: "#1c2028",
  border: "#2a2e39",
  crosshair: "#9598a1",
  labelBackground: "#363a45",
  labelText: "#e9eaee",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontSize: 11,
  up: "#26a69a",
  down: "#ef5350",
  accent: "#2962ff",
  extendedHours: "rgba(41,98,255,0.06)",
};

export const LIGHT: Theme = {
  background: "#ffffff",
  text: "#131722",
  textMuted: "#5d606b",
  grid: "#f0f3fa",
  border: "#e0e3eb",
  crosshair: "#9598a1",
  labelBackground: "#131722",
  labelText: "#ffffff",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontSize: 11,
  up: "#089981",
  down: "#f23645",
  accent: "#2962ff",
  extendedHours: "rgba(41,98,255,0.05)",
};

/** WCAG AAA contrast for text and marks; no translucent grid. */
export const HIGH_CONTRAST: Theme = {
  background: "#000000",
  text: "#ffffff",
  textMuted: "#ffffff",
  grid: "#3a3a3a",
  border: "#ffffff",
  crosshair: "#ffffff",
  labelBackground: "#ffffff",
  labelText: "#000000",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontSize: 12,
  up: "#00ff7f",
  down: "#ff4d4d",
  accent: "#4da3ff",
  extendedHours: "rgba(255,255,255,0.12)",
};

/** Dark, light or high contrast, from the OS preferences right now. */
export function systemTheme(): Theme {
  if (typeof matchMedia === "undefined") return DARK;
  if (matchMedia("(prefers-contrast: more)").matches) return HIGH_CONTRAST;
  return matchMedia("(prefers-color-scheme: light)").matches ? LIGHT : DARK;
}

