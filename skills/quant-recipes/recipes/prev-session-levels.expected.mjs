import { NA, blank } from "./helpers.mjs";

// An offset of -120 minutes puts the day boundary at 02:00 UTC, bar 120 of the 300 seeded 1-minute bars.
export const inputs = { off: -120 };

export function expected(bars, { off }) {
  const n = bars.close.length;
  const day = (i) => Math.floor((bars.time[i] + off * 60000) / 86400000);
  const hi = blank(n), lo = blank(n), cl = blank(n);
  let runHigh = bars.high[0], runLow = bars.low[0], pHigh = NA, pLow = NA, pClose = NA;
  for (let i = 0; i < n; i++) {
    if (i > 0 && day(i) !== day(i - 1)) {
      pHigh = runHigh; pLow = runLow; pClose = bars.close[i - 1];
      runHigh = bars.high[i]; runLow = bars.low[i];
    } else if (i > 0) {
      runHigh = Math.max(runHigh, bars.high[i]); runLow = Math.min(runLow, bars.low[i]);
    }
    hi[i] = pHigh; lo[i] = pLow; cl[i] = pClose;
  }
  return { "Previous high": hi, "Previous low": lo, "Previous close": cl };
}
