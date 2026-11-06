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
/**
 * Sample standard deviation, from the definition: sqrt(sum of squared deviations / (n - 1)). Hand check, the eight values
 * 2 4 4 4 5 5 7 9: mean 5, squared deviations 9 1 1 1 0 0 4 16 = 32, so the sample variance is 32 / 7 and the deviation
 * 2.138089935... (the population deviation of the same values is exactly 2).
 */
export const sampleSd = (w) => {
  const m = mean(w);
  let ss = 0;
  for (const x of w) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (w.length - 1));
};
if (Math.abs(sampleSd([2, 4, 4, 4, 5, 5, 7, 9]) - Math.sqrt(32 / 7)) > 1e-15 || popSd([2, 4, 4, 4, 5, 5, 7, 9]) !== 2) throw new Error("helpers: sampleSd / popSd disagree with the hand-worked values");

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

/**
 * Bars per year at each bar of a series with the given bar times (ms), written from the stated rule, not from the
 * engine. Bars on the same exchange-clock day (the day cut `offsetMin` minutes east of UTC) are one session. At a bar:
 * the sessions that finished before its day (the last 60); if the median number of bars per session is 2 or more, that
 * median times 252. Otherwise (a day or longer between bars) over the last 120 bars up to this one: median spacing
 * `s`; if `s` is from 1 to 1.5 days and some two adjacent weekdays (UTC) hold at most max(5% of the bars, 1 when there are
 * 7 or more) of them, weekends are out and the answer is 252 days / s, else 365 days / s. na before a session has
 * finished, and for a day or longer before six bars.
 */
export function barsPerYear(time, offsetMin = 0) {
  const DAY = 86400000;
  const dayOf = (t) => Math.floor((t + offsetMin * 60000) / DAY);
  const med = (a) => {
    const v = [...a].sort((x, y) => x - y);
    const h = v.length >> 1;
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  };
  return time.map((t, i) => {
    const today = dayOf(t);
    const perDay = new Map();
    for (let j = 0; j < i; j++) if (dayOf(time[j]) < today) perDay.set(dayOf(time[j]), (perDay.get(dayOf(time[j])) ?? 0) + 1);
    if (perDay.size === 0) return NA;
    const recent = [...perDay.entries()].sort((a, b) => a[0] - b[0]).slice(-60).map((e) => e[1]);
    const m = med(recent);
    if (m >= 2) return m * 252;
    const from = Math.max(0, i - 119), win = time.slice(from, i + 1);
    if (win.length < 6) return NA;
    const gaps = [];
    for (let k = 1; k < win.length; k++) if (win[k] > win[k - 1]) gaps.push(win[k] - win[k - 1]);
    const sp = med(gaps);
    const wk = [0, 0, 0, 0, 0, 0, 0];
    for (const x of win) wk[(((Math.floor(x / DAY) % 7) + 7) % 7)]++;
    const quiet = Math.min(...wk.map((c, d) => c + wk[(d + 1) % 7]));
    const noWeekends = sp >= DAY && sp < 1.5 * DAY && quiet <= Math.max(0.05 * win.length, win.length >= 7 ? 1 : 0);
    return noWeekends ? (252 * DAY) / sp : (365 * DAY) / sp;
  });
}
