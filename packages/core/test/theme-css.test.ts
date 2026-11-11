// The mapping from CSS variables to a chart theme (src/chart/theme-css.ts), without a DOM: the colour converter is a stub.
// The real conversion (oklch, color-mix ...) through a canvas is checked in a browser (bench/tests/ui.spec.ts).

import { describe, expect, it } from "vitest";
import { LUMA_DARK, LUMA_LIGHT, THEME_VARIABLES, isColorSlot, resolveColor, sameTheme, slotAlpha, themeFromTokens } from "../src/index.js";

/** Reads hex and rgb() as they are, and `oklch(L 0 0)` as a grey, enough for these cases. */
const toRgb = (css: string): string => {
  const g = /^oklch\(\s*([\d.]+)\s+0\s+0(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(css.trim());
  if (g) {
    const v = Math.round(+g[1]! * 255);
    const a = g[2] === undefined ? 1 : g[2].endsWith("%") ? parseFloat(g[2]) / 100 : +g[2];
    return a >= 1 ? `#${[v, v, v].map((x) => x.toString(16).padStart(2, "0")).join("")}` : `rgba(${v},${v},${v},${a})`;
  }
  const h = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(css.trim());
  if (h) { const v = Math.round((+h[3]! / 100) * 255); return `#${[v, v, v].map((x) => x.toString(16).padStart(2, "0")).join("")}`; }
  if (/^#[0-9a-f]{6}$/i.test(css) || /^rgba?\(/.test(css)) return css;
  throw new TypeError(`not a colour: ${css}`);
};
const tokens = (o: Record<string, string>) => (n: string) => o[n];

describe("themeFromTokens", () => {
  it("with no variables at all, is the Luma palette for the page's scheme", () => {
    expect(themeFromTokens(tokens({}), toRgb, false)).toEqual(LUMA_LIGHT);
    expect(themeFromTokens(tokens({}), toRgb, true)).toEqual(LUMA_DARK);
  });

  it("reads the shadcn tokens, and derives what shadcn has no token for from them", () => {
    const t = themeFromTokens(tokens({ "--background": "#101010", "--foreground": "#f0f0f0", "--muted-foreground": "#808080", "--border": "#303030", "--primary": "#3366ff" }), toRgb, true);
    expect(t).toMatchObject({ background: "#101010", text: "#f0f0f0", textMuted: "#808080", border: "#303030", accent: "#3366ff" });
    expect(t.grid).toBe("#202020"); // halfway from the background to the border
    expect(t.crosshair).toBe("#808080"); // the muted foreground
    expect([t.labelBackground, t.labelText]).toEqual(["#f0f0f0", "#101010"]); // an inverted pill
    expect(t.extendedHours).toBe("rgba(51,102,255,0.07)");
    // not given: the palette's own up and down
    expect([t.up, t.down]).toEqual([LUMA_DARK.up, LUMA_DARK.down]);
  });

  it("--chart-up and --chart-down set the candles; --ac-* beats the shadcn token; overrides beat everything", () => {
    const t = themeFromTokens(tokens({ "--chart-up": "#00aa00", "--chart-down": "#aa0000", "--primary": "#111111", "--ac-primary": "#ff00ff", "--ac-chart-up": "#00ff00" }), toRgb, false, { down: "#123456" });
    expect([t.up, t.down, t.accent]).toEqual(["#00ff00", "#123456", "#ff00ff"]);
  });

  it("reads oklch like shadcn v4, hsl triples like shadcn v3, and flattens a translucent border onto the background", () => {
    const v4 = themeFromTokens(tokens({ "--background": "oklch(0.1 0 0)", "--border": "oklch(1 0 0 / 10%)" }), toRgb, true);
    expect(v4.background).toBe("#1a1a1a");
    // white at 10% over #1a1a1a: 0.1 * 255 + 0.9 * 26 = 48.9 -> 49 = 0x31
    expect(v4.border).toBe("#313131");
    const v3 = themeFromTokens(tokens({ "--background": "0 0% 10%" }), toRgb, true);
    expect(v3.background).toBe("#1a1a1a");
  });

  it("an explicit grid, crosshair or label colour is kept as given", () => {
    const t = themeFromTokens(tokens({ "--ac-grid": "#222222", "--ac-crosshair": "#abcdef", "--ac-label-background": "#010101", "--ac-label-text": "#fefefe" }), toRgb, false);
    expect([t.grid, t.crosshair, t.labelBackground, t.labelText]).toEqual(["#222222", "#abcdef", "#010101", "#fefefe"]);
  });

  it("takes the font family and size from the variables", () => {
    const t = themeFromTokens(tokens({ "--font-sans": "Geist, sans-serif", "--ac-font-size": "13px" }), toRgb, false);
    expect([t.fontFamily, t.fontSize]).toEqual(["Geist, sans-serif", 13]);
    expect(themeFromTokens(tokens({ "--ac-font-sans": "Mono", "--font-sans": "Geist" }), toRgb, false).fontFamily).toBe("Mono");
  });

  it("a variable that is set but is not a colour throws, naming the variable", () => {
    expect(() => themeFromTokens(tokens({ "--border": "banana" }), toRgb, false)).toThrow(/--border is "banana"/);
  });

  it("lists every variable it reads", () => {
    for (const v of ["--background", "--foreground", "--muted-foreground", "--border", "--primary", "--chart-up", "--chart-down", "--font-sans", "--ac-chart-up", "--ac-background", "--ac-primary"]) expect(THEME_VARIABLES).toContain(v);
  });

  it("reads the focus ring from --ac-ring, then --ring; unset leaves the theme without one", () => {
    expect(themeFromTokens(tokens({ "--ring": "#222222" }), toRgb, false).focusRing).toBe("#222222");
    expect(themeFromTokens(tokens({ "--ring": "#222222", "--ac-ring": "#333333" }), toRgb, false).focusRing).toBe("#333333");
    expect(themeFromTokens(tokens({}), toRgb, false).focusRing).toBeUndefined();
    for (const v of ["--ac-ring", "--ring"]) expect(THEME_VARIABLES).toContain(v);
  });

  it("reads the data palette from --chart-1 … --chart-5, the Luma one filling any the page leaves out", () => {
    const t = themeFromTokens(tokens({ "--chart-1": "#111111", "--ac-chart-3": "#333333", "--chart-3": "#999999" }), toRgb, true);
    expect(t.palette).toEqual(["#111111", LUMA_DARK.palette![1], "#333333", LUMA_DARK.palette![3], LUMA_DARK.palette![4]]);
  });
});

describe("colour slots", () => {
  it("name a role, drawn with the theme's colour, with an optional opacity", () => {
    expect(resolveColor("chart-1", LUMA_LIGHT)).toBe(LUMA_LIGHT.palette![0]);
    expect(resolveColor("chart-5", LUMA_DARK)).toBe(LUMA_DARK.palette![4]);
    expect(resolveColor("chart-up", LUMA_DARK)).toBe(LUMA_DARK.up);
    expect(resolveColor("muted", LUMA_LIGHT)).toBe(LUMA_LIGHT.textMuted);
    expect(resolveColor("chart-down/0.5", LUMA_LIGHT)).toBe("rgba(239,68,68,0.5)");
    expect(resolveColor("#123456", LUMA_LIGHT)).toBe("#123456");
    expect(isColorSlot("chart-6")).toBe(false);
    expect(slotAlpha("chart-2/0.5", 0.5)).toBe("chart-2/0.25");
    expect(slotAlpha("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
  });

  it("a theme without a palette draws with the Luma greys for its background", () => {
    const { palette: _, ...bare } = LUMA_DARK;
    expect(resolveColor("chart-1", bare)).toBe(LUMA_DARK.palette![0]);
  });

  it("sameTheme: equal when every key and the palette's colours match, whatever the arrays' identity", () => {
    expect(sameTheme(LUMA_DARK, { ...LUMA_DARK, palette: [...LUMA_DARK.palette!] })).toBe(true);
    expect(sameTheme(LUMA_DARK, { ...LUMA_DARK, accent: "#ff0000" })).toBe(false);
    expect(sameTheme(LUMA_DARK, { ...LUMA_DARK, palette: ["#000000", ...LUMA_DARK.palette!.slice(1)] })).toBe(false);
  });
});
