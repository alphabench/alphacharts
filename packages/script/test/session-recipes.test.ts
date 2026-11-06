// The session recipes of the skills (charts/skills) on the charts the checker's seeded bars do not cover: previous-day levels and
// the gap on a chart of daily bars (where the daily series is the chart's own bar), the opening range on bars longer than the range.

/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { StudyEngine, type BarColumns } from "@alphacharts/indicators";
import { alignFor, feedsOf } from "../src/index.js";
import { ok } from "./support.js";

const DAY = 86_400_000, MIN = 60_000, MON = Date.UTC(2026, 0, 5);
const files = import.meta.glob<string>("../../../skills/*/recipes/*.acs", { query: "?raw", import: "default", eager: true });
const recipe = (rel: string): string => {
  const src = files[`../../../skills/${rel}`];
  if (src === undefined) throw new Error(`no recipe ${rel}`);
  return src;
};
const dow = (t: number) => new Date(t).getUTCDay();

function weekdays(n: number, perDay: number, stepMin: number, openMin: number): number[] {
  const t: number[] = [];
  for (let d = 0, k = 0; k < n; d++) {
    const day = MON + d * DAY;
    if (dow(day) === 0 || dow(day) === 6) continue;
    k++;
    for (let i = 0; i < perDay; i++) t.push(day + (openMin + i * stepMin) * MIN);
  }
  return t;
}
function bars(time: number[], close: (i: number) => number): Required<BarColumns> {
  const c = Float64Array.from(time, (_, i) => close(i));
  return { time: Float64Array.from(time), open: Float64Array.from(c, (x) => x - 0.5), high: Float64Array.from(c, (x) => x + 1), low: Float64Array.from(c, (x) => x - 1), close: c, volume: new Float64Array(time.length).fill(10) };
}
function run(src: string, chart: Required<BarColumns>, daily: Required<BarColumns> | null, inputs: Record<string, number> = {}): Float64Array[] {
  const r = ok(src);
  const e = new StudyEngine(r.study, inputs);
  const interval = chart.time[1]! - chart.time[0]!;
  for (const f of feedsOf(r.plan.dependencies)) e.setFeed(f.key, daily!, alignFor(f.timeframe, interval));
  e.load(chart);
  return r.study.plots.filter((p) => "col" in p).map((p) => e.column(r.study.columns.indexOf((p as { col: string }).col)).slice());
}

describe("previous day's high, low and close", () => {
  const src = recipe("outside-series/recipes/previous-day-levels.acs");
  it("on a daily chart it is the day before: Mon 110, Tue 120 draws 110 on Tuesday, not 120", () => {
    const d = bars(weekdays(14, 1, 0, 0), (i) => 100 + i * 3);
    const [hi, lo, cl] = run(src, d, d) as [Float64Array, Float64Array, Float64Array];
    expect(Array.from(hi.subarray(0, 5)).every((v) => v !== v)).toBe(true); // bars per year is not known for the first five bars
    for (let i = 5; i < d.time.length; i++) {
      expect(hi[i], `high ${i}`).toBe(d.high[i - 1]);
      expect(lo[i], `low ${i}`).toBe(d.low[i - 1]);
      expect(cl[i], `close ${i}`).toBe(d.close[i - 1]);
    }
  });
  it("on an intraday chart it is the finished day before (the daily series itself)", () => {
    const t = weekdays(6, 25, 15, 225);
    const chart = bars(t, (i) => 1000 + (i % 13));
    // a daily bar for every calendar day from three days before the chart to ten days after its start (UTC midnights)
    const daily = bars(Array.from({ length: 14 }, (_, i) => MON - 3 * DAY + i * DAY), (i) => 50 + i * 10);
    const [hi] = run(src, chart, daily) as [Float64Array];
    // the first session draws nothing (bars per year unknown); the second sees the day that finished before it started
    expect(Array.from(hi.subarray(0, 25)).every((v) => v !== v)).toBe(true);
    for (let i = 25; i < t.length; i++) {
      const day = Math.floor(t[i]! / DAY) * DAY;
      const j = Array.from(daily.time).findIndex((x) => x === day - DAY); // the daily bar of the day before the session's day
      expect(hi[i], `bar ${i}`).toBe(daily.high[j]);
    }
  });
});

describe("gap from the previous close", () => {
  const src = recipe("quant-recipes/recipes/gap.acs");
  it("on a daily chart it is open against the previous bar's close", () => {
    const d = bars(weekdays(14, 1, 0, 0), (i) => 100 + i * 3);
    const [gap] = run(src, d, d) as [Float64Array];
    for (let i = 5; i < d.time.length; i++) expect(gap![i]).toBeCloseTo(100 * (d.open[i]! / d.close[i - 1]! - 1), 12);
  });
});

describe("opening range", () => {
  const src = recipe("quant-recipes/recipes/opening-range.acs");
  it("a 30-minute range on hourly bars draws nothing: an hourly bar holds prices from outside the range", () => {
    const h = bars(weekdays(8, 7, 60, 225), (i) => 100 + (i % 9));
    const [hi, lo] = run(src, h, null) as [Float64Array, Float64Array];
    expect(Array.from(hi).every((v) => v !== v)).toBe(true);
    expect(Array.from(lo).every((v) => v !== v)).toBe(true);
  });
  it("on 5-minute bars it is the first six bars (09:15 to 09:45 IST)", () => {
    const t = weekdays(4, 75, 5, 225);
    const m = bars(t, (i) => 100 + ((i * 7) % 11));
    const [hi, lo] = run(src, m, null) as [Float64Array, Float64Array];
    for (const day of [1, 2, 3]) {
      const a = day * 75;
      const range = [0, 1, 2, 3, 4, 5].map((k) => a + k);
      expect(hi[a + 40]).toBe(Math.max(...range.map((i) => m.high[i]!)));
      expect(lo[a + 40]).toBe(Math.min(...range.map((i) => m.low[i]!)));
    }
  });
  it("on 20-minute bars the range ends at the last whole bar inside it (one bar), not at the bar that reaches past it", () => {
    const m = bars(weekdays(3, 20, 20, 225), (i) => 100 + ((i * 7) % 11));
    const [hi] = run(src, m, null) as [Float64Array];
    expect(hi[20 + 5]).toBe(m.high[20]);
  });
});
