import { NA, div, mean, popVar, returns, rolling } from "./helpers.mjs";

export const inputs = { len: 30 };

export function expected(bars, { len }, ctx) {
  const ra = returns(Array.from(bars.close));
  const rb = returns(ctx.outside("IDX", "close"));
  const prod = ra.map((v, i) => v * rb[i]);
  const ma = rolling(ra, len, mean), mb = rolling(rb, len, mean);
  const num = rolling(prod, len, mean).map((m, i) => m - ma[i] * mb[i]);
  const den = rolling(rb, len, popVar);
  return { Beta: num.map((n, i) => (Number.isNaN(n) ? NA : div(n, den[i]))) };
}
