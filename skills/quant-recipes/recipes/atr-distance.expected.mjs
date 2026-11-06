import { blank, mean } from "./helpers.mjs";

export const inputs = { len: 20, atrLen: 14 };

/**
 * Wilder's ATR: the true range of bar 0 is high - low; the first value, at bar len - 1, is the mean of the true ranges
 * of bars 0..len-1; then (prev * (len - 1) + tr) / len. Hand case, len 3, H/L/C (110,90,100) (102,98,100) (103,99,101):
 * true ranges 20, 4, 4, so the first value is 28/3.
 */
export function wilderAtr(bars, len) {
  const n = bars.close.length;
  const tr = blank(n);
  tr[0] = bars.high[0] - bars.low[0];
  for (let i = 1; i < n; i++) tr[i] = Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - bars.close[i - 1]), Math.abs(bars.low[i] - bars.close[i - 1]));
  const atr = blank(n);
  atr[len - 1] = mean(tr.slice(0, len));
  for (let i = len; i < n; i++) atr[i] = (atr[i - 1] * (len - 1) + tr[i]) / len;
  return atr;
}
const hand = wilderAtr({ high: [110, 102, 103], low: [90, 98, 99], close: [100, 100, 101] }, 3);
if (Math.abs(hand[2] - 28 / 3) > 1e-12) throw new Error("wilderAtr disagrees with the hand-worked 28/3");

export function expected(bars, { len, atrLen }) {
  const atr = wilderAtr(bars, atrLen);
  const out = blank(atr.length);
  const first = Math.max(len, atrLen) - 1; // the average exists from bar len - 1, the ATR from bar atrLen - 1
  for (let i = first; i < out.length; i++) out[i] = (bars.close[i] - mean(Array.from(bars.close.slice(i - len + 1, i + 1)))) / atr[i];
  return { Distance: out };
}
