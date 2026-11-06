import { blank, div, logReturns, sampleSd } from "./helpers.mjs";

export const inputs = { fast: 10, slow: 50 };

export function expected(bars, { fast, slow }) {
  const r = logReturns(bars.close);
  const out = blank(r.length);
  for (let i = slow; i < r.length; i++) out[i] = div(sampleSd(r.slice(i - fast + 1, i + 1)), sampleSd(r.slice(i - slow + 1, i + 1)));
  return { Ratio: out };
}
