import { blank, mean, simpleReturns } from "./helpers.mjs";

// A lag other than the default proves the input is read, not just the formula.
export const inputs = { len: 30, lag: 3 };

export function expected(bars, { len, lag }) {
  const r = simpleReturns(bars.close);
  const beta = blank(r.length), corr = blank(r.length);
  // pairs (r[j], r[j - lag]); both are real from bar lag + 1 on, so a full window of len pairs ends at lag + len or later
  for (let i = lag + len; i < r.length; i++) {
    const x = [], y = [];
    for (let j = i - len + 1; j <= i; j++) { x.push(r[j - lag]); y.push(r[j]); }
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < len; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
    beta[i] = sxy / sxx; // slope of the return on its own lag
    corr[i] = sxy / Math.sqrt(sxx * syy);
  }
  return { Beta: beta, Correlation: corr };
}
