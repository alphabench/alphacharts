import { NA, blank } from "./helpers.mjs";

// A bar is a swing high when it is the highest of the `left` bars before it, itself and the `right` bars after it, so it is only
// known `right` bars later. The two lines hold the latest and the previous swing high from the bar that confirms each; the fill is
// the region between them (a fill has no column of its own, so the two lines it joins are what is checked).
export const inputs = { left: 3, right: 2 };

export function expected(bars, { left, right }) {
  const n = bars.high.length;
  const latest = blank(n), previous = blank(n);
  let last = NA, prev = NA;
  for (let i = 0; i < n; i++) {
    const c = i - right; // the candidate bar
    if (c - left >= 0) {
      let hi = -Infinity;
      for (let j = c - left; j <= c + right; j++) hi = Math.max(hi, bars.high[j]);
      if (bars.high[c] === hi) { prev = last; last = bars.high[c]; }
    }
    latest[i] = last; previous[i] = prev;
  }
  return { "Latest swing high": latest, "Previous swing high": previous };
}
