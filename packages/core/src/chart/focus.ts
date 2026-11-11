// The keyboard focus indication of the chart root: a 2 px ring, only when the focus is the keyboard's
// (`:focus-visible`), so a pointer press does not draw it. Without it a keyboard user cannot see that the chart has focus.

import { cssColor, parseColor } from "../render/color.js";
import type { Theme } from "./theme.js";

/** The ring's colour: `theme.focusRing`, else the crosshair colour. */
export function focusRingColor(theme: Theme): string {
  return theme.focusRing ?? theme.crosshair;
}

/** The part of an element the ring needs: a style, `matches` and listeners. */
export interface FocusTarget {
  style: { outline: string; outlineOffset: string };
  matches(selector: string): boolean;
  addEventListener(type: "focus" | "blur" | "keydown", listener: () => void): void;
}

function focusVisible(el: FocusTarget): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    // An engine without :focus-visible: show the ring rather than leave a keyboard user without one.
    return true;
  }
}

/** Shows the ring on `el` while it has keyboard focus. Returns the function that redraws it (after a theme change). */
export function installFocusRing(el: FocusTarget, theme: () => Theme): () => void {
  let focused = false;
  const paint = (): void => {
    if (focused && focusVisible(el)) {
      el.style.outline = `2px solid ${cssColor(parseColor(focusRingColor(theme())))}`;
      el.style.outlineOffset = "-2px"; // inside the box: the root clips its overflow
    } else {
      el.style.outline = "none";
      el.style.outlineOffset = "";
    }
  };
  el.addEventListener("focus", () => {
    focused = true;
    paint();
  });
  el.addEventListener("blur", () => {
    focused = false;
    paint();
  });
  // A key pressed after a pointer focus makes the focus keyboard-driven without a new focus event.
  el.addEventListener("keydown", paint);
  return paint;
}
