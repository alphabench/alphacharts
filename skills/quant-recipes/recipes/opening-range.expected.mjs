import { NA, blank } from "./helpers.mjs";

// The range is the first `span` minutes after the session's first bar, whatever time that bar has: no session start is
// typed in. An offset of -180 minutes puts the day boundary at 03:00 UTC, inside the 300 seeded 1-minute bars (bar 180), so
// the range is bars 180 to 209. The first day loaded is partial, its first bar is not a session start, and it draws nothing.
// A bar is in the range only if it ENDS inside it: its open plus the bar length (the least gap between neighbouring bars over
// the last 10 bars) is not after the range's end. So on a bar longer than the range nothing is drawn: a 30-minute range on
// hourly bars would otherwise be the first hour's high and low. (The hourly case is proved in
// packages/script/test/session-recipes.test.ts.)
export const inputs = { off: -180, span: 30 };

export function expected(bars, { off, span }) {
  const n = bars.close.length;
  const day = (t) => Math.floor((t + off * 60000) / 86400000);
  const hi = blank(n), lo = blank(n);
  let h = NA, l = NA, start = NA;
  for (let i = 0; i < n; i++) {
    let step = NA; // least gap between neighbouring bars over the last 10 bars, na until there are 10 gaps
    if (i >= 10) { step = Infinity; for (let k = i - 9; k <= i; k++) step = Math.min(step, bars.time[k] - bars.time[k - 1]); }
    if (i > 0 && day(bars.time[i]) !== day(bars.time[i - 1])) { h = NA; l = NA; start = bars.time[i]; }
    if (bars.time[i] - start + step <= span * 60000) {
      h = Number.isNaN(h) ? bars.high[i] : Math.max(h, bars.high[i]);
      l = Number.isNaN(l) ? bars.low[i] : Math.min(l, bars.low[i]);
    }
    hi[i] = h; lo[i] = l;
  }
  return { "Opening range high": hi, "Opening range low": lo };
}
