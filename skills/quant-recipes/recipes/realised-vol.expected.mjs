import { blank, logReturns, popSd } from "./helpers.mjs";

export const inputs = { len: 20, ann: 252 };

export function expected(bars, { len, ann }) {
  const r = logReturns(bars.close);
  const hv = blank(r.length);
  for (let i = len; i < r.length; i++) hv[i] = popSd(r.slice(i - len + 1, i + 1)) * Math.sqrt(ann) * 100;
  return { HV: hv };
}
