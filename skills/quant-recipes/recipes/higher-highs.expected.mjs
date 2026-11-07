import { NA, blank } from "./helpers.mjs";

// A swing high is the highest of the `left` bars before a bar, itself and the `right` bars after it, known `right` bars later. A HIGHER high is a
// swing high above the swing high before it (not every swing); a higher low is a swing low above the swing low before it. The mark is on the bar
// that confirms the swing. Plain loops over the windows; nothing shared with the script's expression.
export const inputs = { left: 3, right: 2 };
// The marks are shifted back by `right` (offset=-right), so each sits on the swing bar itself while its column is true on the bar that confirms it.
export const offsets = { "Higher high": -2, "Higher low": -2 };

function marks(bars, { left, right }, everySwing = false) {
  const n = bars.high.length;
  const hh = new Array(n).fill(false), hl = new Array(n).fill(false);
  let lastHigh = NA, lastLow = NA;
  for (let i = 0; i < n; i++) {
    const c = i - right; // the candidate bar, confirmed now
    if (c < left) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = c - left; j <= c + right; j++) { hi = Math.max(hi, bars.high[j]); lo = Math.min(lo, bars.low[j]); }
    if (bars.high[c] === hi) {
      if (everySwing || (!Number.isNaN(lastHigh) && bars.high[c] > lastHigh)) hh[i] = true;
      lastHigh = bars.high[c];
    }
    if (bars.low[c] === lo) {
      if (everySwing || (!Number.isNaN(lastLow) && bars.low[c] > lastLow)) hl[i] = true;
      lastLow = bars.low[c];
    }
  }
  return { hh, hl };
}

export function expected(bars, inp) {
  const n = bars.high.length;
  const good = marks(bars, inp), every = marks(bars, inp, true);
  // The fixture only tests the formula if marking every swing gives other marks on these bars, and if some swing is not a higher one.
  if (JSON.stringify(good.hh) === JSON.stringify(every.hh) || JSON.stringify(good.hl) === JSON.stringify(every.hl))
    throw new Error("the seeded bars cannot tell a higher high or low from any swing");
  const out = { "Higher high": blank(n), "Higher low": blank(n) };
  for (let i = 0; i < n; i++) {
    if (good.hh[i]) out["Higher high"][i] = 1; // plotshape puts 1 on a marked bar and na elsewhere
    if (good.hl[i]) out["Higher low"][i] = 1;
  }
  return out;
}
