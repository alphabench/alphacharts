import { NA, blank } from "./helpers.mjs";

// The gap of a session is its first bar's open against the close of the bar before it (the previous session's last bar), in
// percent, held for the whole session. The session is the calendar day on the exchange's clock (`off`), found by the change of
// the day number, so it works on any bar size and on a daily chart. An offset of -120 minutes puts the day boundary at 02:00
// UTC, bar 120 of the 300 seeded 1-minute bars; the first day loaded has no previous close and draws nothing.
export const inputs = { off: -120, minGap: 0.001 };

export function expected(bars, { off, minGap }) {
  const n = bars.close.length;
  const day = (i) => Math.floor((bars.time[i] + off * 60000) / 86400000);
  const gap = blank(n), flag = blank(n);
  let prevClose = NA, todayOpen = NA;
  for (let i = 0; i < n; i++) {
    if (i > 0 && day(i) !== day(i - 1)) { prevClose = bars.close[i - 1]; todayOpen = bars.open[i]; }
    gap[i] = 100 * (todayOpen / prevClose - 1);
    flag[i] = Math.abs(gap[i]) > minGap ? 1 : NA;
  }
  // the opening bar of the first session after the boundary sees the gap from bar 120 on; before it both are na
  return { "Gap, percent": gap, "Background 2": flag };
}
