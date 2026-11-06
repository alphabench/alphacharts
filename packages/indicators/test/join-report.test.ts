// describeJoin: why a join is blank, for a host to say so. NSE hourly bars open at 09:15 IST, MCX's at 09:00: a chart on one
// reading the other's hourly series through the same-length join never meets, and every value is blank.

import { describe, expect, it } from "vitest";
import { describeJoin } from "../src/engine/feed.js";

const H = 3_600_000, M = 60_000;
const utc = (h: number, m: number) => Date.UTC(2026, 0, 5, h, m);
const hourly = (h: number, m: number, n: number) => Array.from({ length: n }, (_, i) => utc(h, m) + i * H);

describe("describeJoin", () => {
  it("hourly bars of two exchanges that open 15 minutes apart: nothing matches, and the report says by how much", () => {
    const mcx = hourly(3, 30, 6); // 09:00 IST
    const nse = hourly(3, 45, 6); // 09:15 IST
    const asNse = describeJoin(mcx, nse, { align: "same", spanMs: H });
    expect(asNse).toMatchObject({ matched: 0, chartBars: 6, reason: "different-clock", offsetMs: 15 * M });
    expect(asNse.message).toMatch(/15 minutes after the chart's/);
    const asMcx = describeJoin(nse, mcx, { align: "same", spanMs: H });
    expect(asMcx).toMatchObject({ matched: 0, reason: "different-clock", offsetMs: -15 * M });
    expect(asMcx.message).toMatch(/15 minutes before the chart's/);
  });
  it("the same clock is complete; a hole is partial", () => {
    const t = hourly(3, 45, 6);
    expect(describeJoin(t, t, { align: "same", spanMs: H })).toMatchObject({ matched: 6, reason: "complete", offsetMs: null });
    const holed = t.filter((_, i) => i !== 2);
    expect(describeJoin(t, holed, { align: "same", spanMs: H })).toMatchObject({ matched: 5, reason: "partial" });
  });
  it("a longer timeframe joins on the finished bar, whatever the clock; before the first one finishes it is blank", () => {
    const chart = hourly(3, 30, 6);
    const daily = [Date.UTC(2026, 0, 4)];
    expect(describeJoin(chart, daily, { align: "closed", spanMs: 24 * H })).toMatchObject({ matched: 6, reason: "complete" });
    const later = [Date.UTC(2026, 0, 5)];
    expect(describeJoin(chart, later, { align: "closed", spanMs: 24 * H })).toMatchObject({ matched: 0, reason: "no-finished-bar" });
  });
  it("an empty chart or feed", () => {
    expect(describeJoin([], [1], { align: "same", spanMs: H }).reason).toBe("empty");
    expect(describeJoin([1], [], { align: "same", spanMs: H }).reason).toBe("empty");
  });
  it("agrees with the join itself on what is blank", async () => {
    const { Feed } = await import("../src/engine/feed.js");
    const chart = hourly(3, 30, 6), feedT = hourly(3, 45, 6);
    const f = new Feed();
    const col = (v: number) => Float64Array.from(feedT, () => v);
    f.load({ time: Float64Array.from(feedT), open: col(1), high: col(1), low: col(1), close: col(1), volume: col(1) }, { align: "same", spanMs: H });
    const seen = chart.filter((t) => f.lookup(t) >= 0).length;
    expect(seen).toBe(describeJoin(chart, feedT, { align: "same", spanMs: H }).matched);
  });
});
