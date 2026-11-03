import { describe, expect, it } from "vitest";
import { OrderFlow } from "../src/flow.js";
import { daySessions } from "../src/sessions.js";
import { mergeTpo, periodLetter, tpoOfSession, tpoSessions } from "../src/tpo.js";
import type { Trade } from "@alphacharts/core";

const D0 = Date.UTC(2026, 9, 20); // session = UTC day
const at = (h: number, m: number) => D0 + (h * 60 + m) * 60_000;
const flow = () => new OrderFlow({ tickSize: 1, periodMs: 600_000, sessions: daySessions("UTC") });
const tr = (time: number, price: number): Trade => ({ time, price, size: 1, side: "buy" });

// A hand-built day on 10-minute bars, TPO periods of 30 minutes:
//   A 00:00-00:30 traded 100,101 | 101,102 | 102,103          -> 100..103
//   B 00:30-01:00 traded 103,104 | 104,105 | 103               -> 103..105
//   C 01:00-01:30 traded 102,103 | (nothing) | 101             -> 101..103
// TPOs per price: 100:A=1  101:A,C=2  102:A,C=2  103:A,B,C=3  104:B=1  105:B=1  (10 in all)
const day = [
  tr(at(0, 0), 100), tr(at(0, 1), 101), tr(at(0, 10), 101), tr(at(0, 11), 102), tr(at(0, 20), 102), tr(at(0, 21), 103),
  tr(at(0, 30), 103), tr(at(0, 31), 104), tr(at(0, 40), 104), tr(at(0, 41), 105), tr(at(0, 50), 103),
  tr(at(1, 0), 102), tr(at(1, 1), 103), tr(at(1, 20), 101),
];

describe("TPO on a hand-built day", () => {
  const f = flow();
  f.addMany(day);
  const p = tpoOfSession(f, 0, f.bars.length - 1);

  it("letters per row", () => {
    expect(p.periods).toBe(3);
    expect(p.rowPrice(0)).toBe(100);
    const letters = (price: number) => [0, 1, 2].filter((q) => p.has(price - 100, q)).map(periodLetter).join("");
    expect([100, 101, 102, 103, 104, 105].map(letters)).toEqual(["A", "AC", "AC", "ABC", "B", "B"]);
    expect(Array.from(p.counts)).toEqual([1, 2, 2, 3, 1, 1]);
  });

  it("POC, value area, initial balance, single prints", () => {
    expect(p.rowPrice(p.poc)).toBe(103);
    // 70% of 10 = 7: POC 3, up pair (104,105) = 2 vs down pair (102,101) = 4: take down -> 7.
    expect([p.rowPrice(p.vaLow), p.rowPrice(p.vaHigh)]).toEqual([101, 103]);
    // Initial balance = first two periods (A, B): 100..105.
    expect([p.ibLow, p.ibHigh]).toEqual([100, 105]);
    expect(p.singlePrints).toEqual([[0, 0], [4, 5]]);
    expect(p.approximate).toBe(false);
  });

  it("letters follow the period index: A..Z then a..z, then +", () => {
    expect([0, 25, 26, 51, 52].map(periodLetter)).toEqual(["A", "Z", "a", "z", "+"]);
  });

  it("shows only traded levels: a level skipped inside a period gets no letter", () => {
    const g = flow();
    g.addMany([tr(at(0, 0), 100), tr(at(0, 1), 103)]);
    const q = tpoOfSession(g, 0, 0);
    expect(Array.from(q.counts)).toEqual([1, 0, 0, 1]);
  });

  it("split: one profile per session; merged: counts added", () => {
    const g = flow();
    const next = (t: Trade): Trade => ({ ...t, time: t.time + 86_400_000, price: t.price + 1 });
    g.addMany([...day, ...day.map(next)]);
    const split = tpoSessions(g, 0, g.bars.length - 1);
    expect(split.length).toBe(2);
    expect(split[1]!.start).toBe(D0 + 86_400_000);
    expect(Array.from(split[1]!.counts)).toEqual([1, 2, 2, 3, 1, 1]);
    expect(split[1]!.rowPrice(0)).toBe(101);
    const m = mergeTpo(g, split);
    expect(m.merged).toBe(true);
    // Prices 100..106; day one covers 100..105, day two 101..106.
    expect(Array.from(m.counts)).toEqual([1, 3, 4, 5, 4, 2, 1]);
    expect(m.rowPrice(m.poc)).toBe(103);
  });

  it("refuses a period the bars do not divide, and a bar that straddles periods", () => {
    expect(() => tpoOfSession(f, 0, f.bars.length - 1, { periodMs: 700_000 })).toThrow(/multiple of the bar length/);
    // 30-minute bars that start at :15 straddle the 30-minute periods counted from midnight.
    const h = new OrderFlow({ tickSize: 1, periodMs: 1_800_000, anchorMs: 900_000, sessions: daySessions("UTC") });
    h.add(tr(at(0, 20), 100));
    expect(() => tpoOfSession(h, 0, 0)).toThrow(/does not sit inside one/);
  });

  it("from bars only it assumes every level of the range was touched, and says so", () => {
    const a = OrderFlow.fromBars([{ time: at(0, 0), open: 100, high: 103, low: 100, close: 102, volume: 40 }], { tickSize: 1, periodMs: 600_000, sessions: daySessions("UTC") });
    const q = tpoOfSession(a, 0, 0);
    expect(q.approximate).toBe(true);
    expect(Array.from(q.counts)).toEqual([1, 1, 1, 1]);
  });
});
