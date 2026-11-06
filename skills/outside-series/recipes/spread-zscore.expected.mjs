import { NA, div, mean, popSd } from "./helpers.mjs";

export const inputs = { len: 30, hedge: 1.5 };

export function expected(bars, { len, hedge }, ctx) {
  const other = ctx.outside("AAA", "close");
  const spread = bars.close.map((c, i) => c - hedge * other[i]);
  const z = spread.map((s, i) => {
    if (i < len - 1) return NA;
    const w = spread.slice(i - len + 1, i + 1);
    return w.some(Number.isNaN) ? NA : div(s - mean(w), popSd(w));
  });
  return { Z: z };
}
