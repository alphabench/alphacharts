import { describe, expect, it } from "vitest";
import { checkCrosshairLine, crosshairStroke } from "../src/chart/crosshair.js";
import { focusRingColor, installFocusRing, type FocusTarget } from "../src/chart/focus.js";
import { DARK, LIGHT } from "../src/chart/theme.js";

/** An element with just what the ring touches; `visible` is what `:focus-visible` answers. */
function fakeEl(visible: boolean | "throws") {
  const handlers = new Map<string, () => void>();
  const el: FocusTarget & { visible: boolean | "throws" } = {
    visible,
    style: { outline: "none", outlineOffset: "" },
    matches(sel) {
      if (sel !== ":focus-visible") throw new Error(sel);
      if (el.visible === "throws") throw new SyntaxError("unsupported selector");
      return el.visible;
    },
    addEventListener: (t, fn) => void handlers.set(t, fn),
  };
  return { el, fire: (t: string) => handlers.get(t)!() };
}

describe("keyboard focus ring", () => {
  it("defaults to the crosshair colour; the theme's focusRing wins", () => {
    expect(focusRingColor(LIGHT)).toBe(LIGHT.crosshair);
    expect(focusRingColor({ ...DARK, focusRing: "#ff0000" })).toBe("#ff0000");
  });
  it("shows a 2 px outline on keyboard focus and removes it on blur", () => {
    const { el, fire } = fakeEl(true);
    installFocusRing(el, () => ({ ...LIGHT, focusRing: "#ff0000" }));
    expect(el.style.outline).toBe("none");
    fire("focus");
    expect(el.style.outline).toBe("2px solid rgba(255,0,0,1.000)");
    expect(el.style.outlineOffset).toBe("-2px");
    fire("blur");
    expect(el.style.outline).toBe("none");
  });
  it("shows nothing for a pointer focus, until a key makes it keyboard focus", () => {
    const { el, fire } = fakeEl(false);
    installFocusRing(el, () => LIGHT);
    fire("focus");
    expect(el.style.outline).toBe("none");
    el.visible = true;
    fire("keydown");
    expect(el.style.outline).toMatch(/^2px solid /);
  });
  it("an engine without :focus-visible still shows the ring", () => {
    const { el, fire } = fakeEl("throws");
    installFocusRing(el, () => LIGHT);
    fire("focus");
    expect(el.style.outline).toMatch(/^2px solid /);
  });
  it("the returned repaint follows a theme change while focused", () => {
    const { el, fire } = fakeEl(true);
    let theme = { ...LIGHT, focusRing: "#ff0000" };
    const repaint = installFocusRing(el, () => theme);
    fire("focus");
    theme = { ...LIGHT, focusRing: "#0000ff" };
    repaint();
    expect(el.style.outline).toBe("2px solid rgba(0,0,255,1.000)");
  });
});

describe("crosshair line", () => {
  it("unset keeps today's stroke: a device-pixel hairline, 4 px dashes", () => {
    expect(crosshairStroke({}, 2)).toEqual({ lineWidth: 0.5, dash: [4, 4], snapWidth: 1 });
  });
  it("lineStyle uses the price-line patterns; lineWidth is in CSS px", () => {
    expect(crosshairStroke({ lineStyle: "solid" }, 2).dash).toEqual([]);
    expect(crosshairStroke({ lineStyle: "dotted", lineWidth: 2 }, 2)).toEqual({ lineWidth: 2, dash: [2, 4], snapWidth: 2 });
    expect(crosshairStroke({ lineWidth: 1 }, 1)).toMatchObject({ lineWidth: 1, dash: [4, 4] });
  });
  it("refuses a width other than 1 or 2 and an unknown style", () => {
    expect(() => checkCrosshairLine({ lineWidth: 3 as never })).toThrow(/lineWidth must be 1 or 2/);
    expect(() => checkCrosshairLine({ lineStyle: "wavy" as never })).toThrow(/lineStyle "wavy"/);
    expect(() => checkCrosshairLine({ lineStyle: "large-dashed", lineWidth: 2 })).not.toThrow();
    expect(() => checkCrosshairLine({})).not.toThrow();
  });
});
