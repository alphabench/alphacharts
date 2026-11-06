import { NA, barsPerYear, blank } from "./helpers.mjs";

// The gap of a session is its first bar's open against the previous day's OFFICIAL close, in percent, held for the whole
// session. On an intraday chart the official close is the finished daily bar's close (the exchange's own close, which can differ
// from the last traded price of the session: the chart's last bar); on a chart of daily bars it is the previous bar's close.
// The checker's bars are intraday (25 bars of 15 minutes a day), so the daily series is the one read here; the daily-chart branch
// is proved in packages/script/test/previous-day.test.ts. The session is the calendar day on the exchange's clock (`off`).
// The first day loaded draws nothing, because bars per year is not known until a day has finished.
export const inputs = { off: 0, minGap: 0.001 };

export function expected(bars, { off, minGap }, ctx) {
  const n = bars.close.length;
  const day = (i) => Math.floor((bars.time[i] + off * 60000) / 86400000);
  const ppy = barsPerYear(Array.from(bars.time));
  const official = ctx.outside(null, "close", "1d");
  const gap = blank(n), flag = blank(n);
  let prevClose = NA, todayOpen = NA;
  for (let i = 0; i < n; i++) {
    if (i > 0 && day(i) !== day(i - 1)) { prevClose = Number.isNaN(ppy[i]) ? NA : official[i]; todayOpen = bars.open[i]; }
    gap[i] = 100 * (todayOpen / prevClose - 1);
    flag[i] = Math.abs(gap[i]) > minGap ? 1 : NA;
  }
  return { "Gap, percent": gap, "Background 2": flag };
}
