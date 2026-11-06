import { blank, div, mean, popSd, simpleReturns } from "./helpers.mjs";

export const inputs = { len: 60, ann: 252 };

export function expected(bars, { len, ann }) {
  const r = simpleReturns(bars.close);
  const out = blank(r.length);
  for (let i = len; i < r.length; i++) {
    const w = r.slice(i - len + 1, i + 1);
    out[i] = div(mean(w), popSd(w)) * Math.sqrt(ann);
  }
  return { Sharpe: out };
}
