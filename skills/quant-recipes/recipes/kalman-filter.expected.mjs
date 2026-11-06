export const inputs = { q: 0.05, r: 4 };

// A one-dimensional Kalman filter of a random-walk state: predict (err + q), gain, correct, shrink the error.
export function expected(bars, { q, r }) {
  let est = bars.close[0], err = 1;
  const out = [];
  for (let i = 0; i < bars.close.length; i++) {
    const pred = err + q;
    const gain = pred / (pred + r);
    est = est + gain * (bars.close[i] - est);
    err = (1 - gain) * pred;
    out.push(est);
  }
  return { Filter: out };
}
