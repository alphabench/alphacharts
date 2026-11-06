import { barsPerYear, blank, logReturns, sampleSd } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }) {
  const r = logReturns(bars.close);
  const ppy = barsPerYear(Array.from(bars.time));
  const hv = blank(r.length);
  for (let i = len; i < r.length; i++) hv[i] = sampleSd(r.slice(i - len + 1, i + 1)) * Math.sqrt(ppy[i]) * 100;
  return { HV: hv };
}
