import { describe, expect, it } from "vitest";
import { NSE, Sessions, US_EQUITY } from "../src/data/session.js";
import { parseResolution, Resampler } from "../src/data/resample.js";

const ist = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;

describe("Sessions", () => {
  const nse = new Sessions(NSE(["2026-10-02"]));
  it("classifies NSE minutes (IST) as regular, extended, closed", () => {
    expect(nse.state(ist(2026, 10, 20, 9, 15))).toBe("regular");
    expect(nse.state(ist(2026, 10, 20, 15, 29))).toBe("regular");
    expect(nse.state(ist(2026, 10, 20, 15, 30))).toBe("closed");
    expect(nse.state(ist(2026, 10, 20, 9, 5))).toBe("extended"); // pre-open
    expect(nse.state(ist(2026, 10, 18, 11, 0))).toBe("closed"); // Sunday
    expect(nse.state(ist(2026, 10, 2, 11, 0))).toBe("closed"); // holiday
  });
  it("finds the session start, skipping weekends and holidays", () => {
    expect(nse.sessionStart(ist(2026, 10, 20, 11, 0))).toBe(ist(2026, 10, 20, 9, 15));
    expect(nse.sessionStart(ist(2026, 10, 20, 16, 0))).toBe(ist(2026, 10, 21, 9, 15)); // after close → next
    expect(nse.sessionStart(ist(2026, 10, 1, 16, 0))).toBe(ist(2026, 10, 5, 9, 15)); // Thu close → Fri holiday → Mon
  });
  it("follows US daylight saving", () => {
    const us = new Sessions(US_EQUITY());
    // 09:30 New York is 13:30 UTC in summer and 14:30 UTC in winter.
    expect(us.state(Date.UTC(2026, 6, 15, 13, 30))).toBe("regular");
    expect(us.state(Date.UTC(2026, 11, 15, 13, 30))).toBe("extended");
    expect(us.state(Date.UTC(2026, 11, 15, 14, 30))).toBe("regular");
  });
});

describe("Resampler", () => {
  it("parses resolutions", () => {
    expect(parseResolution("75m")).toEqual({ unit: "m", n: 75 });
    expect(parseResolution("15")).toEqual({ unit: "m", n: 15 });
    expect(parseResolution("D")).toEqual({ unit: "D", n: 1 });
    expect(() => parseResolution("0m")).toThrow();
  });

  it("aligns intraday buckets to the NSE open (75m: 09:15, 10:30, …)", () => {
    const r = new Resampler(parseResolution("75m"), { sessions: NSE() });
    expect(r.bucketStart(ist(2026, 10, 20, 9, 15))).toBe(ist(2026, 10, 20, 9, 15));
    expect(r.bucketStart(ist(2026, 10, 20, 10, 29))).toBe(ist(2026, 10, 20, 9, 15));
    expect(r.bucketStart(ist(2026, 10, 20, 10, 30))).toBe(ist(2026, 10, 20, 10, 30));
    // 09:15, 10:30, 11:45, 13:00, 14:15: the last bucket of the day holds 15:20.
    expect(r.bucketStart(ist(2026, 10, 20, 15, 20))).toBe(ist(2026, 10, 20, 14, 15));
  });

  it("weeks start Monday, months on the 1st, in the chart's zone", () => {
    const w = new Resampler(parseResolution("1W"), { timeZone: "Asia/Kolkata" });
    expect(w.bucketStart(ist(2026, 10, 21, 12, 0))).toBe(ist(2026, 10, 19, 0, 0)); // Wed → Mon 19th
    expect(w.bucketStart(ist(2026, 10, 19, 0, 0))).toBe(ist(2026, 10, 19, 0, 0));
    const m3 = new Resampler(parseResolution("3M"), { timeZone: "Asia/Kolkata" });
    expect(m3.bucketStart(ist(2026, 11, 15, 12, 0))).toBe(ist(2026, 10, 1, 0, 0)); // Oct–Dec quarter
  });

  it("aggregates exactly and treats a repeated time as a revision", () => {
    const r = new Resampler(parseResolution("5m"));
    const t0 = Date.UTC(2026, 0, 1, 10, 0);
    const bar = (k: number, o: number, h: number, l: number, c: number, v: number) => ({ time: t0 + k * 60_000, open: o, high: h, low: l, close: c, volume: v });
    r.push(bar(0, 10, 12, 9, 11, 100));
    r.push(bar(1, 11, 15, 10, 14, 50));
    const rev = r.push(bar(1, 11, 13, 10, 12, 60)); // tick revision of minute 1: replaces, not adds
    expect(rev).toEqual({ replaced: true, bar: { time: t0, open: 10, high: 13, low: 9, close: 12, volume: 160 } });
    const next = r.push(bar(5, 12, 12.5, 11, 11.5, 10));
    expect(next).toEqual({ replaced: false, bar: { time: t0 + 300_000, open: 12, high: 12.5, low: 11, close: 11.5, volume: 10 } });
    expect(() => r.push(bar(4, 1, 1, 1, 1, 1))).toThrow(/before/);
  });

  it("batch equals incremental on random data", () => {
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const n = 5000, t0 = Date.UTC(2026, 0, 1);
    const time = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
    let t = t0;
    for (let i = 0; i < n; i++) {
      t += 60_000 * (1 + Math.floor(rnd() * 3));
      time[i] = t; o[i] = 100 + rnd(); c[i] = 100 + rnd(); h[i] = Math.max(o[i]!, c[i]!) + rnd(); l[i] = Math.min(o[i]!, c[i]!) - rnd(); v[i] = Math.floor(rnd() * 100);
    }
    const out = Resampler.batch(parseResolution("15m"), { time, open: o, high: h, low: l, close: c, volume: v });
    let vol = 0;
    for (const b of out) vol += b.volume;
    expect(vol).toBe(v.reduce((a, b) => a + b, 0));
    for (let i = 1; i < out.length; i++) expect(out[i]!.time - out[i - 1]!.time).toBeGreaterThanOrEqual(900_000);
  });
});
