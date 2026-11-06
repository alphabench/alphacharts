import { NA, div, mean, popSd, returns, rolling } from "../../outside-series/recipes/helpers.mjs";

export const inputs = { len: 10, ann: 252 };

export function expected(_bars, { len, ann }, ctx) {
  const day = ctx.feed(null, "1d");
  // returns and the window are over daily bars; the result is read on the chart's bars (a finished day)
  const r = returns(Array.from(day.close));
  const m = rolling(r, len, mean), s = rolling(r, len, popSd);
  const sharpe = m.map((v, i) => (Number.isNaN(v) ? NA : div(v, s[i]) * Math.sqrt(ann)));
  return { Sharpe: ctx.join(day, sharpe) };
}
