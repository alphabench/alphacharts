import { NA } from "./helpers.mjs";

// An offset of -180 minutes puts the session boundary at 03:00 UTC, inside the 300 seeded 1-minute bars (bar 180).
export const inputs = { off: -180 };

export function expected(bars, { off }) {
  const n = bars.close.length;
  const day = (t) => Math.floor((t + off * 60000) / 86400000);
  const now = [], prev = [];
  let pv = 0, vol = 0, last = NA;
  for (let i = 0; i < n; i++) {
    if (i > 0 && day(bars.time[i]) !== day(bars.time[i - 1])) { last = pv / vol; pv = 0; vol = 0; }
    pv += ((bars.high[i] + bars.low[i] + bars.close[i]) / 3) * bars.volume[i];
    vol += bars.volume[i];
    now.push(pv / vol); prev.push(last);
  }
  // The trap this recipe answers: the previous BAR's VWAP is not the previous session's. It must differ on these bars.
  const barBefore = now.map((_, i) => (i === 0 ? NA : now[i - 1]));
  if (barBefore.every((v, i) => Object.is(v, prev[i]) || Math.abs(v - prev[i]) < 1e-12)) throw new Error("the seeded bars cannot tell the previous session's VWAP from the previous bar's");
  return { "Session VWAP": now, "Previous session VWAP": prev };
}
