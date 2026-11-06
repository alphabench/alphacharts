import { blank, mean } from "./helpers.mjs";

export const inputs = { len: 20 };

/** Wilder ATR: the first value at bar len is the mean of the true ranges of bars 1..len, then (prev * (len - 1) + tr) / len. */
export function wilderAtr(bars, len) {
  const n = bars.close.length;
  const tr = blank(n);
  for (let i = 1; i < n; i++) tr[i] = Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - bars.close[i - 1]), Math.abs(bars.low[i] - bars.close[i - 1]));
  const atr = blank(n);
  atr[len] = mean(tr.slice(1, len + 1));
  for (let i = len + 1; i < n; i++) atr[i] = (atr[i - 1] * (len - 1) + tr[i]) / len;
  return atr;
}

export function expected(bars, { len }) {
  const atr = wilderAtr(bars, len);
  const out = blank(atr.length);
  for (let i = len; i < out.length; i++) out[i] = (bars.close[i] - mean(Array.from(bars.close.slice(i - len + 1, i + 1)))) / atr[i];
  return { Distance: out };
}
