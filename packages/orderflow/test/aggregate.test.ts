import { describe, expect, it } from "vitest";
import type { Trade } from "@alphacharts/core";
import { barsClock, fixedClock } from "../src/bars.js";
import { OrderFlow } from "../src/flow.js";
import { TradeStore } from "../src/trade-store.js";
import { randomTrades } from "./helpers.js";

const mk = (opts: Partial<ConstructorParameters<typeof OrderFlow>[0]> = {}) => new OrderFlow({ tickSize: 0.05, periodMs: 60_000, ...opts });

/** Brute force: per (bar start, tick) sums in arrival order, plus per-bar totals. */
function brute(trades: Trade[], tick: number, period: number) {
  const cells = new Map<string, [number, number, number, number]>();
  const bars = new Map<number, { buy: number; sell: number; unk: number; n: number; o: number; h: number; l: number; c: number }>();
  for (const t of trades) {
    const start = Math.floor(t.time / period) * period;
    const k = Math.round(t.price / tick);
    const key = `${start}|${k}`;
    const c = cells.get(key) ?? [0, 0, 0, 0];
    c[t.side === "buy" ? 0 : t.side === "sell" ? 1 : 2]! += t.size;
    c[3]! += 1;
    cells.set(key, c);
    const b = bars.get(start) ?? { buy: 0, sell: 0, unk: 0, n: 0, o: t.price, h: t.price, l: t.price, c: t.price };
    if (t.side === "buy") b.buy += t.size;
    else if (t.side === "sell") b.sell += t.size;
    else b.unk += t.size;
    b.n++;
    b.h = Math.max(b.h, t.price);
    b.l = Math.min(b.l, t.price);
    b.c = t.price;
    bars.set(start, b);
  }
  return { cells, bars };
}

describe("aggregation against brute force", () => {
  for (const fractional of [false, true]) {
    it(`levels, volumes, delta and OHLC are exact sums (${fractional ? "fractional" : "integer"} sizes)`, () => {
      const trades = randomTrades(20_000, 7, undefined, 0.05, fractional);
      const f = mk();
      f.addMany(trades);
      const { cells, bars } = brute(trades, 0.05, 60_000);
      const b = f.bars;
      expect(b.length).toBe(bars.size);
      let checkedCells = 0;
      for (let i = 0; i < b.length; i++) {
        const want = bars.get(b.start[i]!)!;
        // Same additions in the same order, so equality is exact, not approximate.
        expect(b.buy[i]).toBe(want.buy);
        expect(b.sell[i]).toBe(want.sell);
        expect(b.unknown[i]).toBe(want.unk);
        expect(b.trades[i]).toBe(want.n);
        expect([b.open[i], b.high[i], b.low[i], b.close[i]]).toEqual([want.o, want.h, want.l, want.c]);
        expect(b.delta(i)).toBe(want.buy - want.sell);
        b.grids[i]!.each((k, bu, se, un, n) => {
          const w = cells.get(`${b.start[i]}|${k}`)!;
          expect([bu, se, un, n]).toEqual(w);
          checkedCells++;
        });
      }
      expect(checkedCells).toBe(cells.size);
    });
  }

  it("incremental (one trade at a time) equals batch equals chunked", () => {
    const trades = randomTrades(5000, 11);
    const one = mk(), all = mk(), chunked = mk();
    for (const t of trades) one.add(t);
    all.addMany(trades);
    for (let i = 0; i < trades.length; ) {
      const n = 1 + ((i * 31) % 97);
      chunked.addMany(trades.slice(i, i + n));
      i += n;
    }
    for (const other of [all, chunked]) {
      expect(other.bars.length).toBe(one.bars.length);
      for (const col of ["start", "open", "high", "low", "close", "buy", "sell", "unknown", "trades", "cvdOpen", "cvdHigh", "cvdLow"] as const) {
        expect(Array.from(other.bars[col].subarray(0, one.bars.length))).toEqual(Array.from(one.bars[col].subarray(0, one.bars.length)));
      }
      for (let i = 0; i < one.bars.length; i++) {
        const a: number[][] = [], b: number[][] = [];
        one.bars.grids[i]!.each((k, ...v) => a.push([k, ...v]));
        other.bars.grids[i]!.each((k, ...v) => b.push([k, ...v]));
        expect(b).toEqual(a);
      }
    }
  });

  it("the trade store keeps every trade in order", () => {
    const trades = randomTrades(3000, 3);
    const f = mk();
    f.addMany(trades);
    const st = f.store!;
    expect(st.length).toBe(trades.length);
    trades.forEach((t, i) => {
      expect([st.time(i), st.price(i), st.size(i), st.side(i)]).toEqual([t.time, t.price, t.size, t.side === "buy" ? 1 : t.side === "sell" ? -1 : 0]);
    });
    expect(st.lowerBound(trades[100]!.time)).toBeLessThanOrEqual(100);
  });
});

describe("bad input fails loudly", () => {
  it("rejects an out-of-order trade with its position, and applies nothing", () => {
    const f = mk();
    f.addMany([{ time: 1000, price: 100, size: 1, side: "buy" }]);
    expect(() => f.addMany([{ time: 2000, price: 100, size: 1, side: "buy" }, { time: 1500, price: 100, size: 1, side: "buy" }])).toThrow(/trade 1 at 1500 is older than the previous trade \(2000\)/);
    expect(f.bars.trades[0]).toBe(1);
    expect(() => f.add({ time: 999, price: 100, size: 1, side: "buy" })).toThrow(/older/);
    expect(f.store!.length).toBe(1);
  });
  it("the raw store rejects out-of-order times directly", () => {
    const s = new TradeStore(2);
    s.push(5, 1, 1, 1);
    s.push(5, 1, 1, 1);
    expect(() => s.push(4, 1, 1, 1)).toThrow(/older than the last stored trade/);
  });
  it("rejects bad price, size, side, time and an off-grid price", () => {
    const f = mk();
    const base: Trade = { time: 1, price: 100, size: 1, side: "buy" };
    expect(() => f.add({ ...base, price: -1 })).toThrow(/price/);
    expect(() => f.add({ ...base, price: Number.NaN })).toThrow(/price/);
    expect(() => f.add({ ...base, size: 0 })).toThrow(/size/);
    expect(() => f.add({ ...base, side: "up" as never })).toThrow(/side/);
    expect(() => f.add({ ...base, time: Number.NaN })).toThrow(/time/);
    expect(() => f.add({ ...base, price: 100.03 })).toThrow(/not a multiple of tickSize 0.05/);
    expect(f.bars.length).toBe(0);
  });
  it("rejects a bad tick size and a missing clock", () => {
    expect(() => mk({ tickSize: 0 })).toThrow(/tickSize/);
    expect(() => new OrderFlow({ tickSize: 1 })).toThrow(/periodMs or a clock/);
  });
});

describe("unknown-side volume", () => {
  it("is never given a side: delta excludes it and it has its own total", () => {
    const f = new OrderFlow({ tickSize: 1, periodMs: 60_000 });
    f.addMany([
      { time: 0, price: 10, size: 7, side: "buy" },
      { time: 1, price: 10, size: 3, side: "sell" },
      { time: 2, price: 10, size: 100, side: "unknown" },
      { time: 3, price: 11, size: 5, side: "unknown" },
    ]);
    const b = f.bars;
    expect([b.buy[0], b.sell[0], b.unknown[0]]).toEqual([7, 3, 105]);
    expect(b.delta(0)).toBe(4);
    expect(b.volume(0)).toBe(115);
    expect(b.grids[0]!.get(10, 2)).toBe(100);
    expect(b.grids[0]!.get(11, 2)).toBe(5);
    expect(b.grids[0]!.get(11, 0) + b.grids[0]!.get(11, 1)).toBe(0);
    // Running delta: +7 after the buy (high), +4 after the sell; unknown trades do not move it.
    expect([b.cvdHigh[0], b.cvdLow[0], b.cvdClose(0)]).toEqual([7, 0, 4]);
  });
});

describe("approximation flag", () => {
  const rows = [
    { time: 0, open: 10, high: 12, low: 10, close: 11, volume: 30 },
    { time: 60_000, open: 11, high: 11, low: 11, close: 11, volume: 5 },
  ];
  it("is set exactly when no trades were used", () => {
    expect(mk().approximate).toBe(false);
    const t = mk();
    t.addMany(randomTrades(100, 1));
    expect(t.approximate).toBe(false);
    const a = OrderFlow.fromBars(rows, { tickSize: 1, periodMs: 60_000 });
    expect(a.approximate).toBe(true);
    expect(a.bars.approximate).toBe(true);
  });
  it("spreads volume evenly over the bar's range as unknown-side volume, and refuses trades", () => {
    const a = OrderFlow.fromBars(rows, { tickSize: 1, periodMs: 60_000 });
    const g = a.bars.grids[0]!;
    expect([g.get(10, 2), g.get(11, 2), g.get(12, 2)]).toEqual([10, 10, 10]);
    expect(a.bars.buy[0]).toBe(0);
    expect(a.bars.unknown[0]).toBe(30);
    expect(a.bars.grids[1]!.get(11, 2)).toBe(5);
    expect(a.store).toBeNull();
    expect(() => a.add({ time: 120_000, price: 11, size: 1, side: "buy" })).toThrow(/approximate/);
  });
  it("rejects malformed bars", () => {
    expect(() => OrderFlow.fromBars([{ ...rows[0]!, volume: -1 }], { tickSize: 1, periodMs: 60_000 })).toThrow(/volume/);
    expect(() => OrderFlow.fromBars([{ ...rows[0]!, high: 9 }], { tickSize: 1, periodMs: 60_000 })).toThrow(/high >= low/);
    expect(() => OrderFlow.fromBars([rows[1]!, rows[0]!], { tickSize: 1, periodMs: 60_000 })).toThrow(/not after the previous/);
  });
});

describe("barsClock: bars that start where the feed's bars start", () => {
  // NSE 30-minute bars open at 09:15 IST = 03:45 UTC: not on the UTC half hour.
  const open = Date.UTC(2026, 9, 19, 3, 45);
  const M = 60_000;
  const times = [0, 1, 2, 3].map((k) => open + k * 30 * M);
  const clock = barsClock({ length: times.length, timeAt: (i) => times[i]! }, 30 * M);

  it("puts a trade into the feed's bar, not into a UTC-aligned one", () => {
    expect(clock.barStart(open + 5 * M)).toBe(open); // 09:20 IST → the 09:15 bar
    expect(clock.barStart(open + 31 * M)).toBe(open + 30 * M);
    expect(fixedClock(30 * M).barStart(open + 5 * M)).not.toBe(open); // what a UTC-anchored clock did
  });

  it("extends past the last bar by the period, for a bar the feed has not sent yet", () => {
    expect(clock.barStart(open + 95 * M)).toBe(open + 90 * M);
  });

  it("refuses a trade before the first bar or in a gap between bars", () => {
    expect(() => clock.barStart(open - M)).toThrow(/before the first bar/);
    const gapped = barsClock({ length: 2, timeAt: (i) => [open, open + 24 * 60 * M][i]! }, 30 * M);
    expect(() => gapped.barStart(open + 40 * M)).toThrow(/between bars/);
    expect(gapped.barStart(open + 24 * 60 * M + 31 * M)).toBe(open + 24 * 60 * M + 30 * M);
  });

  it("drives an OrderFlow: bars land on the feed's starts", () => {
    const f = new OrderFlow({ tickSize: 0.05, clock });
    f.addMany([{ time: open + 5 * M, price: 100, size: 1, side: "buy" }, { time: open + 35 * M, price: 100.05, size: 2, side: "sell" }]);
    expect([...f.bars.start.subarray(0, f.bars.length)]).toEqual([open, open + 30 * M]);
  });
});
