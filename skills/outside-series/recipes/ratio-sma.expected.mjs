import { div, mean, rolling } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }, ctx) {
  const idx = ctx.outside("IDX", "close");
  const ratio = bars.close.map((c, i) => div(c, idx[i]));
  return { Ratio: ratio, Average: rolling(ratio, len, mean) };
}
