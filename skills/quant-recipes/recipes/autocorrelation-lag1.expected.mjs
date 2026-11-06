import { blank, mean, simpleReturns } from "./helpers.mjs";

export const inputs = { len: 30 };

export function expected(bars, { len }) {
  const r = simpleReturns(bars.close);
  const ac = blank(r.length);
  for (let i = 1 + len; i < r.length; i++) {
    const x = [], y = [];
    for (let j = i - len + 1; j <= i; j++) { x.push(r[j - 1]); y.push(r[j]); }
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < len; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
    ac[i] = sxy / Math.sqrt(sxx * syy);
  }
  return { Autocorrelation: ac };
}
