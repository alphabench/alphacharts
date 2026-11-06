// Plain-JS building blocks for the recipe fixtures. Deliberately naive loops over arrays, sharing no code with the engine.

export const NA = Number.NaN;
export const blank = (n) => new Array(n).fill(NA);

/** Simple return close[i] / close[i-1] - 1, na at bar 0. */
export const simpleReturns = (close) => Array.from(close, (c, i) => (i === 0 ? NA : c / close[i - 1] - 1));
/** Log return, na at bar 0. */
export const logReturns = (close) => Array.from(close, (c, i) => (i === 0 ? NA : Math.log(c / close[i - 1])));

export const mean = (w) => w.reduce((a, b) => a + b, 0) / w.length;
/** Sample standard deviation (divisor n - 1), written from the definition, with its hand-worked check, and bars per year from the stated rule. */
export { sampleSd, barsPerYear } from "../../outside-series/recipes/helpers.mjs";
/** Population standard deviation (divisor n), the one ta.stdev uses. */
export const popSd = (w) => {
  const m = mean(w);
  return Math.sqrt(mean(w.map((x) => (x - m) ** 2)));
};

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
