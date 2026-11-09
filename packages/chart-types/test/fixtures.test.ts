// Every transform against hand-computed fixtures. The arithmetic is in the
// comments; an expected row is [time, open, high, low, close, fromTime, toTime].

import type { OhlcBar, Trade } from "@alphacharts/core";
import { describe, expect, it } from "vitest";
import { HeikinAshi, Kagi, LineBreak, PointFigure, RangeBars, Renko, TradeBars, ordinalTime } from "../src/index.js";
import { rows } from "./helpers.js";

const D = (k: number) => ordinalTime(k);
const bar = (time: number, open: number, high: number, low: number, close: number): OhlcBar => ({ time, open, high, low, close });
const trade = (time: number, price: number, size = 1): Trade => ({ time, price, size, side: "unknown" });
const tradesAt = (pts: [number, number][]): Trade[] => pts.map(([price, time]) => trade(time, price));

describe("Heikin-Ashi", () => {
  it("matches the hand-computed values and keeps true time", () => {
    const ha = new HeikinAshi();
    ha.pushAll([bar(1000, 10, 12, 9, 11), bar(2000, 11, 14, 10, 13), bar(3000, 13, 13, 8, 9)]);
    expect(rows(ha.store)).toEqual([
      // b0: close (10+12+9+11)/4 = 42/4 = 10.5; open (10+11)/2 = 10.5; high max(12,10.5,10.5) = 12; low min(9,..) = 9
      [1000, 10.5, 12, 9, 10.5, 1000, 1000],
      // b1: close 48/4 = 12; open (10.5+10.5)/2 = 10.5; high max(14,10.5,12) = 14; low min(10,10.5,12) = 10
      [2000, 10.5, 14, 10, 12, 2000, 2000],
      // b2: close 43/4 = 10.75; open (10.5+12)/2 = 11.25; high max(13,11.25,10.75) = 13; low min(8,..) = 8
      [3000, 11.25, 13, 8, 10.75, 3000, 3000],
    ]);
  });

  it("replaces the forming bar and reports only that index as changed", () => {
    const ha = new HeikinAshi();
    ha.pushAll([bar(1000, 10, 12, 9, 11), bar(2000, 11, 14, 10, 13), bar(3000, 13, 13, 8, 9)]);
    // Same time, new low and close: close (13+13+7+8)/4 = 41/4 = 10.25, open stays 11.25, low 7.
    expect(ha.push(bar(3000, 13, 13, 7, 8))).toBe(2);
    expect(rows(ha.store)[2]).toEqual([3000, 11.25, 13, 7, 10.25, 3000, 3000]);
    expect(ha.store.length).toBe(3);
    // A later bar appends: open (11.25+10.25)/2 = 10.75.
    expect(ha.push(bar(4000, 8, 9, 8, 9))).toBe(3);
    expect(ha.store.open[3]).toBe(10.75);
  });

  it("refuses an earlier time and a malformed bar with the row number", () => {
    const ha = new HeikinAshi();
    ha.push(bar(2000, 10, 11, 9, 10));
    expect(() => ha.push(bar(1000, 10, 11, 9, 10))).toThrow(/row 1.*not after/);
    expect(() => ha.push(bar(3000, 10, 9, 9, 10))).toThrow(/row 1.*low <= open, close <= high/);
    expect(() => ha.push(bar(3000, 10, 11, 9, Number.NaN))).toThrow(/row 1.*finite/);
    expect(ha.store.length).toBe(1);
  });
});

describe("Renko", () => {
  it("fixed box 2: continuation, a multi-box jump and the two-box reversal", () => {
    const rk = new Renko({ box: 2 });
    // anchor 100: levels 100 + 2k.
    rk.pushTrades(tradesAt([[100, 10], [101, 20], [102, 30], [107, 40], [103, 50], [102, 60], [99.5, 70]]));
    expect(rows(rk.store)).toEqual([
      // 102 >= level(1) = 102: up [100, 102]; opened at the first observation (10), done at 30.
      [D(0), 100, 102, 100, 102, 10, 30],
      // 107 >= level(2) = 104: up [102, 104]; then >= level(3) = 106: up [104, 106]; 107 < 108.
      [D(1), 102, 104, 102, 104, 30, 40],
      [D(2), 104, 106, 104, 106, 40, 40],
      // 103 changes nothing (> level(kLo - 1) = 102). 102 <= 102: down [104, 102] (kLo = 2 -> 1).
      [D(3), 104, 104, 102, 102, 40, 60],
      // 99.5 <= level(kLo - 1) = level(0) = 100: down [102, 100].
      [D(4), 102, 102, 100, 100, 60, 70],
    ]);
  });

  it("ATR box: mean true range of bars 1..n, then the buffered bars are replayed", () => {
    const rk = new Renko({ atrPeriod: 2 });
    expect(rk.pushBar(bar(1, 10, 11, 9, 10))).toBe(0);
    expect(rk.boxSize).toBeUndefined();
    rk.pushBar(bar(2, 10, 12, 9, 11));
    expect(rk.store.length).toBe(0);
    rk.pushBar(bar(3, 11, 13, 11, 12));
    // TR1 = max(12-9 = 3, |12-10| = 2, |9-10| = 1) = 3; TR2 = max(13-11 = 2, |13-11| = 2, |11-11| = 0) = 2; ATR = (3+2)/2 = 2.5.
    expect(rk.boxSize).toBe(2.5);
    // Anchor = first price 10; levels 10 + 2.5k = 12.5. Bar 0 path 10,9,11,10; bar 1 10,9,12,11: no brick.
    // Bar 2 path (close >= open) 11,11,13,12: 13 >= 12.5 -> up [10, 12.5], opened at time 1, done at 3.
    expect(rows(rk.store)).toEqual([[D(0), 10, 12.5, 10, 12.5, 1, 3]]);
  });

  it("refuses trades in ATR mode, a zero ATR and bad options", () => {
    expect(() => new Renko({ atrPeriod: 2 }).pushTrade(trade(1, 10))).toThrow(/ATR box needs bars/);
    expect(() => new Renko({ box: 0 })).toThrow(/box must be/);
    expect(() => new Renko({ atrPeriod: 1.5 })).toThrow(/atrPeriod/);
  });
});

describe("Renko, flat warm-up and decimal levels", () => {
  it("flat bars do not wedge the ATR box: the window slides until prices move", () => {
    const rk = new Renko({ atrPeriod: 2 });
    for (let t = 1; t <= 3; t++) rk.pushBar(bar(t, 10, 10, 10, 10));
    expect(rk.boxSize).toBeUndefined();
    // After bar 3 the flat window is dropped to bars 2..3; bar 4 completes bars 2..4:
    // TR(bar 3) = 0, TR(bar 4) = max(13-10 = 3, |13-10| = 3, |10-10| = 0) = 3, ATR = (0+3)/2 = 1.5.
    rk.pushBar(bar(4, 10, 13, 10, 13));
    expect(rk.boxSize).toBe(1.5);
  });
  it("a price exactly one box up counts even when the sum is inexact (1.1 + 0.1)", () => {
    const rk = new Renko({ box: 0.1 });
    rk.pushTrades(tradesAt([[1.1, 1], [1.2, 2]]));
    expect(rk.store.length).toBe(1);
    const rb = new RangeBars(0.1);
    rb.pushTrades(tradesAt([[1.1, 1], [1.2, 2]]));
    expect(rb.store.length).toBe(2);
    const k = new Kagi({ amount: 0.1 });
    k.pushTrades(tradesAt([[1.1, 1], [1.2, 2]]));
    expect(k.store.length).toBe(1);
  });
});

describe("Range bars", () => {
  it("range 2: closes on the boundary, opens the next bar there, and forms the last", () => {
    const rb = new RangeBars(2);
    rb.pushTrades(tradesAt([[100, 10], [101, 20], [103, 30], [103, 40], [100.5, 50], [98, 60]]));
    expect(rows(rb.store)).toEqual([
      // 103 - low 100 = 3 >= 2: closes up at low + 2 = 102.
      [D(0), 100, 102, 100, 102, 10, 30],
      // bar 1 opens at 102; 103 and 103 stay inside (1 < 2); 100.5: high 103 - 100.5 = 2.5 >= 2 -> closes down at 103 - 2 = 101.
      [D(1), 102, 103, 101, 101, 30, 50],
      // bar 2 opens at 101, 100.5 inside; 98: high 101 - 98 = 3 >= 2 -> closes down at 101 - 2 = 99.
      [D(2), 101, 101, 99, 99, 50, 60],
      // bar 3 opens at 99, 98: 99 - 98 = 1 < 2 -> forming.
      [D(3), 99, 99, 98, 98, 60, 60],
    ]);
  });

  it("one price many ranges away makes several bars", () => {
    const rb = new RangeBars(1);
    rb.pushTrades(tradesAt([[10, 1], [13.5, 2]]));
    // closes at 11, 12, 13; the fourth bar forms 13 -> 13.5.
    expect(rb.store.close.subarray(0, 4)).toEqual(Float64Array.of(11, 12, 13, 13.5));
    expect(rb.store.length).toBe(4);
  });

  it("a bar's four points follow open, low, high, close for an up bar", () => {
    const rb = new RangeBars(100);
    rb.pushBar(bar(1, 10, 12, 8, 11));
    expect(rows(rb.store)).toEqual([[D(0), 10, 12, 8, 11, 1, 1]]);
    rb.pushBar(bar(2, 11, 11, 9, 9.5));
    // down bar path: 11, 11, 9, 9.5 -> high stays 12, low 8, close 9.5.
    expect(rows(rb.store)).toEqual([[D(0), 10, 12, 8, 9.5, 1, 2]]);
  });
});

describe("Line Break (3 lines)", () => {
  it("draws lines on breaks only", () => {
    const lb = new LineBreak(3);
    const closes = [10, 10, 11, 12, 11.5, 13, 9, 12.5, 14];
    lb.pushBars(closes.map((c, i) => bar(i + 1, c, c, c, c)));
    expect(rows(lb.store)).toEqual([
      // 10 is the anchor (time 1); the repeat is ignored; 11 draws line 0 [10, 11].
      [D(0), 10, 11, 10, 11, 1, 3],
      // 12 > high 11: continue [11, 12].
      [D(1), 11, 12, 11, 12, 3, 4],
      // 11.5: not > 12, and not < min low of the last 3 lines (10): nothing. 13 > 12: [12, 13].
      [D(2), 12, 13, 12, 13, 4, 6],
      // 9 < min(10, 11, 12) = 10: reversal, opening at the last line's OPEN (12): [12, 9].
      [D(3), 12, 12, 9, 9, 4, 7],
      // 12.5: not < 9 and not > max high of the last 3 lines (12, 13, 12) = 13: nothing. 14 > 13: reversal from the down line's open (12): [12, 14].
      [D(4), 12, 14, 12, 14, 4, 9],
    ]);
  });

  it("uses only the last n lines for a reversal", () => {
    const lb = new LineBreak(1);
    lb.pushBars([10, 11, 12, 11.5].map((c, i) => bar(i + 1, c, c, c, c)));
    // n = 1: after the up line [11, 12], 11.5 < that line's low (11)? no. Then 10.9 < 11: reversal from the line's open.
    expect(lb.store.length).toBe(2);
    lb.pushBar(bar(5, 10.9, 10.9, 10.9, 10.9));
    expect(rows(lb.store)[2]).toEqual([D(2), 11, 11, 10.9, 10.9, 2, 5]);
  });

  it("rejects trades", () => {
    expect(() => new LineBreak().pushTrade(trade(1, 10))).toThrow(/needs bars/);
  });
});

describe("Kagi", () => {
  it("amount 2: lines, reversals and the thick parts", () => {
    const k = new Kagi({ amount: 2 });
    k.pushTrades(tradesAt([[100, 1], [101, 2], [103, 3], [105, 4], [104, 5], [102.5, 6], [100, 7], [103, 8], [106, 9], [103.9, 10], [99, 11]]));
    expect(rows(k.store)).toEqual([
      // 101: 1 < 2. 103: 3 >= 2 fixes "up", line 0 from 100. 105 extends. 104: 105 - 104 = 1 < 2.
      [D(0), 100, 105, 100, 105, 1, 4],
      // 102.5: 105 - 102.5 = 2.5 >= 2: down line from 105 (reached at time 4); 100 extends it.
      [D(1), 105, 105, 100, 100, 4, 7],
      // 103: 103 - 100 = 3 >= 2: up line from 100 (time 7); 106 extends.
      [D(2), 100, 106, 100, 106, 7, 9],
      // 103.9: 106 - 103.9 = 2.1 >= 2: down line from 106; 99 extends it.
      [D(3), 106, 106, 99, 99, 9, 11],
    ]);
    // Line 2 is up and ends at 106 > 105 (the end of the up line before it, line 0): thick from 105 to 106.
    // Line 3 is down and starts thick; it ends at 99 < 100 (the end of the down line before it, line 1):
    // thick only from 106 down to 100.
    expect(rows(k.thick)).toEqual([
      [D(2), 105, 106, 105, 106, 7, 9],
      [D(3), 106, 106, 100, 100, 9, 11],
    ]);
  });

  it("percent reversal is a share of the extreme", () => {
    const k = new Kagi({ percent: 2 });
    k.pushTrades(tradesAt([[100, 1], [102, 2], [105, 3], [103, 4], [102.8, 5]]));
    // 2% of the start 100 = 2: 102 fixes up. Extreme 105: 2% = 2.1. 103: 2.0 < 2.1, no line; 102.8: 2.2 >= 2.1.
    expect(rows(k.store)).toEqual([
      [D(0), 100, 105, 100, 105, 1, 3],
      [D(1), 105, 105, 102.8, 102.8, 3, 5],
    ]);
  });

  it("nothing is drawn before the first reversal-sized move", () => {
    const k = new Kagi({ amount: 5 });
    k.pushTrades(tradesAt([[100, 1], [104, 2], [96, 3]]));
    expect(k.store.length).toBe(0);
  });
});

describe("Point & Figure", () => {
  it("box 1, reversal 3: X and O columns", () => {
    const pf = new PointFigure(1, 3);
    pf.pushTrades(tradesAt([[10.2, 1], [10.9, 2], [12.5, 3], [15.1, 4], [13.2, 5], [12.9, 6], [10.0, 7], [12.99, 8], [13.0, 9]]));
    expect(rows(pf.store)).toEqual([
      // start box 10. 12.5 is box 12: X column boxes 10..12 -> edges 10..13; 15.1 (box 15) extends to edge 16.
      [D(0), 10, 16, 10, 16, 1, 4],
      // 13.2 is box 13 > 15 - 3 = 12: nothing. 12.9 is box 12 <= 12: O column from box 14 down to 12; 10.0 (box 10) extends it.
      [D(1), 15, 15, 10, 10, 4, 7],
      // 12.99 is box 12 < 10 + 3: nothing. 13.0 is box 13 >= 13: X column from box 11 up to 13 -> edges 11..14.
      [D(2), 11, 14, 11, 14, 7, 9],
    ]);
  });

  it("a first move down starts an O column from the start box", () => {
    const pf = new PointFigure(1, 3);
    pf.pushTrades(tradesAt([[10.5, 1], [8.2, 2]]));
    // start box 10, price in box 8: boxes 8..10 -> edges 8..11, open at the top.
    expect(rows(pf.store)).toEqual([[D(0), 11, 11, 8, 8, 1, 2]]);
  });

  it("the box tolerance keeps 100.3 / 0.1 in box 1003", () => {
    const pf = new PointFigure(0.1, 1);
    pf.pushTrades(tradesAt([[100.2, 1], [100.3, 2]]));
    // box(100.2) = 1002, box(100.3) = 1003: X column 100.2 .. 100.4.
    expect(pf.store.low[0]).toBeCloseTo(100.2, 10);
    expect(pf.store.high[0]).toBeCloseTo(100.4, 10);
  });
});

describe("Tick, volume and dollar bars", () => {
  it("tick bars: N trades per bar, the last forming", () => {
    const tb = new TradeBars("tick", 3);
    tb.pushAll([trade(1, 10, 5), trade(2, 12, 1), trade(3, 9, 2), trade(4, 11, 4), trade(5, 13, 1)]);
    expect(rows(tb.store)).toEqual([
      [D(0), 10, 12, 9, 9, 1, 3, 8],
      [D(1), 11, 13, 11, 13, 4, 5, 5],
    ]);
  });

  it("volume bars: exact volume, a trade splits across bars", () => {
    const vb = new TradeBars("volume", 10);
    vb.pushAll([trade(1, 100, 4), trade(2, 101, 8), trade(3, 99, 25)]);
    expect(rows(vb.store)).toEqual([
      // 4 + 6 of the 8 at 101 = 10.
      [D(0), 100, 101, 100, 101, 1, 2, 10],
      // the other 2 at 101, then 8 of the 25 at 99.
      [D(1), 101, 101, 99, 99, 2, 3, 10],
      // 10 of the remaining 17, then 7 forming.
      [D(2), 99, 99, 99, 99, 3, 3, 10],
      [D(3), 99, 99, 99, 99, 3, 3, 7],
    ]);
  });

  it("dollar bars: exact notional, the split share is notional / price", () => {
    const db = new TradeBars("dollar", 1000);
    db.pushAll([trade(1, 10, 50), trade(2, 20, 40), trade(3, 25, 100)]);
    expect(rows(db.store)).toEqual([
      // 50 x 10 = 500; 40 x 20 = 800 but 500 fits: 500 / 20 = 25 units -> volume 75.
      [D(0), 10, 20, 10, 20, 1, 2, 75],
      // left 15 x 20 = 300; 25 x 100 = 2500 but 700 fits: 700 / 25 = 28 units -> 43.
      [D(1), 20, 25, 20, 25, 2, 3, 43],
      // 72 left: 1000 / 25 = 40 units for a full bar.
      [D(2), 25, 25, 25, 25, 3, 3, 40],
      // 32 left x 25 = 800 forming.
      [D(3), 25, 25, 25, 25, 3, 3, 32],
    ]);
  });

  it("refuses bad trades and sizes with the row number", () => {
    const tb = new TradeBars("tick", 2);
    tb.push(trade(5, 10));
    expect(() => tb.push(trade(4, 10))).toThrow(/row 1.*before the previous/);
    expect(() => tb.push(trade(6, 0))).toThrow(/row 1.*price/);
    expect(() => tb.push(trade(6, 10, -1))).toThrow(/row 1.*size/);
    expect(() => new TradeBars("tick", 2.5)).toThrow(/whole number/);
    expect(() => new TradeBars("volume", 0)).toThrow(/size must be/);
  });
});

describe("barSource: close reads only closes", () => {
  // box 10, anchor at the first close 100. Closes 100, 105, 112, 108, 91: a close-only Renko makes an up brick 100-110 at the third close
  // and the close 91 is above 90 (one box below the last brick's start 100), so there is no reversal. The brick opened at time 1 (the anchor), closed at time 3.
  const bars = [bar(1, 100, 100, 100, 100), bar(2, 100, 120, 80, 105), bar(3, 105, 115, 99, 112), bar(4, 112, 113, 107, 108), bar(5, 108, 109, 85, 91)];
  it("the OHLC path sees the wicks (80 and 120) and builds bricks the closes never reach; the close path does not", () => {
    const ohlc = new Renko({ box: 10 });
    ohlc.pushBars(bars);
    const close = new Renko({ box: 10 });
    close.barSource = "close";
    close.pushBars(bars);
    // closes only: 100 anchor; 112 reaches 110 -> one up brick [100, 110]; 108 and 91 stay inside (a reversal needs 90)
    expect(rows(close.store)).toEqual([[D(0), 100, 110, 100, 110, 1, 3]]);
    expect(close.store.length).toBe(1);
    expect(ohlc.store.length).toBeGreaterThan(close.store.length);
  });
  it("a close-only Kagi and Point and Figure take only the closes too", () => {
    const k = new Kagi({ amount: 5 });
    k.barSource = "close";
    k.pushBars(bars);
    const k2 = new Kagi({ amount: 5 });
    k2.pushBars(bars);
    expect(k.store.length).toBeLessThanOrEqual(k2.store.length);
    const pf = new PointFigure(5, 3);
    pf.barSource = "close";
    pf.pushBars(bars);
    expect(pf.store.length).toBeGreaterThan(0);
  });
});
