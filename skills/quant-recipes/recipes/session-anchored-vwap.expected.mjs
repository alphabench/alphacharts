// An offset of -180 minutes puts the session boundary at 03:00 UTC, inside the 300 seeded 1-minute bars (bar 180).
export const inputs = { off: -180 };

export function expected(bars, { off }) {
  const n = bars.close.length;
  const day = (t) => Math.floor((t + off * 60000) / 86400000);
  const out = [];
  let pv = 0, vol = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && day(bars.time[i]) !== day(bars.time[i - 1])) { pv = 0; vol = 0; }
    pv += ((bars.high[i] + bars.low[i] + bars.close[i]) / 3) * bars.volume[i];
    vol += bars.volume[i];
    out.push(pv / vol);
  }
  return { VWAP: out };
}
