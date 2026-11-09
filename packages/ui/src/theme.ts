// The shell's colours are the core theme's tokens, nothing else. Surfaces,
// hovers and shadows are mixed from them in CSS (color-mix), so a custom
// theme, dark, light and high contrast all re-skin the whole shell.

import { DARK, HIGH_CONTRAST, LIGHT, LUMA_TOKENS, SHADCN_TOKENS, parseColor, systemTheme, themeFromCss, type ShadcnToken, type Theme, type TokenSet } from "@alphacharts/core";
import type { ThemeName } from "./types.js";

/**
 * `host` is the element whose CSS variables "inherit" reads (the shadcn names, see core's theme-css.ts); the others are fixed
 * palettes: "dark" (black) and "light" are the Luma ones.
 */
export function resolveTheme(name: ThemeName, custom: Partial<Theme> | null, base: Theme = DARK, host?: Element): Theme {
  switch (name) {
    case "inherit": return host ? themeFromCss(host, custom ?? {}) : { ...base, ...(custom ?? {}) };
    case "dark": return DARK;
    case "light": return LIGHT;
    case "high-contrast": return HIGH_CONTRAST;
    case "auto": return systemTheme();
    case "custom": {
      const t = { ...base, ...custom };
      for (const k of Object.keys(t) as (keyof Theme)[]) {
        if (k === "palette") t.palette!.forEach((c) => parseColor(c));
        else if (k !== "fontFamily" && k !== "fontSize") parseColor(t[k] as string);
      }
      return t;
    }
  }
}

/** WCAG relative luminance of a core colour. */
function luminance(css: string): number {
  const c = parseColor(css);
  const ch = [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function textOn(bg: string): string {
  return contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
}

/** Whether a theme is a dark one, by its background. */
export function isDark(t: Theme): boolean {
  return textOn(t.background) === "#ffffff";
}

/**
 * The theme's own token values, `--t-<token>`, which the stylesheet uses where neither an `--ac-*` override nor (under "inherit")
 * the host's shadcn token is set. The named Luma themes, and "inherit", give the Luma set for their mode; any other theme
 * (high contrast, custom, the OS's) derives the set from its colours, so its menus and dialogs match its canvas.
 */
export function themeVars(t: Theme, name: ThemeName): Record<string, string> {
  const dark = isDark(t);
  const luma: TokenSet = dark ? LUMA_TOKENS.dark : LUMA_TOKENS.light;
  let set: Record<ShadcnToken, string> = { ...luma };
  if (name !== "inherit" && name !== "dark" && name !== "light") {
    const bg = t.background, fg = t.text;
    const raised = `color-mix(in oklab, ${bg} 96%, ${fg})`;
    const soft = `color-mix(in oklab, ${bg} 88%, ${fg})`;
    set = {
      ...luma, background: bg, foreground: fg, card: raised, "card-foreground": fg, popover: raised, "popover-foreground": fg,
      primary: t.accent, "primary-foreground": textOn(t.accent), secondary: soft, "secondary-foreground": fg, muted: soft,
      "muted-foreground": t.textMuted, accent: soft, "accent-foreground": fg, destructive: t.down, border: t.border, input: t.border,
      ring: t.textMuted, "chart-up": t.up, "chart-down": t.down,
    };
  } else {
    set = { ...set, "chart-up": t.up, "chart-down": t.down };
  }
  const out: Record<string, string> = {};
  for (const k of SHADCN_TOKENS) out[`--t-${k}`] = set[k];
  return out;
}
