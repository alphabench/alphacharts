import { NA, div, sampleSd, rolling } from "../../outside-series/recipes/helpers.mjs";

export const inputs = { fast: 10, slow: 30 };

export function expected(_bars, { fast, slow }, ctx) {
  const day = ctx.feed(null, "1d");
  // log returns and both windows are over daily bars; the result is read on the chart's bars (a finished day)
  const r = Array.from(day.close).map((x, i, v) => (i === 0 ? NA : Math.log(x / v[i - 1])));
  const f = rolling(r, fast, sampleSd), l = rolling(r, slow, sampleSd);
  const ratio = f.map((v, i) => (Number.isNaN(v) ? NA : div(v, l[i])));
  return { Ratio: ctx.join(day, ratio) };
}
