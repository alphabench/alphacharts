// bars_per_year: the chart's bars in a year, read from its own bars made causal.
// Intraday: the median bars per UTC day over the last 60 finished days times 252. A day or longer: 252 if weekends are left
// out, else 365 days over the median spacing. Constant within a day, nothing from after the bar, na before the first finished
// day (six bars for a day or longer).

import { describe, expect, it } from "vitest";
import { StudyEngine, runStudy, type BarColumns } from "@alphacharts/indicators";
import { ok, bar } from "./support.js";

const DAY = 86_400_000, MIN = 60_000;
const MON = Date.UTC(2026, 0, 5);
const dow = (t: number) => new Date(t).getUTCDay();

/** `days` weekday sessions of `perDay` bars of `stepMin` minutes opening `openMin` minutes after UTC midnight. */
function sessions(days: number, perDay: number, stepMin: number, openMin: number): number[] {
  const t: number[] = [];
  for (let d = 0, k = 0; k < days; d++) {
    const day = MON + d * DAY;
    if (dow(day) === 0 || dow(day) === 6) continue;
    k++;
    for (let i = 0; i < perDay; i++) t.push(day + (openMin + i * stepMin) * MIN);
  }
  return t;
}
const bars = (time: number[]): Required<BarColumns> => {
  const c = Float64Array.from(time, (_, i) => 100 + (i % 7));
  return { time: Float64Array.from(time), open: c, high: c, low: c, close: c, volume: new Float64Array(time.length).fill(1) };
};
const bpy = (time: number[], src = "plot(bars_per_year)") => runStudy(ok(src).study, {}, bars(time))[0]!;
const distinct = (a: Float64Array) => [...new Set(Array.from(a).filter((v) => v === v))];

describe("bars_per_year", () => {
  it("NSE 5-minute bars (75 a session): 18,900, from the second session", () => {
    const o = bpy(sessions(10, 75, 5, 225));
    expect(distinct(o)).toEqual([18_900]);
    expect(o.findIndex((v) => v === v)).toBe(75);
    expect(Array.from(o.subarray(0, 75)).every((v) => v !== v)).toBe(true);
  });
  it("MCX 5-minute bars (179 a session, 09:00 to 23:55 IST): 45,108", () => {
    expect(distinct(bpy(sessions(10, 179, 5, 210)))).toEqual([45_108]);
  });
  it("an auction session with 72 bars: 72 x 252 = 18,144, the bars the data shows, not an assumed session", () => {
    expect(distinct(bpy(sessions(10, 72, 5, 225)))).toEqual([18_144]);
  });
  it("daily bars without weekend bars: 252, from the sixth bar", () => {
    const o = bpy(sessions(40, 1, 0, 225));
    expect(distinct(o)).toEqual([252]);
    expect(o.findIndex((v) => v === v)).toBe(5);
  });
  it("daily bars of a seven-day market: 365; weekly bars: 52.14", () => {
    const sevenDay = Array.from({ length: 40 }, (_, i) => MON + i * DAY);
    expect(distinct(bpy(sevenDay))).toEqual([365]);
    const weekly = Array.from({ length: 40 }, (_, i) => MON + i * 7 * DAY);
    expect(distinct(bpy(weekly))[0]).toBeCloseTo(365 / 7, 12);
  });
  it("one special session does not turn a weekday market into a calendar one (a Saturday among 60 weekdays)", () => {
    const t = sessions(60, 1, 0, 225);
    t.push(Date.UTC(2026, 2, 28) + 225 * MIN); // a Saturday in March, later than the weekdays loaded so far
    t.sort((a, b) => a - b);
    const o = bpy(t);
    expect(o[o.length - 1]).toBe(252);
  });
  it("a short session in the middle does not move the median", () => {
    const t = [...sessions(5, 75, 5, 225), ...sessions(1, 12, 5, 225).map((x) => x + 7 * DAY), ...sessions(5, 75, 5, 225).map((x) => x + 14 * DAY)];
    expect(distinct(bpy(t))).toEqual([18_900]);
  });
  it("is constant within a session, and a finished bar never changes when later bars arrive (no lookahead)", () => {
    const t = sessions(12, 75, 5, 225);
    const full = bpy(t);
    for (const cut of [76, 150, 301, 600]) {
      const part = bpy(t.slice(0, cut));
      for (let i = 0; i < cut; i++) expect(Object.is(part[i], full[i]), `bar ${i} of ${cut}`).toBe(true);
    }
    for (let d = 1; d < 12; d++) expect(new Set(Array.from(full.subarray(d * 75, d * 75 + 75))).size).toBe(1);
  });
  it("incremental == batch, with the last bar revised first (a tick) and a new day opening", () => {
    const t = sessions(6, 75, 5, 225), d = bars(t);
    const batch = runStudy(ok("plot(bars_per_year)").study, {}, d)[0]!;
    const e = new StudyEngine(ok("plot(bars_per_year)").study);
    e.load({ time: d.time.subarray(0, 100), open: d.open.subarray(0, 100), high: d.high.subarray(0, 100), low: d.low.subarray(0, 100), close: d.close.subarray(0, 100), volume: d.volume.subarray(0, 100) });
    for (let i = 100; i < t.length; i++) {
      e.push({ ...bar(d, i), close: 1 }); // a first tick
      e.reviseLast(bar(d, i));
    }
    const live = e.column(0);
    for (let i = 0; i < t.length; i++) expect(Object.is(live[i], batch[i]), `bar ${i}`).toBe(true);
  });
  it("the value is the same on every chart that has the same sessions, whatever the price", () => {
    const t = sessions(5, 75, 5, 225);
    const a = bpy(t, "plot(bars_per_year)"), b = bpy(t, "plot(bars_per_year * 1)");
    expect(Array.from(a).map((v) => (v === v ? v : -1))).toEqual(Array.from(b).map((v) => (v === v ? v : -1)));
  });
  it("annualises: the Sharpe on a 5-minute chart and on the same returns' daily chart read 252 x the per-bar ratio's root, not one typed number", () => {
    const five = bpy(sessions(10, 75, 5, 225), "plot(math.sqrt(bars_per_year))");
    expect(five[five.length - 1]).toBeCloseTo(Math.sqrt(18_900), 12);
    const daily = bpy(sessions(40, 1, 0, 225), "plot(math.sqrt(bars_per_year))");
    expect(daily[daily.length - 1]).toBeCloseTo(Math.sqrt(252), 12);
    expect(five[five.length - 1]! / daily[daily.length - 1]!).toBeCloseTo(Math.sqrt(75), 12); // the 8.66x a typed 18,900 gets wrong on a daily chart
  });
  it("ta.bars_per_year(source, utcOffsetMinutes): the same 18,900 on the exchange's clock (+330), and a day cut at 07:00 UTC splits each NSE session in two", () => {
    const t = sessions(10, 75, 5, 225);
    expect(distinct(bpy(t, "plot(ta.bars_per_year(close, 330))"))).toEqual([18_900]);
    // offset -420: the day starts at 07:00 UTC, so a session is 03:45-06:55 (38 bars) and 07:00-09:55 (36 bars) in two days
    expect(distinct(bpy(t, "plot(ta.bars_per_year(close, -420))")).length).toBeGreaterThan(1); // not one steady 18,900
  });
  it("is part of the plan: a built-in series that needs only the bars", () => {
    expect(ok("plot(bars_per_year)").plan.needs).not.toBe("ohlcv");
  });
});
