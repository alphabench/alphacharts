import { NA, barsPerYear } from "./helpers.mjs";

// Run on 25 bars of 15 minutes a day: intraday, so the finished daily bar is the previous day. Bars per year is not
// known until the first day has finished, so the first day draws nothing. (The daily-chart branch, one bar back, is
// proved in packages/script/test/previous-day.test.ts.)
export function expected(bars, _inputs, ctx) {
  const ppy = barsPerYear(Array.from(bars.time));
  const level = (field) => ctx.outside(null, field, "1d").map((v, i) => (Number.isNaN(ppy[i]) ? NA : v));
  return { "Previous high": level("high"), "Previous low": level("low"), "Previous close": level("close") };
}
