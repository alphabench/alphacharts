import { blank, div, mean, popSd, simpleReturns } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }) {
  const r = simpleReturns(bars.close);
  const z = blank(r.length);
  for (let i = len; i < r.length; i++) {
    const w = r.slice(i - len + 1, i + 1); // len returns, none of them na from bar `len` on
    z[i] = div(r[i] - mean(w), popSd(w));
  }
  return { Z: z };
}
