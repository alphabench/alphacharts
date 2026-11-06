import { barsPerYear, blank, div, mean, sampleSd, simpleReturns } from "./helpers.mjs";

export const inputs = { len: 60 };

// Run on the sessions the checker builds for bars_per_year (25 bars a day, 6,300 bars a year after the first finished day).
export function expected(bars, { len }) {
  const r = simpleReturns(bars.close);
  const ppy = barsPerYear(Array.from(bars.time));
  const out = blank(r.length);
  for (let i = len; i < r.length; i++) {
    const w = r.slice(i - len + 1, i + 1);
    out[i] = div(mean(w), sampleSd(w)) * Math.sqrt(ppy[i]);
  }
  return { Sharpe: out };
}
