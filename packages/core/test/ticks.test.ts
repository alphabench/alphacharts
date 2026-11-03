import { describe, expect, it } from "vitest";
import { DataModel } from "../src/data/model.js";
import { TimeZone } from "../src/data/tz.js";
import { priceTicks, PriceFormatter, timeTicks, weightBetween, W_DAY, W_MONTH, W_YEAR } from "../src/scale/ticks.js";

describe("weights", () => {
  const ist = new TimeZone("Asia/Kolkata");
  it("ranks calendar boundaries in the chart's zone, not UTC", () => {
    // 2024-12-31 18:29 UTC is 23:59 IST; one minute later is the IST new year.
    const a = Date.UTC(2024, 11, 31, 18, 29), b = a + 60_000;
    expect(weightBetween(ist, a, b)).toBe(W_YEAR);
    expect(weightBetween(new TimeZone("UTC"), a, b)).toBeLessThan(W_DAY);
    expect(weightBetween(ist, Date.UTC(2024, 1, 29, 18, 29), Date.UTC(2024, 1, 29, 18, 30))).toBe(W_MONTH);
  });
});

describe("timeTicks", () => {
  function model(n: number, step: number) {
    const m = new DataModel();
    const s = m.add("value");
    const time = new Float64Array(n), value = new Float64Array(n).fill(1);
    for (let i = 0; i < n; i++) time[i] = Date.UTC(2020, 0, 1) + i * step;
    m.setData(s, { time, value });
    return m;
  }
  const tz = new TimeZone("UTC");

  it("keeps labels at least gapPx apart and prefers heavier boundaries", () => {
    const m = model(3000, 60_000);
    const spacing = 2;
    const ticks = timeTicks(m.timeline, tz, 0, 2999, (i) => i * spacing, spacing, 80);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.x - ticks[i - 1]!.x).toBeGreaterThanOrEqual(80);
    // The day boundary at bar 1440 must win over the hour marks around it.
    expect(ticks.some((t) => t.index === 1440 && t.weight === W_DAY)).toBe(true);
  });

  it("zoomed out over 10M bars costs about the same as 1k (boundary path)", () => {
    const m = model(10_000_000, 60_000);
    const spacing = 1600 / 10_000_000;
    const t0 = performance.now();
    const ticks = timeTicks(m.timeline, tz, 0, 9_999_999, (i) => i * spacing, spacing, 80);
    const ms = performance.now() - t0;
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks.every((t) => t.weight === W_YEAR)).toBe(true);
    expect(ms).toBeLessThan(50);
  });
});

describe("price ticks and format", () => {
  it("never steps below minMove and lands on its multiples", () => {
    const { step, ticks } = priceTicks(100, 100.2, 600, 30, 0.05);
    expect(step).toBe(0.05);
    for (const t of ticks) expect(Math.abs(t / 0.05 - Math.round(t / 0.05))).toBeLessThan(1e-9);
  });
  it("derives decimals from minMove", () => {
    expect(new PriceFormatter(0.05).format(1.5)).toBe("1.50");
    expect(new PriceFormatter(0.25).format(3)).toBe("3.00");
    expect(new PriceFormatter(1).format(3.4)).toBe("3");
    expect(new PriceFormatter(0.0001).format(1.23456)).toBe("1.2346");
  });
});

describe("niceTicks", () => {
  it("returns 1-2-2.5-5 steps across the range, about `count` of them", async () => {
    const { niceTicks } = await import("../src/index.js");
    expect(niceTicks(0, 100, 5)).toEqual({ step: 20, ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceTicks(-1, 1, 4).ticks).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(niceTicks(3, 3, 5).ticks).toEqual([]);
  });
});
