import { NA, div, mean, popVar, rolling } from "./helpers.mjs";

export const inputs = { len: 50 };

export function expected(bars, { len }, ctx) {
  const x = ctx.outside("AAA", "close");
  const y = Array.from(bars.close);
  const mx = rolling(x, len, mean), my = rolling(y, len, mean);
  const mxy = rolling(x.map((v, i) => v * y[i]), len, mean);
  const vx = rolling(x, len, popVar);
  return { Residual: y.map((v, i) => (Number.isNaN(mx[i]) || Number.isNaN(my[i]) ? NA : v - (my[i] + div(mxy[i] - mx[i] * my[i], vx[i]) * (x[i] - mx[i])))) };
}
