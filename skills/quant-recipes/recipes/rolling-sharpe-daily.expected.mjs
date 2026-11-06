import { NA, barsPerYear, div, mean, returns, rolling, sampleSd } from "../../outside-series/recipes/helpers.mjs";

export const inputs = { len: 10 };

export function expected(_bars, { len }, ctx) {
  const day = ctx.feed(null, "1d");
  // returns, the window and the bars per year are over the daily bars; the result is read on the chart's bars (a finished day)
  const r = returns(Array.from(day.close));
  const ppy = barsPerYear(Array.from(day.time));
  const m = rolling(r, len, mean), s = rolling(r, len, sampleSd);
  const sharpe = m.map((v, i) => (Number.isNaN(v) || Number.isNaN(ppy[i]) ? NA : div(v, s[i]) * Math.sqrt(ppy[i])));
  return { Sharpe: ctx.join(day, sharpe) };
}
