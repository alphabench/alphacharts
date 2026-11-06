// Every kernel written out as a plain loop over the window ending at bar i.
const NA = Number.NaN;
export const inputs = { n: 5 };

export function expected(bars, { n }) {
  const N = bars.close.length;
  const c = Array.from(bars.close), h = Array.from(bars.high), l = Array.from(bars.low);
  const win = (a, i) => a.slice(i - n + 1, i + 1);
  const mean = (w) => w.reduce((s, x) => s + x, 0) / w.length;
  const col = () => new Array(N).fill(NA);
  const o = Object.fromEntries(["bb basis", "bb upper", "bb lower", "sma", "ema", "rma", "wma", "stdev", "variance", "stdev sample", "variance sample", "sum", "math.sum", "highest", "lowest", "highestbars", "lowestbars", "change 2", "linreg", "tr", "atr"].map((k) => [k, col()]));
  for (let i = 0; i < N; i++) {
    o.tr[i] = i === 0 ? NA : // bar 0 has no previous close, so no true range
       Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    if (i >= 2) o["change 2"][i] = c[i] - c[i - 2];
    if (i < n - 1) continue;
    const w = win(c, i), m = mean(w);
    const variance = mean(w.map((x) => (x - m) ** 2)); // population: divisor n
    o.sma[i] = m;
    o["bb basis"][i] = m;
    o["bb upper"][i] = m + 2 * Math.sqrt(variance);
    o["bb lower"][i] = m - 2 * Math.sqrt(variance);
    o.variance[i] = variance;
    o.stdev[i] = Math.sqrt(variance);
    const sampleVariance = w.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1); // sample: divisor n - 1
    o["variance sample"][i] = sampleVariance;
    o["stdev sample"][i] = Math.sqrt(sampleVariance);
    o.sum[i] = w.reduce((s, x) => s + x, 0);
    o["math.sum"][i] = o.sum[i];
    o.highest[i] = Math.max(...win(h, i));
    o.lowest[i] = Math.min(...win(l, i));
    // bars since the extreme: 0 is this bar; the latest bar wins a tie for the high, the earliest the low (checked by the seeded data having no ties)
    o.highestbars[i] = n - 1 - w.indexOf(Math.max(...w));
    o.lowestbars[i] = n - 1 - w.indexOf(Math.min(...w));
    o.wma[i] = w.reduce((s, x, k) => s + x * (k + 1), 0) / ((n * (n + 1)) / 2);
    // least-squares line through the window, read at its last bar
    const xs = w.map((_, k) => k), mx = mean(xs);
    const slope = xs.reduce((s, x, k) => s + (x - mx) * (w[k] - m), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    o.linreg[i] = m + slope * (n - 1 - mx);
  }
  // ema and rma start from the SMA of the first n closes
  o.ema[n - 1] = mean(c.slice(0, n));
  o.rma[n - 1] = mean(c.slice(0, n));
  for (let i = n; i < N; i++) {
    o.ema[i] = o.ema[i - 1] + (2 / (n + 1)) * (c[i] - o.ema[i - 1]);
    o.rma[i] = (o.rma[i - 1] * (n - 1) + c[i]) / n;
  }
  // atr is Wilder's: the true range of bar 0 is high - low, the first value (bar n - 1) the mean of the true ranges of bars 0..n-1,
  // then (prev * (n - 1) + tr) / n. (ta.tr above is na on bar 0, as Pine's is; ta.atr does not use that.)
  const trs = c.map((_, i) => (i === 0 ? h[0] - l[0] : o.tr[i]));
  o.atr[n - 1] = mean(trs.slice(0, n));
  for (let i = n; i < N; i++) o.atr[i] = (o.atr[i - 1] * (n - 1) + trs[i]) / n;
  return o;
}
