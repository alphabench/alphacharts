import { describe, expect, it } from "vitest";
import { TimeZone } from "@alphacharts/core";
import { BandScale, LinearScale, LogScale, niceDomain, TimeScale, timeTickValues } from "../src/scale.js";

describe("linear", () => {
  it("maps and inverts, reversed ranges included", () => {
    const s = new LinearScale([0, 10], [100, 0]);
    expect(s.map(0)).toBe(100);
    expect(s.map(10)).toBe(0);
    expect(s.map(2.5)).toBe(75);
    expect(s.invert(75)).toBe(2.5);
  });
  it("makes 1-2-2.5-5 ticks inside the domain", () => {
    expect(new LinearScale([0, 100], [0, 1]).ticks(5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(new LinearScale([-1, 1], [0, 1]).ticks(4)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
  it("niceDomain rounds out to tick values and opens a flat domain", () => {
    expect(niceDomain(0.3, 9.1, 5)).toEqual([0, 10]);
    expect(niceDomain(-3.2, 7, 5)).toEqual([-5, 7.5]);
    const [lo, hi] = niceDomain(5, 5, 5);
    expect(lo).toBeLessThan(5);
    expect(hi).toBeGreaterThan(5);
    expect(() => niceDomain(2, 1, 5)).toThrow(/ordered/);
  });
});

describe("log", () => {
  it("maps decades evenly and ticks at powers (and 1-2-5 when there is room)", () => {
    const s = new LogScale([1, 1000], [0, 300]);
    expect(s.map(10)).toBeCloseTo(100);
    expect(s.invert(200)).toBeCloseTo(100);
    expect(s.ticks(3)).toEqual([1, 10, 100, 1000]);
    expect(new LogScale([1, 100], [0, 1]).ticks(8)).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });
  it("refuses a non-positive domain", () => {
    expect(() => new LogScale([0, 10])).toThrow(/positive/);
  });
});

describe("band and point", () => {
  it("lays bands out with inner and outer padding", () => {
    const s = new BandScale(["a", "b", "c"], [0, 300], { paddingInner: 0.2, paddingOuter: 0.1 });
    // 3 - 0.2 + 2 * 0.1 = 3 steps
    expect(s.step).toBeCloseTo(100);
    expect(s.bandwidth).toBeCloseTo(80);
    expect(s.map("a")).toBeCloseTo(10);
    expect(s.map("c")).toBeCloseTo(210);
    expect(s.center("b")).toBeCloseTo(150);
    expect(s.map("zzz")).toBeNaN();
    expect(s.invert(155)).toBe("b");
  });
  it("reverses the order", () => {
    const s = new BandScale(["a", "b"], [0, 100], { paddingInner: 0, paddingOuter: 0 }, "band", true);
    expect(s.map("a")).toBe(50);
    expect(s.map("b")).toBe(0);
  });
  it("a point scale has no width and centres on the step", () => {
    const s = new BandScale(["a", "b"], [0, 100], {}, "point");
    expect(s.bandwidth).toBe(0);
    expect(s.map("a")).toBeCloseTo(25);
    expect(s.map("b")).toBeCloseTo(75);
  });
  it("places a number between numeric categories (spot between strikes)", () => {
    const s = new BandScale(["24000", "24100", "24200"], [0, 300], { paddingInner: 0, paddingOuter: 0 });
    expect(s.centerOfNumber(24100)).toBeCloseTo(150);
    expect(s.centerOfNumber(24150)).toBeCloseTo(200);
    expect(s.centerOfNumber(23000)).toBeCloseTo(50);
    expect(s.centerOfNumber(99999)).toBeCloseTo(250);
    expect(new BandScale(["x", "y"], [0, 1]).centerOfNumber(1)).toBeNaN();
  });
});

describe("time ticks", () => {
  const utc = new TimeZone("UTC");
  const ist = new TimeZone("Asia/Kolkata");
  const d = (y: number, m: number, day = 1, h = 0, mi = 0) => Date.UTC(y, m - 1, day, h, mi);

  it("uses month boundaries over a year", () => {
    const t = timeTickValues(d(2024, 1, 1), d(2024, 12, 31), 12, utc);
    expect(t.length).toBeGreaterThanOrEqual(6);
    for (const v of t) {
      const c = utc.civil(v);
      expect(c.day).toBe(1);
      expect(c.hour).toBe(0);
    }
    expect(t[0]).toBe(d(2024, 1, 1));
  });
  it("aligns to the zone's wall clock, not UTC", () => {
    const t = timeTickValues(d(2024, 3, 10, 0), d(2024, 3, 20, 0), 10, ist);
    for (const v of t) expect(ist.civil(v).hour).toBe(0);
  });
  it("uses clock steps inside a day", () => {
    const t = timeTickValues(d(2024, 3, 11, 9, 15), d(2024, 3, 11, 15, 30), 6, ist);
    for (const v of t) expect(v % (60_000)).toBe(0);
    expect(t.length).toBeGreaterThan(2);
    expect(t.length).toBeLessThanOrEqual(8);
  });
  it("makes quarters and years for long spans", () => {
    const t = timeTickValues(d(2010, 1, 1), d(2024, 1, 1), 8, utc);
    for (const v of t) expect(utc.civil(v).month).toBe(1);
    expect(new TimeScale([d(2024, 1, 1), d(2024, 1, 2)], [0, 100], utc).map(d(2024, 1, 1, 12))).toBeCloseTo(50);
  });
  it("returns nothing for an empty span", () => {
    expect(timeTickValues(5, 5, 5, utc)).toEqual([]);
  });
});
