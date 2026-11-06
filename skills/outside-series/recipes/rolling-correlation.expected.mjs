import { NA, div, mean, popSd, returns, rolling } from "./helpers.mjs";

export const inputs = { len: 30 };

export function expected(bars, { len }, ctx) {
  const ra = returns(Array.from(bars.close));
  const rb = returns(ctx.outside("AAA", "close"));
  const prod = ra.map((v, i) => v * rb[i]);
  const ma = rolling(ra, len, mean), mb = rolling(rb, len, mean), mp = rolling(prod, len, mean);
  const sa = rolling(ra, len, popSd), sb = rolling(rb, len, popSd);
  return { Correlation: mp.map((p, i) => (Number.isNaN(p) ? NA : div(p - ma[i] * mb[i], sa[i] * sb[i]))) };
}
