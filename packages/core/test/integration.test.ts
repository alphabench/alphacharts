// Unit tests for the host-integration additions: markers, price line options,
// the crosshair time format and price scale options. The chart itself needs a
// DOM; bench/tests/integration.spec.ts covers it in browsers.
import { describe, expect, it } from "vitest";
import { checkMarkers, markerLowerBound, markerSize, placeMarkers, type SeriesMarker } from "../src/chart/markers.js";
import { dashPattern, PriceLine } from "../src/chart/primitives.js";
import { TimeFormatter } from "../src/scale/ticks.js";
import { TimeZone } from "../src/data/tz.js";
import { checkPriceScaleOptions, DEFAULT_PRICE_SCALE, PriceScale } from "../src/scale/price-scale.js";

const m = (time: number, extra: Partial<SeriesMarker> = {}): SeriesMarker => ({ time, position: "aboveBar", shape: "circle", color: "#ff0000", ...extra });
const bars = new Set([1000, 2000, 3000]);
const has = (t: number) => bars.has(t);

describe("checkMarkers", () => {
  it("sorts by time, stable within a bar, and copies", () => {
    const a = m(2000, { id: "a" }), b = m(1000, { id: "b" }), c = m(2000, { id: "c" });
    const out = checkMarkers([a, b, c], has);
    expect(out.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(out[1]).not.toBe(a);
  });
  it("names the marker whose time is not a bar", () => {
    expect(() => checkMarkers([m(1000), m(1500, { id: "stray" })], has)).toThrow(/marker "stray" \(time 1500\) is not on a bar/);
    expect(() => checkMarkers([m(1500)], has)).toThrow(/marker #0 \(time 1500\)/);
  });
  it("rejects a bad colour, shape, position, size and duplicate or empty ids", () => {
    expect(() => checkMarkers([m(1000, { color: "not-a-colour" })], has)).toThrow(/bad colour/);
    expect(() => checkMarkers([m(1000, { shape: "star" as never })], has)).toThrow(/unknown shape/);
    expect(() => checkMarkers([m(1000, { position: "inBar" as never })], has)).toThrow(/unknown position/);
    expect(() => checkMarkers([m(1000, { size: 0 })], has)).toThrow(/size/);
    expect(() => checkMarkers([m(1000, { id: "x" }), m(2000, { id: "x" })], has)).toThrow(/id is used by another/);
    expect(() => checkMarkers([m(1000, { id: "" })], has)).toThrow(/empty id/);
  });
});

describe("placeMarkers", () => {
  const sorted = checkMarkers([m(1000, { id: "1" }), m(1000, { id: "2", text: "buy" }), m(1000, { id: "3", position: "belowBar" }), m(2000, { id: "4" })], has);
  const placed = placeMarkers({
    markers: sorted, from: 0, to: sorted.length, barSpacing: 10, fontSize: 11, textWidth: (s) => s.length * 6,
    bar: (mk) => ({ x: mk.time / 100, yHigh: 100, yLow: 120 }),
  });
  const by = (id: string) => placed.find((p) => p.marker.id === id)!;
  it("puts the first marker above the high with a gap and the next further out", () => {
    const one = by("1"), two = by("2");
    expect(one.cy + one.size / 2).toBeLessThan(100);
    expect(100 - (one.cy + one.size / 2)).toBeGreaterThan(0);
    expect(two.cy).toBeLessThan(one.cy - one.size / 2);
    expect(two.box.h).toBeGreaterThan(two.size); // text adds height
  });
  it("below goes under the low and is independent of the above stack", () => {
    const three = by("3");
    expect(three.cy - three.size / 2).toBeGreaterThan(120);
    expect(by("4").cy).toBe(by("1").cy); // a new bar restarts the stack
  });
  it("skips markers without a bar", () => {
    const none = placeMarkers({ markers: sorted, from: 0, to: 1, barSpacing: 10, fontSize: 11, textWidth: () => 0, bar: () => undefined });
    expect(none).toEqual([]);
  });
  it("size follows bar spacing within bounds and the multiplier", () => {
    expect(markerSize(2)).toBe(8);
    expect(markerSize(100)).toBe(20);
    expect(markerSize(10, 2)).toBe(16);
  });
  it("lower bound", () => {
    expect(markerLowerBound(sorted, 1000)).toBe(0);
    expect(markerLowerBound(sorted, 1001)).toBe(3);
    expect(markerLowerBound(sorted, 5000)).toBe(4);
  });
});

describe("price line options", () => {
  it("has patterns for every style", () => {
    expect(dashPattern("large-dashed", 1)).toEqual([8, 5]);
    expect(dashPattern("sparse-dotted", 2)).toEqual([2, 12]);
    expect(dashPattern("solid", 1)).toEqual([]);
  });
  it("accepts width 1 and 2, throws on others", () => {
    expect(new PriceLine({ price: 1, lineWidth: 2 }).options().lineWidth).toBe(2);
    expect(() => new PriceLine({ price: 1, lineWidth: 3 })).toThrow(/lineWidth must be 1 or 2/);
    expect(() => new PriceLine({ price: 1, lineWidth: 1.5 })).toThrow(/lineWidth/);
    const l = new PriceLine({ price: 1 });
    expect(() => l.applyOptions({ lineWidth: 0 })).toThrow(/lineWidth/);
    expect(l.options().lineWidth).toBe(1); // a refused change changes nothing
  });
  it("throws on an unknown style or bad colours", () => {
    expect(() => new PriceLine({ price: 1, lineStyle: "wavy" as never })).toThrow(/lineStyle/);
    expect(() => new PriceLine({ price: 1, axisLabelColor: "nope" })).toThrow();
  });
  it("axis label background defaults to the line colour and takes axisLabelColor", () => {
    const view = { formatPrice: (p: number) => String(p) } as never;
    expect(new PriceLine({ price: 5, color: "#112233" }).axisLabels(view)[0]!.background).toBe("#112233");
    expect(new PriceLine({ price: 5, color: "#112233", axisLabelColor: "#445566", labelTextColor: "#fff" }).axisLabels(view)[0]).toMatchObject({ background: "#445566", color: "#fff" });
  });
});

describe("timeFormat", () => {
  const tz = new TimeZone("Asia/Kolkata");
  const t = Date.UTC(2026, 9, 20, 4, 5); // 09:35 IST
  it("formats the crosshair label with the given options in the chart's zone", () => {
    const f = new TimeFormatter("en-GB", tz, { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    expect(f.crosshair(t, true)).toBe(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t));
    expect(f.crosshair(t, true)).toContain("09:35");
    expect(f.crosshair(t, false)).toBe(f.crosshair(t, true)); // the format decides, not the bar interval
  });
  it("default is unchanged", () => {
    const a = new TimeFormatter("en-GB", tz), b = new TimeFormatter("en-GB", tz, undefined);
    expect(a.crosshair(t, true)).toBe(b.crosshair(t, true));
    expect(a.crosshair(t, true)).toMatch(/Tue/);
  });
  it("refuses its own timeZone and bad options", () => {
    expect(() => new TimeFormatter("en", tz, { timeZone: "UTC" })).toThrow(/timeZone/);
    expect(() => new TimeFormatter("en", tz, { month: "bogus" as never })).toThrow();
  });
});

describe("price scale", () => {
  it("minWidth must be a non-negative finite number", () => {
    expect(() => checkPriceScaleOptions({ minWidth: 60 })).not.toThrow();
    expect(() => checkPriceScaleOptions({})).not.toThrow();
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => checkPriceScaleOptions({ minWidth: v })).toThrow(/minWidth/);
  });
  it("has no range until it is fitted", () => {
    const sc = new PriceScale("right", { ...DEFAULT_PRICE_SCALE });
    expect(sc.ranged).toBe(false);
    sc.fit(10, 20);
    expect(sc.ranged).toBe(true);
  });
});
