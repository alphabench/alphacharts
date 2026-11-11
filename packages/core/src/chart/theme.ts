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
  /**
   * The keyboard focus ring (a 2 px outline on the chart, shown only for keyboard focus). Default: `crosshair`.
   * Under `"inherit"`: `--ac-ring`, then shadcn's `--ring`.
   */
  focusRing?: string;
  /** Shade behind bars outside regular trading hours. */
  extendedHours: string;
  /**
   * The data colours, shadcn's `--chart-1` … `--chart-5`: studies, Fibonacci levels and compared symbols name a slot
   * (`"chart-1"` …) instead of a colour, and draw with this theme's. Default: the Luma greys for the theme's background.
   */
  palette?: readonly string[];
}

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** shadcn/ui's colour tokens (the CSS variables without `--`), plus the two a price chart needs and shadcn has no name for. */
export const SHADCN_TOKENS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground",
  "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input",
  "ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-up", "chart-down",
] as const;
export type ShadcnToken = (typeof SHADCN_TOKENS)[number];
export type TokenSet = Readonly<Record<ShadcnToken, string>>;

/**
 * shadcn's Luma preset (neutral) as sRGB: every token the shell and the charts use, light and dark. Dark is Luma on pure black:
 * the surfaces step up from black by the preset's own lightness steps, greys only. The data colours `chart-1` … `chart-5` are
 * Luma's neutral greys ordered by contrast with the background, so the first series is the most legible on either. The one source of the default look: the chart
 * palettes below and the shell's stylesheet are built from it.
 */
export const LUMA_TOKENS: Readonly<{ light: TokenSet; dark: TokenSet }> = {
  light: {
    background: "#ffffff", foreground: "#0a0a0a", card: "#ffffff", "card-foreground": "#0a0a0a", popover: "#ffffff", "popover-foreground": "#0a0a0a",
    primary: "#171717", "primary-foreground": "#fafafa", secondary: "#f5f5f5", "secondary-foreground": "#171717", muted: "#f5f5f5",
    "muted-foreground": "#737373", accent: "#f5f5f5", "accent-foreground": "#171717", destructive: "#e7000b", border: "#e5e5e5", input: "#e5e5e5",
    ring: "#a1a1a1", "chart-1": "#262626", "chart-2": "#525252", "chart-3": "#737373", "chart-4": "#a3a3a3", "chart-5": "#c4c4c4",
    "chart-up": "#10b981", "chart-down": "#ef4444",
  },
  dark: {
    background: "#000000", foreground: "#fafafa", card: "#0a0a0a", "card-foreground": "#fafafa", popover: "#0a0a0a", "popover-foreground": "#fafafa",
    primary: "#e5e5e5", "primary-foreground": "#171717", secondary: "#1f1f1f", "secondary-foreground": "#fafafa", muted: "#1f1f1f",
    "muted-foreground": "#a3a3a3", accent: "#1f1f1f", "accent-foreground": "#fafafa", destructive: "#ff6467", border: "rgba(255,255,255,0.1)",
    input: "rgba(255,255,255,0.15)", ring: "#737373", "chart-1": "#e5e5e5", "chart-2": "#a3a3a3", "chart-3": "#737373", "chart-4": "#525252",
    "chart-5": "#404040", "chart-up": "#10b981", "chart-down": "#ef4444",
  },
};
const LT = LUMA_TOKENS.light, DK = LUMA_TOKENS.dark;

/**
 * The default light theme: shadcn's neutral palette (what `--background`, `--foreground`, `--muted-foreground`, `--border` and
 * `--primary` are in a stock shadcn/ui app), as opaque sRGB. Up and down are emerald and red, because shadcn has no token for
 * a rising price; a host sets `--chart-up` / `--chart-down` (or `theme.up` / `theme.down`) to change them.
 */
export const LUMA_LIGHT: Theme = {
  background: LT.background,
  text: LT.foreground,
  textMuted: LT["muted-foreground"],
  grid: "#f1f1f1",
  border: LT.border,
  crosshair: LT["muted-foreground"],
  labelBackground: LT.foreground,
  labelText: LT["primary-foreground"],
  fontFamily: FONT,
  fontSize: 11,
  up: LT["chart-up"],
  down: LT["chart-down"],
  accent: LT.primary,
  palette: [LT["chart-1"], LT["chart-2"], LT["chart-3"], LT["chart-4"], LT["chart-5"]],
  extendedHours: "rgba(115,115,115,0.07)",
};

/** The default dark theme: black, with neutral greys (no blue anywhere), same up and down. */
export const LUMA_DARK: Theme = {
  background: DK.background,
  text: DK.foreground,
  textMuted: DK["muted-foreground"],
  grid: "#121212",
  border: "#262626", // the token is white at 10%: the canvas draws it opaque
  crosshair: DK["muted-foreground"],
  labelBackground: DK.foreground,
  labelText: DK.background,
  fontFamily: FONT,
  fontSize: 11,
  up: DK["chart-up"],
  down: DK["chart-down"],
  accent: DK.primary,
  palette: [DK["chart-1"], DK["chart-2"], DK["chart-3"], DK["chart-4"], DK["chart-5"]],
  extendedHours: "rgba(163,163,163,0.08)",
};

/** The default themes. */
export const DARK: Theme = LUMA_DARK;
export const LIGHT: Theme = LUMA_LIGHT;

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
  accent: "#ffffff",
  extendedHours: "rgba(255,255,255,0.12)",
  palette: ["#ffffff", "#cccccc", "#999999", "#e6e6e6", "#b3b3b3"],
};

/** Dark, light or high contrast, from the OS preferences right now. */
export function systemTheme(): Theme {
  if (typeof matchMedia === "undefined") return DARK;
  if (matchMedia("(prefers-contrast: more)").matches) return HIGH_CONTRAST;
  return matchMedia("(prefers-color-scheme: light)").matches ? LIGHT : DARK;
}

