import { blank } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }) {
  const n = bars.close.length;
  // bar 0 has no previous high: the comparison is false there, so it counts 0
  const above = Array.from(bars.close, (c, i) => (i > 0 && c > bars.high[i - 1] ? 1 : 0));
  const out = blank(n);
  for (let i = len - 1; i < n; i++) out[i] = (100 * above.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0)) / len;
  return { Percent: out };
}
