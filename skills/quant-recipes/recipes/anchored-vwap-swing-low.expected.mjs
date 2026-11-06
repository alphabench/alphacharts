import { NA, blank } from "./helpers.mjs";

// The anchor is the swing low's own bar, `right` bars before the bar that confirms it; the line starts at the confirming bar
// and its average counts every bar from the anchor on, then follows each new swing low.
export const inputs = { left: 3, right: 2 };

export function expected(bars, { left, right }) {
  const n = bars.low.length;
  const out = blank(n);
  let anchor = -1;
  for (let i = 0; i < n; i++) {
    const c = i - right;
    if (c - left >= 0) {
      let lo = Infinity;
      for (let j = c - left; j <= i; j++) lo = Math.min(lo, bars.low[j]);
      if (bars.low[c] === lo) anchor = c;
    }
    if (anchor < 0) { out[i] = NA; continue; }
    let pv = 0, vol = 0;
    for (let j = anchor; j <= i; j++) { pv += ((bars.high[j] + bars.low[j] + bars.close[j]) / 3) * bars.volume[j]; vol += bars.volume[j]; }
    out[i] = pv / vol;
  }
  return { "Anchored VWAP": out };
}
