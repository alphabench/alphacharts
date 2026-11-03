// The shell's colours are the core theme's tokens, nothing else. Surfaces,
// hovers and shadows are mixed from them in CSS (color-mix), so a custom
// theme, dark, light and high contrast all re-skin the whole shell.

import { DARK, HIGH_CONTRAST, LIGHT, parseColor, systemTheme, type Theme } from "@alphacharts/core";
import type { ThemeName } from "./types.js";

export function resolveTheme(name: ThemeName, custom: Partial<Theme> | null, base: Theme = DARK): Theme {
  switch (name) {
    case "dark": return DARK;
    case "light": return LIGHT;
    case "high-contrast": return HIGH_CONTRAST;
    case "auto": return systemTheme();
    case "custom": {
      const t = { ...base, ...custom };
      for (const k of Object.keys(t) as (keyof Theme)[]) if (k !== "fontFamily" && k !== "fontSize") parseColor(t[k] as string);
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

/** The CSS custom properties of a theme (set on the shell's root). */
export function themeVars(t: Theme): Record<string, string> {
  return {
    "--ac-bg": t.background,
    "--ac-text": t.text,
    "--ac-muted": t.textMuted,
    "--ac-grid": t.grid,
    "--ac-border": t.border,
    "--ac-accent": t.accent,
    "--ac-on-accent": textOn(t.accent),
    "--ac-up": t.up,
    "--ac-down": t.down,
    "--ac-label-bg": t.labelBackground,
    "--ac-label-text": t.labelText,
    "--ac-crosshair": t.crosshair,
    "--ac-font": t.fontFamily,
    "--ac-font-size": `${Math.max(12, t.fontSize + 2)}px`,
  };
}
