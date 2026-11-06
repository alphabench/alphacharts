import { NA, blank } from "./helpers.mjs";

// UTC clock, a range starting at minute 60 (01:00) and lasting 30 minutes: seeded 1-minute bars 60 to 89.
export const inputs = { off: 0, start: 60, span: 30 };

export function expected(bars, { off, start, span }) {
  const n = bars.close.length;
  const hi = blank(n), lo = blank(n);
  let h = NA, l = NA, prevDay = null;
  for (let i = 0; i < n; i++) {
    const local = bars.time[i] + off * 60000;
    const day = Math.floor(local / 86400000);
    if (prevDay !== null && day !== prevDay) { h = NA; l = NA; }
    prevDay = day;
    const minute = Math.floor((local - day * 86400000) / 60000);
    if (minute >= start && minute < start + span) {
      h = Number.isNaN(h) ? bars.high[i] : Math.max(h, bars.high[i]);
      l = Number.isNaN(l) ? bars.low[i] : Math.min(l, bars.low[i]);
    }
    hi[i] = h; lo[i] = l;
  }
  return { "Opening range high": hi, "Opening range low": lo };
}
