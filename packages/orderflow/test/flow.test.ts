import { describe, expect, it } from "vitest";
import type { Datafeed, Trade } from "@alphacharts/core";
import { OrderFlow, loadTrades } from "../src/flow.js";
import { attachCvd, cvdOhlc, deltaValues } from "../src/cvd.js";
import { randomTrades } from "./helpers.js";

describe("cumulative volume delta", () => {
  // Bar 0 (0-60 s): +5, +3, -10 (unknown 99 ignored), -2  -> running 5, 8, -2, -4.
  // Bar 1: starts at -4: +1 -> -3.
  const trades: Trade[] = [
    { time: 0, price: 10, size: 5, side: "buy" },
    { time: 1, price: 10, size: 3, side: "buy" },
    { time: 2, price: 10, size: 99, side: "unknown" },
    { time: 3, price: 11, size: 10, side: "sell" },
    { time: 4, price: 11, size: 2, side: "sell" },
    { time: 60_000, price: 11, size: 1, side: "buy" },
  ];
  it("open/high/low/close are the running delta, exactly", () => {
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    f.addMany(trades);
    const c = cvdOhlc(f);
    expect(Array.from(c.open)).toEqual([0, -4]);
    expect(Array.from(c.high)).toEqual([8, -3]);
    expect(Array.from(c.low)).toEqual([-4, -4]);
    expect(Array.from(c.close)).toEqual([-4, -3]);
  });
  it("delta per bar excludes unknown", () => {
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    f.addMany(trades);
    expect(Array.from(deltaValues(f, 1, 2).value)).toEqual([-4, 1]);
  });
  it("resets by session when asked", () => {
    const day = 86_400_000;
    const sessions = { id: (t: number) => Math.floor(t / day), start: (t: number) => Math.floor(t / day) * day };
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000, sessions, resetCvdBySession: true });
    f.addMany([{ time: 0, price: 10, size: 4, side: "buy" }, { time: day, price: 10, size: 1, side: "buy" }]);
    expect(Array.from(cvdOhlc(f).open)).toEqual([0, 0]);
    const g = new OrderFlow({ tickSize: 1, periodMs: 60_000, sessions });
    g.addMany([{ time: 0, price: 10, size: 4, side: "buy" }, { time: day, price: 10, size: 1, side: "buy" }]);
    expect(Array.from(cvdOhlc(g).open)).toEqual([0, 4]);
  });
  it("refuses a flow built from bars: it has no sides", () => {
    const a = OrderFlow.fromBars([{ time: 0, open: 1, high: 2, low: 1, close: 2, volume: 5 }], { tickSize: 1, periodMs: 60_000 });
    expect(() => cvdOhlc(a)).toThrow(/needs trades/);
    expect(() => attachCvd({} as never, a)).toThrow(/needs trades/);
    expect(() => deltaValues(a, 1, 2)).toThrow(/needs trades/);
  });
});

function feed(all: Trade[], extra: Partial<Datafeed> = {}): Datafeed & { live: ((t: Trade) => void) | null; calls: [number, number][] } {
  const f = {
    live: null as ((t: Trade) => void) | null,
    calls: [] as [number, number][],
    getBars: async () => ({ bars: [], noMoreData: true }),
    getTrades: async (r: { from: number; to: number }) => {
      f.calls.push([r.from, r.to]);
      return all.filter((t) => t.time >= r.from && t.time < r.to);
    },
    subscribeTrades: (_s: string, cb: (t: Trade) => void) => {
      f.live = cb;
      return () => (f.live = null);
    },
    ...extra,
  };
  return f as never;
}

describe("loadTrades", () => {
  const T0 = Date.UTC(2026, 9, 20, 4, 0);
  const hist = randomTrades(2000, 2, T0);
  const end = hist[hist.length - 1]!.time + 1;

  it("loads history window by window and applies live trades after it", async () => {
    const f = new OrderFlow({ tickSize: 0.05, periodMs: 60_000 });
    const d = feed(hist);
    const errors: unknown[] = [];
    const l = loadTrades(f, d, { symbol: "X", from: T0, to: end, chunkMs: 600_000, onError: (e) => errors.push(e) });
    // A live trade before history finished is held; one inside the history window is covered by it.
    d.live!({ time: end - 5, price: 25_000, size: 1, side: "buy" });
    d.live!({ time: end + 10, price: 25_000, size: 2, side: "sell" });
    await l.done;
    expect(errors).toEqual([]);
    expect(d.calls.length).toBeGreaterThan(1);
    expect(d.calls.every(([a, b]) => b - a <= 600_000)).toBe(true);
    expect(f.store!.length).toBe(hist.length + 1);
    expect(l.coveredByHistory).toBe(1);
    d.live!({ time: end + 20, price: 25_000.05, size: 3, side: "buy" });
    expect(f.store!.length).toBe(hist.length + 2);
    l.dispose();
    expect(d.live).toBeNull();
  });

  it("reports a failed request and an out-of-order live trade, and drops nothing silently", async () => {
    const f = new OrderFlow({ tickSize: 0.05, periodMs: 60_000 });
    const errors: unknown[] = [];
    const bad = feed(hist, { getTrades: async () => { throw new Error("boom"); } });
    const l = loadTrades(f, bad, { symbol: "X", from: T0, to: end, onError: (e) => errors.push(e) });
    await l.done;
    expect(String(errors[0])).toMatch(/boom/);

    const g = new OrderFlow({ tickSize: 0.05, periodMs: 60_000 });
    const d = feed(hist);
    const e2: unknown[] = [];
    const m = loadTrades(g, d, { symbol: "X", from: T0, to: end, onError: (e) => e2.push(e) });
    await m.done;
    d.live!({ time: end + 100, price: 25_000, size: 1, side: "buy" });
    d.live!({ time: end + 50, price: 25_000, size: 1, side: "buy" });
    expect(String(e2[0])).toMatch(/older/);
    expect(g.store!.length).toBe(hist.length + 1);
  });

  it("stops on dispose: no more requests and no error", async () => {
    const f = new OrderFlow({ tickSize: 0.05, periodMs: 60_000 });
    const d = feed(hist);
    const errors: unknown[] = [];
    const l = loadTrades(f, d, { symbol: "X", from: T0, to: end, chunkMs: 60_000, onError: (e) => errors.push(e) });
    l.dispose();
    await l.done;
    expect(d.calls.length).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  it("needs getTrades and a non-empty window", () => {
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    expect(() => loadTrades(f, { getBars: async () => ({ bars: [], noMoreData: true }) }, { symbol: "X", from: 0, to: 1, onError() {} })).toThrow(/getTrades/);
    expect(() => loadTrades(f, feed([]), { symbol: "X", from: 5, to: 5, onError() {} })).toThrow(/empty/);
  });
});

describe("review regressions", () => {
  it("a session profile and TPO always cover the whole session, whatever is in view", async () => {
    const { SessionProfiles, profileOfBars } = await import("../src/profile.js");
    const { tpoSessions } = await import("../src/tpo.js");
    const { daySessions } = await import("../src/sessions.js");
    const f = new OrderFlow({ tickSize: 1, periodMs: 600_000, sessions: daySessions("UTC") });
    const D = Date.UTC(2026, 9, 20);
    f.addMany([{ time: D, price: 100, size: 50, side: "buy" }, { time: D + 600_000, price: 101, size: 1, side: "buy" }, { time: D + 86_400_000, price: 100, size: 2, side: "buy" }]);
    const sp = new SessionProfiles(f);
    expect(sp.range(1, 1)[0]!.profile.sum.total).toBe(51);
    expect(sp.range(0, 2)[0]!.firstBar).toBe(0);
    expect(tpoSessions(f, 1, 1)[0]!.rowCount).toBe(2);
    // The open session is rebuilt after a trade even if an unrelated range was asked in between.
    sp.range(2, 2);
    f.add({ time: D + 86_400_000 + 1, price: 100, size: 5, side: "buy" });
    sp.range(0, 0);
    expect(sp.range(2, 2)[0]!.profile.sum.total).toBe(7);
    expect(profileOfBars(f.bars, 2, 2).sum.total).toBe(7);
  });

  it("the footprint analysis of a bar that closed after it was cached is recomputed", async () => {
    const { FootprintSource } = await import("../src/footprint.js");
    const { FOOTPRINT_DEFAULTS } = await import("../src/footprint.js");
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    f.add({ time: 0, price: 10, size: 1, side: "buy" });
    const s = new FootprintSource(f, { logicalToTime: (i) => i, timeToLogical: (t) => t });
    expect(s.analysis(0, FOOTPRINT_DEFAULTS as never).buy[0]).toBe(1);
    f.addMany([{ time: 1, price: 10, size: 9, side: "buy" }, { time: 60_000, price: 10, size: 1, side: "buy" }]);
    expect(s.analysis(0, FOOTPRINT_DEFAULTS as never).buy[0]).toBe(10);
  });

  it("approximate flows re-sum rather than step (fractional shares), and TPO counts do not wrap", async () => {
    const { VisibleProfile, profileOfBars } = await import("../src/profile.js");
    const rows = Array.from({ length: 60 }, (_, i) => ({ time: i * 60_000, open: 10, high: 12, low: 10, close: 11, volume: 10 }));
    const a = OrderFlow.fromBars(rows, { tickSize: 1, periodMs: 60_000 });
    expect(a.bars.integerSizes).toBe(false);
    const v = new VisibleProfile(a);
    for (let s = 0; s < 25; s++) expect(v.update(s, s + 30).sum.total).toBe(profileOfBars(a.bars, s, s + 30).sum.total);
    const { tpoOfSession } = await import("../src/tpo.js");
    const { daySessions } = await import("../src/sessions.js");
    const g = new OrderFlow({ tickSize: 1, periodMs: 1000, sessions: daySessions("UTC") });
    const t0 = Date.UTC(2026, 9, 20);
    g.addMany(Array.from({ length: 70_000 }, (_, i) => ({ time: t0 + i * 1000, price: 10, size: 1, side: "buy" as const })));
    expect(tpoOfSession(g, 0, g.bars.length - 1, { periodMs: 1000 }).counts[0]).toBe(70_000);
  });

  it("loadTrades refuses a future history end and a chunk outside its window", async () => {
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    const d = feed([]);
    expect(() => loadTrades(f, d, { symbol: "X", from: 0, to: Date.now() + 86_400_000, onError() {} })).toThrow(/future/);
    const errs: unknown[] = [];
    const bad = feed([], { getTrades: async () => [{ time: 100, price: 1, size: 1, side: "buy" as const }] });
    await loadTrades(f, bad, { symbol: "X", from: 0, to: 100, onError: (e) => errs.push(e) }).done;
    expect(String(errs[0])).toMatch(/outside the requested/);
    expect(f.store!.length).toBe(0);
  });
});
