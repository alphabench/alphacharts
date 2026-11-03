import { describe, expect, it } from "vitest";
import { OrderFlow } from "../src/flow.js";
import { daySessions } from "../src/sessions.js";
import { fixedRangeProfile, profileOfBars, SessionProfiles, VisibleProfile, type Profile } from "../src/profile.js";
import { levelTrades, randomTrades } from "./helpers.js";

const T0 = Date.UTC(2026, 9, 20, 4, 0);
const flowOf = (levels: Record<number, [number, number, number]>) => {
  const f = new OrderFlow({ tickSize: 1, periodMs: 3_600_000 });
  f.addMany(levelTrades(T0, levels));
  return f;
};

describe("profile fixtures (hand computed)", () => {
  // [buy, sell, unknown] per price. Totals: 5 10 20 40 30 15 5 3 2 = 130 (buy 61, sell 56, unknown 13).
  const f = flowOf({ 100: [3, 2, 0], 101: [4, 5, 1], 102: [10, 8, 2], 103: [20, 15, 5], 104: [12, 15, 3], 105: [8, 6, 1], 106: [2, 3, 0], 107: [1, 1, 1], 108: [1, 1, 0] });

  it("sums, POC and the 70% value area", () => {
    const p = profileOfBars(f.bars, 0, 0);
    expect(Array.from(p.total)).toEqual([5, 10, 20, 40, 30, 15, 5, 3, 2]);
    expect(p.sum).toEqual({ buy: 61, sell: 56, unknown: 13, total: 130, delta: 5 });
    expect(p.poc).toBe(3);
    expect(p.rowPrice(p.poc)).toBe(103);
    // target 0.7 × 130 = 91. Start 40 (row 103). Up pair 104+105 = 45 vs down pair 102+101 = 30: take up → 85 < 91.
    // Up pair 106+107 = 8 vs down 30: take down → 115 ≥ 91. Area = rows 101..105.
    expect([p.rowPrice(p.vaLow), p.rowPrice(p.vaHigh)]).toEqual([101, 105]);
    expect(p.hvn).toEqual([]);
    expect(p.lvn).toEqual([]);
    expect(p.approximate).toBe(false);
  });

  it("value area percentage is configurable", () => {
    // 50% of 130 = 65: 40 → +45 (104,105) = 85 ≥ 65: area 103..105.
    const p = profileOfBars(f.bars, 0, 0, { valueAreaPct: 0.5 });
    expect([p.rowPrice(p.vaLow), p.rowPrice(p.vaHigh)]).toEqual([103, 105]);
    expect(() => profileOfBars(f.bars, 0, 0, { valueAreaPct: 0 })).toThrow(/valueAreaPct/);
  });

  it("rows by ticks: 2-tick rows are anchored on the absolute tick grid", () => {
    const p = profileOfBars(f.bars, 0, 0, { rowTicks: 2 });
    // Rows [100,101] [102,103] [104,105] [106,107] [108,109]: 15 60 45 8 2.
    expect(Array.from(p.total)).toEqual([15, 60, 45, 8, 2]);
    expect(p.rowPrice(0)).toBe(100);
    expect(p.rowTopPrice(0)).toBe(101);
    expect(p.poc).toBe(1);
    // 91 target: 60, up pair 45+8 = 53 vs down 15 → 113 ≥ 91.
    expect([p.vaLow, p.vaHigh]).toEqual([1, 3]);
  });

  it("rows by count: 9 ticks into 3 rows is 3 ticks per row", () => {
    const p = profileOfBars(f.bars, 0, 0, { rows: 3 });
    expect(p.rowTicks).toBe(3);
    // Anchored at multiples of 3: [99..101] [102..104] [105..107] [108..110]: 15 90 23 2.
    expect(Array.from(p.total)).toEqual([15, 90, 23, 2]);
  });

  it("HVN and LVN on a second fixture", () => {
    // Totals by price 100..109: 5 30 8 2 9 40 7 3 28 4 (all buy). POC 105 (40).
    // HVN: ≥ 0.6·40 = 24 and the max within ±2 rows: 101 (30) and 108 (28).
    // LVN: ≤ 0.3·40 = 12, the min within ±2 rows, window inside the profile: 103 (2) and 107 (3).
    const g = flowOf({ 100: [5, 0, 0], 101: [30, 0, 0], 102: [8, 0, 0], 103: [2, 0, 0], 104: [9, 0, 0], 105: [40, 0, 0], 106: [7, 0, 0], 107: [3, 0, 0], 108: [28, 0, 0], 109: [4, 0, 0] });
    const p = profileOfBars(g.bars, 0, 0);
    expect(p.poc).toBe(5);
    expect(p.hvn).toEqual([1, 8]);
    expect(p.lvn).toEqual([3, 7]);
  });

  it("a tie for POC goes to the row nearest the middle, then the lower", () => {
    const g = flowOf({ 100: [10, 0, 0], 101: [1, 0, 0], 102: [10, 0, 0], 103: [1, 0, 0], 104: [10, 0, 0] });
    expect(profileOfBars(g.bars, 0, 0).poc).toBe(2);
    const h = flowOf({ 100: [10, 0, 0], 101: [10, 0, 0] });
    expect(profileOfBars(h.bars, 0, 0).poc).toBe(0);
  });

  it("an empty range gives an empty profile", () => {
    const e = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    const p = profileOfBars(e.bars, 0, 10);
    expect([p.rowCount, p.poc, p.vaLow, p.sum.total]).toEqual([0, -1, -1, 0]);
  });
});

/** Brute force straight from the raw trades. */
function bruteProfile(flow: OrderFlow, from: number, to: number) {
  const st = flow.store!;
  const rows = new Map<number, [number, number, number]>();
  for (let i = 0; i < st.length; i++) {
    if (st.time(i) < from || st.time(i) >= to) continue;
    const k = Math.round(st.price(i) / flow.bars.tickSize);
    const r = rows.get(k) ?? [0, 0, 0];
    r[st.side(i) > 0 ? 0 : st.side(i) < 0 ? 1 : 2]! += st.size(i);
    rows.set(k, r);
  }
  return rows;
}
const rowsOf = (p: Profile) => {
  const m = new Map<number, [number, number, number]>();
  for (let i = 0; i < p.rowCount; i++) if (p.total[i]! > 0) m.set(p.firstTick + i * p.rowTicks, [p.buy[i]!, p.sell[i]!, p.unknown[i]!]);
  return m;
};

describe("profiles equal brute force on seeded random trades", () => {
  const f = new OrderFlow({ tickSize: 0.05, periodMs: 60_000, sessions: daySessions("Asia/Kolkata", 9 * 3_600_000 + 15 * 60_000) });
  f.addMany(randomTrades(40_000, 5, Date.UTC(2026, 9, 19, 3, 0)));

  it("bar range", () => {
    const lo = 10, hi = 90;
    const p = profileOfBars(f.bars, lo, hi);
    expect(rowsOf(p)).toEqual(bruteProfile(f, f.bars.start[lo]!, f.bars.start[hi]! + 60_000));
  });

  it("fixed range, time and price anchored, at arbitrary (non-bar) times", () => {
    const from = f.bars.start[5]! + 12_345, to = f.bars.start[60]! + 41_000;
    const p = fixedRangeProfile(f, { from, to, priceLow: 24_999.9, priceHigh: 25_000.1 });
    const want = new Map([...bruteProfile(f, from, to)].filter(([k]) => k >= Math.round(24_999.9 / 0.05) && k <= Math.round(25_000.1 / 0.05)));
    expect(rowsOf(p)).toEqual(want);
    expect(want.size).toBeGreaterThan(0);
    expect(() => fixedRangeProfile(f, { from: to, to: from })).toThrow(/empty/);
  });

  it("without raw trades a fixed range must sit on bar boundaries", () => {
    const g = new OrderFlow({ tickSize: 0.05, periodMs: 60_000, keepTrades: false });
    g.addMany(randomTrades(2000, 9));
    expect(() => fixedRangeProfile(g, { from: g.bars.start[0]! + 5, to: g.bars.start[3]! })).toThrow(/bar boundaries/);
    const p = fixedRangeProfile(g, { from: g.bars.start[0]!, to: g.bars.start[3]! });
    expect(p.sum.total).toBe(g.bars.volume(0) + g.bars.volume(1) + g.bars.volume(2));
  });

  it("visible range: panning and zooming incrementally equals a fresh sum every time", () => {
    const v = new VisibleProfile(f);
    const ranges: [number, number][] = [[0, 30], [5, 35], [5, 20], [50, 80], [49, 81], [0, f.bars.length - 1], [10, 20], [11, 12], [12, 11]];
    for (const [lo, hi] of ranges) {
      const got = v.update(lo, hi);
      expect(rowsOf(got), `[${lo}, ${hi}]`).toEqual(rowsOf(profileOfBars(f.bars, lo, hi)));
    }
  });

  it("visible range follows live trades into the newest bar", () => {
    const g = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    g.addMany(randomTrades(500, 4, T0, 1).map((t) => ({ ...t, price: Math.round(t.price) })));
    const v = new VisibleProfile(g);
    const last = () => g.bars.length - 1;
    expect(v.update(0, last()).sum.total).toBe(profileOfBars(g.bars, 0, last()).sum.total);
    const t = g.bars.start[last()]! + 59_000;
    g.add({ time: t, price: 25_000, size: 10, side: "buy" });
    expect(rowsOf(v.update(0, last()))).toEqual(rowsOf(profileOfBars(g.bars, 0, last())));
    g.add({ time: t + 60_000, price: 25_001, size: 3, side: "sell" }); // a new bar opens
    expect(rowsOf(v.update(0, last()))).toEqual(rowsOf(profileOfBars(g.bars, 0, last())));
    expect(rowsOf(v.update(1, last() - 1))).toEqual(rowsOf(profileOfBars(g.bars, 1, last() - 1)));
  });

  it("fractional sizes fall back to re-summing, still equal to the brute force sums", () => {
    const g = new OrderFlow({ tickSize: 0.05, periodMs: 60_000 });
    g.addMany(randomTrades(3000, 8, T0, 0.05, true));
    expect(g.bars.integerSizes).toBe(false);
    const v = new VisibleProfile(g);
    for (const [lo, hi] of [[0, 10], [2, 12], [3, 8]] as const) {
      expect(rowsOf(v.update(lo, hi))).toEqual(rowsOf(profileOfBars(g.bars, lo, hi)));
    }
  });

  it("sessions split at the zone's session start (09:15 IST) and sum to the whole", () => {
    const sp = new SessionProfiles(f);
    const all = sp.range(0, f.bars.length - 1);
    expect(all.length).toBeGreaterThan(1);
    let total = 0;
    for (const s of all) {
      total += s.profile.sum.total;
      // 09:15 IST = 03:45 UTC.
      expect(new Date(s.start).toISOString().slice(11, 19)).toBe("03:45:00");
      expect(s.profile.sum.total).toBe(profileOfBars(f.bars, s.firstBar, s.lastBar).sum.total);
    }
    let want = 0;
    for (let i = 0; i < f.bars.length; i++) want += f.bars.volume(i);
    expect(total).toBe(want);
  });
});

describe("session boundaries", () => {
  it("a bar just before the session start belongs to the previous session", () => {
    const s = daySessions("Asia/Kolkata", 9 * 3_600_000 + 15 * 60_000);
    const open = Date.UTC(2026, 9, 20, 3, 45);
    expect(s.start(open)).toBe(open);
    expect(s.start(open - 1)).toBe(open - 86_400_000);
    expect(s.id(open)).toBe(s.id(open - 1) + 1);
    expect(s.start(open + 5 * 3_600_000)).toBe(open);
  });
  it("follows a DST change (America/New_York, midnight sessions)", () => {
    const s = daySessions("America/New_York");
    // 2026-11-01 01:30 local is EDT (UTC-4); the day started at 00:00 EDT = 04:00 UTC and lasts 25 h.
    expect(s.start(Date.UTC(2026, 10, 1, 8, 0))).toBe(Date.UTC(2026, 10, 1, 4, 0));
    // 04:30 UTC on Nov 2 is 23:30 EST on Nov 1: still the same 25-hour day; the next starts 05:00 UTC.
    expect(s.start(Date.UTC(2026, 10, 2, 4, 30))).toBe(Date.UTC(2026, 10, 1, 4, 0));
    expect(s.start(Date.UTC(2026, 10, 2, 5, 30))).toBe(Date.UTC(2026, 10, 2, 5, 0));
  });
  it("rejects an unknown zone", () => {
    expect(() => daySessions("Nowhere/Land")).toThrow(RangeError);
  });
});
