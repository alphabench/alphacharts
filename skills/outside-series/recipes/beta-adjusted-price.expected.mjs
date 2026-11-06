import { NA, div, mean, popVar, returns, rolling } from "./helpers.mjs";

export const inputs = { len: 60 };

export function expected(bars, { len }, ctx) {
  const close = Array.from(bars.close);
  const idx = ctx.outside("IDX", "close");
  const ra = returns(close);
  const rb = returns(idx);
  const prod = ra.map((v, i) => v * rb[i]);
  const ma = rolling(ra, len, mean), mb = rolling(rb, len, mean);
  const num = rolling(prod, len, mean).map((m, i) => m - ma[i] * mb[i]);
  const den = rolling(rb, len, popVar);
  const beta = num.map((n, i) => (Number.isNaN(n) ? NA : div(n, den[i])));
  return { "Beta-adjusted price": close.map((c, i) => c - beta[i] * idx[i]) };
}
