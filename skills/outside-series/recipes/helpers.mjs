// Plain-JS building blocks for the outside-series fixtures. Naive loops over arrays, sharing no code with the engine.
// The fixtures receive `ctx` from the checker: `ctx.outside(symbol, field, timeframe)` is an outside series read on the
// chart's bars, `ctx.feed(symbol, timeframe)` its own bars and `ctx.join(feed, values)` values computed on those bars,
// read on the chart's bars. All three follow the join rules stated in the skill, written as plain loops in the checker.

export const NA = Number.NaN;
export const blank = (n) => new Array(n).fill(NA);

export const mean = (w) => w.reduce((a, b) => a + b, 0) / w.length;
/** Population variance (divisor n), the one ta.variance uses. */
export const popVar = (w) => {
  const m = mean(w);
  return mean(w.map((x) => (x - m) ** 2));
};
export const popSd = (w) => Math.sqrt(popVar(w));

/** Apply f to every full window of `len` values ending at bar i; na until the window holds no na. */
export function rolling(values, len, f) {
  return values.map((_, i) => {
    if (i < len - 1) return NA;
    const w = values.slice(i - len + 1, i + 1);
    return w.some(Number.isNaN) ? NA : f(w);
  });
}

/** x / y, na when y is 0 or either is na (the language's rule). */
export const div = (x, y) => (Number.isNaN(x) || Number.isNaN(y) || y === 0 ? NA : x / y);
/** Simple return v[i] / v[i-1] - 1, na at 0. */
export const returns = (v) => v.map((x, i) => (i === 0 ? NA : div(x, v[i - 1]) - 1));
/** Covariance of two equal windows, population. */
export const popCov = (a, b) => mean(a.map((x, i) => x * b[i])) - mean(a) * mean(b);
