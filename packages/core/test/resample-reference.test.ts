// The Resampler against pandas (fixtures/resample-reference.json, scripts/gen_resample_reference.py): the same buckets
// start at the same instants and aggregate to the same open (first), high (max), low (min), close (last) and volume (sum),
// on seeded bars with gaps, in UTC and in Asia/Kolkata (a half-hour offset), for minutes, hours, days, weeks, months and quarters.

import { describe, expect, it } from "vitest";
import { parseResolution, Resampler } from "../src/data/resample.js";
import ref from "../fixtures/resample-reference.json";

type Row = [number, number, number, number, number, number];
const src = { fine: ref.fine as Row[], coarse: ref.coarse as Row[] };

describe("Resampler against pandas", () => {
  for (const c of ref.cases) {
    it(`${c.src} -> ${c.res} in ${c.tz}`, () => {
      const rows = src[c.src as "fine" | "coarse"];
      const out = Resampler.batch(parseResolution(c.res), {
        time: rows.map((r) => r[0]), open: rows.map((r) => r[1]), high: rows.map((r) => r[2]), low: rows.map((r) => r[3]), close: rows.map((r) => r[4]), volume: rows.map((r) => r[5]),
      }, { timeZone: c.tz });
      const want = c.out as Row[];
      expect(out.length, "bucket count").toBe(want.length);
      expect(out.length).toBeGreaterThanOrEqual(3);
      want.forEach((w, i) => {
        const g = out[i]!;
        expect(g.time, `bucket ${i} start`).toBe(w[0]);
        expect(g.open, `bucket ${i} open`).toBeCloseTo(w[1], 9);
        expect(g.high, `bucket ${i} high`).toBeCloseTo(w[2], 9);
        expect(g.low, `bucket ${i} low`).toBeCloseTo(w[3], 9);
        expect(g.close, `bucket ${i} close`).toBeCloseTo(w[4], 9);
        expect(g.volume, `bucket ${i} volume`).toBeCloseTo(w[5], 6);
      });
    });
  }

  it("the same result bar by bar as one batch, and with a revised last bar", () => {
    const rows = src.fine;
    const r = new Resampler(parseResolution("1h"), { timeZone: "UTC" });
    const live: Array<{ time: number; close: number; volume: number }> = [];
    let replaced = false;
    for (const [t, o, h, l, c, v] of rows) {
      const res = r.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
      replaced = res.replaced;
      if (replaced) live[live.length - 1] = { time: res.bar.time, close: res.bar.close, volume: res.bar.volume };
      else live.push({ time: res.bar.time, close: res.bar.close, volume: res.bar.volume });
    }
    const batch = Resampler.batch(parseResolution("1h"), { time: rows.map((x) => x[0]), open: rows.map((x) => x[1]), high: rows.map((x) => x[2]), low: rows.map((x) => x[3]), close: rows.map((x) => x[4]), volume: rows.map((x) => x[5]) }, { timeZone: "UTC" });
    expect(live.map((b) => [b.time, b.close, b.volume])).toEqual(batch.map((b) => [b.time, b.close, b.volume]));
    // a tick that revises the last source bar replaces its contribution instead of adding to it
    const [t, o, h, l, c, v] = rows[rows.length - 1]!;
    r.push({ time: t, open: o, high: h, low: l, close: c + 1, volume: v + 500 });
    const last = r.push({ time: t, open: o, high: h, low: l, close: c + 2, volume: v + 700 });
    const before = batch[batch.length - 1]!;
    expect(last.bar.close).toBeCloseTo(c + 2, 9);
    expect(last.bar.volume).toBeCloseTo(before.volume + 700, 6);
  });
});
