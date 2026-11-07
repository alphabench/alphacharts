import { NA, blank } from "./helpers.mjs";

// A bar is a swing high when it is the highest of the `left` bars before it, itself and the `right` bars after it, so it is only
// known `right` bars later. Plain loops over the window; nothing shared with the script's expression.
export const inputs = { left: 3, right: 2 };
// The marks are shifted back by `right` (offset=-right), so each sits on the swing bar itself while its column is true on the bar that confirms it.
export const offsets = { "Swing high": -2, "Swing low": -2 };

function swings(bars, { left, right }, wrongForm = false) {
  const n = bars.high.length;
  const high = [], low = [];
  const flagHigh = new Array(n).fill(false), flagLow = new Array(n).fill(false);
  let lh = NA, ph = NA, ll = NA, pl = NA;
  for (let i = 0; i < n; i++) {
    const c = i - right; // the candidate bar
    // the window the swing is judged over: from `left` bars before the candidate to `right` bars after it
    // (the wrong form judges it over the `left + right` bars up to the candidate and the candidate itself)
    const from = wrongForm ? c - left - right : c - left;
    const to = wrongForm ? c : c + right;
    if (c >= 0 && from >= 0 && to <= i) {
      let hi = -Infinity, lo = Infinity;
      for (let j = from; j <= to; j++) { hi = Math.max(hi, bars.high[j]); lo = Math.min(lo, bars.low[j]); }
      if (bars.high[c] === hi) { flagHigh[i] = true; ph = lh; lh = bars.high[c]; }
      if (bars.low[c] === lo) { flagLow[i] = true; pl = ll; ll = bars.low[c]; }
    }
    high.push([lh, ph]); low.push([ll, pl]);
  }
  return { high, low, flagHigh, flagLow };
}

export function expected(bars, inp) {
  const n = bars.high.length;
  const good = swings(bars, inp), wrong = swings(bars, inp, true);
  // The fixture is only a test of the formula if the wrong form (the window ending `right` bars back) gives other lines on these bars.
  if (JSON.stringify(good.high) === JSON.stringify(wrong.high)) throw new Error("the seeded bars cannot tell the right swing from the unconfirmed one");
  const out = { "Last swing high": blank(n), "Previous swing high": blank(n), "Last swing low": blank(n), "Previous swing low": blank(n), "Swing high": blank(n), "Swing low": blank(n) };
  for (let i = 0; i < n; i++) {
    if (good.flagHigh[i]) out["Swing high"][i] = 1; // plotshape puts 1 on a marked bar and na elsewhere
    if (good.flagLow[i]) out["Swing low"][i] = 1;
    out["Last swing high"][i] = good.high[i][0]; out["Previous swing high"][i] = good.high[i][1];
    out["Last swing low"][i] = good.low[i][0]; out["Previous swing low"][i] = good.low[i][1];
  }
  return out;
}
