// Where the tooltip goes: beside the pointer, kept inside a box.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 14;

/**
 * Top-left of a `w` x `h` tooltip for a pointer at (`px`, `py`), inside `bounds` with `margin` px to spare. It sits right of and below the
 * pointer, flips to the left of it when it would cross the right edge, and is pushed up when it would cross the bottom. A tooltip
 * larger than the box is pinned to its top-left corner. Whole pixels.
 */
export function placeTooltip(px: number, py: number, w: number, h: number, bounds: Box, margin: number): { x: number; y: number } {
  let x = px + GAP, y = py + GAP;
  if (x + w > bounds.x + bounds.w - margin) x = px - w - GAP;
  if (y + h > bounds.y + bounds.h - margin) y = bounds.y + bounds.h - h - margin;
  return { x: Math.max(bounds.x + margin, Math.round(x)), y: Math.max(bounds.y + margin, Math.round(y)) };
}
