import { NA } from "../../quant-recipes/recipes/helpers.mjs";

export const inputs = { len: 14, hi: 70, lo: 30 };

/** Wilder's RSI on plain arrays: seeded with the simple mean of the first `len` changes. */
function rsi(close, len) {
  const out = new Array(close.length).fill(NA);
  let gain = 0, loss = 0;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= len) {
      gain += g;
      loss += l;
      if (i < len) continue;
      gain /= len;
      loss /= len;
    } else {
      gain = (gain * (len - 1) + g) / len;
      loss = (loss * (len - 1) + l) / len;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function expected(bars, { len, hi, lo }) {
  const r = rsi(Array.from(bars.close), len);
  return {
    RSI: r,
    "RSI above level": r.map((x) => (Number.isNaN(x) ? NA : Math.max(x, hi))),
    "RSI below level": r.map((x) => (Number.isNaN(x) ? NA : Math.min(x, lo))),
  };
}
