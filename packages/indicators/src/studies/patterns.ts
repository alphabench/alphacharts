// Candlestick patterns: the 61 TA-Lib CDL* functions, reproduced bar for bar.
//
// TA-Lib judges a candle against "settings": a range type (real body, high-low or both shadows), an
// averaging period and a factor. A candle at offset k from the bar being judged is compared with
// factor * (sum of that range over the `period` bars before it) / period. The sum is kept the way TA-Lib
// keeps it (seeded once at the pattern's first bar, then moved a bar at a time) so float rounding agrees,
// which matters on the exact-tie comparisons prices rounded to cents produce. A setting with period 0
// (ShadowLong, ShadowVeryLong) compares with the candle's own range instead.
//
// Output: +100 bullish, -100 bearish (+-80 where TA-Lib weakens a signal), 0 no pattern, NaN inside the lookback.

import { COLORS, defineStudy, float, markers } from "../define.js";
import type { Graph, Node } from "../engine/graph.js";
import type { InputDef, Params, StudyDef } from "../types.js";

const RB = 0, HL = 1, SH = 2;
interface Setting { readonly rt: number; readonly p: number; readonly f: number }
const BL: Setting = { rt: RB, p: 10, f: 1 }; // body long
const BS: Setting = { rt: RB, p: 10, f: 1 }; // body short
const BD: Setting = { rt: HL, p: 10, f: 0.1 }; // body doji
const SL: Setting = { rt: RB, p: 0, f: 1 }; // shadow long
const SVL: Setting = { rt: RB, p: 0, f: 2 }; // shadow very long
const SS: Setting = { rt: SH, p: 10, f: 1 }; // shadow short
const SVS: Setting = { rt: HL, p: 10, f: 0.1 }; // shadow very short
const NEAR: Setting = { rt: HL, p: 5, f: 0.2 };
const FAR: Setting = { rt: HL, p: 5, f: 0.6 };
const EQ: Setting = { rt: HL, p: 5, f: 0.05 };

/** A running total to read at each bar: the setting's range summed over the window that ends k+1 bars back, seeded at bar `from`. */
type Slot = readonly [Setting, number];

// The bars being evaluated. Bound at the start of every node run (the graph replaces its buffers when it grows).
let O: Float64Array, H: Float64Array, Lw: Float64Array, C: Float64Array;
function bind(g: Graph): void {
  O = g.open.v; H = g.high.v; Lw = g.low.v; C = g.close.v;
}
const op = (i: number): number => O[i]!;
const hi = (i: number): number => H[i]!;
const lo = (i: number): number => Lw[i]!;
const cl = (i: number): number => C[i]!;
const col = (i: number): number => (C[i]! >= O[i]! ? 1 : -1);
const rb = (i: number): number => Math.abs(C[i]! - O[i]!);
const us = (i: number): number => H[i]! - (C[i]! >= O[i]! ? C[i]! : O[i]!);
const ls = (i: number): number => (C[i]! >= O[i]! ? O[i]! : C[i]!) - Lw[i]!;

function range(s: Setting, i: number): number {
  return s.rt === RB ? rb(i) : s.rt === HL ? H[i]! - Lw[i]! : us(i) + ls(i);
}

/** TA_CANDLEAVERAGE: the setting's threshold for candle `i`, given the running total of its window. */
function avg(s: Setting, total: number, i: number): number {
  return (s.f * (s.p !== 0 ? total / s.p : range(s, i))) / (s.rt === SH ? 2 : 1);
}

/** a * b + c rounded once (TA-Lib calls C fma in a few penetration tests; JS has none). */
function fma(a: number, b: number, c: number): number {
  const p = a * b;
  const ca = 134217729 * a, ah = ca - (ca - a), al = a - ah;
  const cb = 134217729 * b, bh = cb - (cb - b), bl = b - bh;
  const e = ah * bh - p + ah * bl + al * bh + al * bl;
  const s = p + c, v = s - p;
  return s + (p - (s - v) + (c - v) + e);
}

function tot(g: Graph, s: Setting, k: number, from: number): Node {
  if (s.p === 0) throw new RangeError("a setting without an averaging period has no running total");
  const P = s.p;
  return g.node((nd, a, b) => {
    bind(g);
    const v = nd.v;
    for (let i = a; i < b; i++) {
      if (i < from) { v[i] = Number.NaN; continue; }
      const end = i - k; // the window is [end - P, end - 1]
      if (i === from) {
        let t = 0;
        for (let j = end - P; j < end; j++) t += range(s, j);
        v[i] = t;
      } else v[i] = v[i - 1]! + (range(s, end - 1) - range(s, end - 1 - P));
    }
  });
}

function mkStudy(id: string, name: string, inputs: readonly InputDef[], build: (g: Graph, p: Params) => Node[]): StudyDef {
  return defineStudy({
    id: `cdl-${id.toLowerCase()}`, name, family: "pattern", needs: "ohlc", pane: "overlay", inputs, columns: ["signal"],
    plots: [markers("signal", "arrowUp", "sign", COLORS.neutral, { text: true })], build, reference: `TA-Lib CDL${id}`,
  });
}

type Eval = (i: number, T: Float64Array, pen: number) => number;

/** A stateless pattern: `fn` judges bar i from the bars before it and the running totals of its slots (in order). */
function cdl(id: string, name: string, lookback: number, slots: readonly Slot[], fn: Eval, pen?: { pen: number }): StudyDef {
  const inputs = pen ? [float("penetration", pen.pen, 0, 10, 0.05)] : [];
  return mkStudy(id, name, inputs, (g, p) => {
    const ts = slots.map(([s, k]) => tot(g, s, k, lookback));
    const T = new Float64Array(ts.length); // scratch, rewritten for every bar before it is read
    const penetration = pen ? (p.penetration as number) : 0;
    return [g.node((nd, a, b) => {
      bind(g);
      const v = nd.v;
      for (let i = a; i < b; i++) {
        if (i < lookback) { v[i] = Number.NaN; continue; }
        for (let s = 0; s < ts.length; s++) T[s] = ts[s]!.v[i]!;
        v[i] = fn(i, T, penetration);
      }
    })];
  });
}

// ---- 1. two to four candle reversal and continuation patterns -----------------------------------

export const cdl2Crows = cdl("2CROWS", "Two Crows", 12, [[BL, 2]], (i, T) =>
  col(i - 2) === 1 && rb(i - 2) > avg(BL, T[0]!, i - 2) &&
  col(i - 1) === -1 && Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2)) &&
  col(i) === -1 && op(i) < op(i - 1) && op(i) > cl(i - 1) && cl(i) > op(i - 2) && cl(i) < cl(i - 2)
    ? -100 : 0);

export const cdl3BlackCrows = cdl("3BLACKCROWS", "Three Black Crows", 13, [[SVS, 2], [SVS, 1], [SVS, 0]], (i, T) =>
  col(i - 3) === 1 && col(i - 2) === -1 && col(i - 1) === -1 && col(i) === -1 &&
  op(i - 1) < op(i - 2) && op(i - 1) > cl(i - 2) && op(i) < op(i - 1) && op(i) > cl(i - 1) &&
  hi(i - 3) > cl(i - 2) && cl(i - 2) > cl(i - 1) && cl(i - 1) > cl(i) &&
  ls(i - 2) < avg(SVS, T[0]!, i - 2) && ls(i - 1) < avg(SVS, T[1]!, i - 1) && ls(i) < avg(SVS, T[2]!, i)
    ? -100 : 0);

export const cdl3Inside = cdl("3INSIDE", "Three Inside Up/Down", 12, [[BL, 2], [BS, 1]], (i, T) =>
  Math.max(cl(i - 1), op(i - 1)) < Math.max(cl(i - 2), op(i - 2)) && Math.min(cl(i - 1), op(i - 1)) > Math.min(cl(i - 2), op(i - 2)) &&
  ((col(i - 2) === 1 && col(i) === -1 && cl(i) < op(i - 2)) || (col(i - 2) === -1 && col(i) === 1 && cl(i) > op(i - 2))) &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) <= avg(BS, T[1]!, i - 1)
    ? -col(i - 2) * 100 : 0);

export const cdl3LineStrike = cdl("3LINESTRIKE", "Three-Line Strike", 8, [[NEAR, 3], [NEAR, 2]], (i, T) =>
  col(i - 3) === col(i - 2) && col(i - 2) === col(i - 1) && col(i) === -col(i - 1) &&
  op(i - 2) >= Math.min(op(i - 3), cl(i - 3)) - avg(NEAR, T[0]!, i - 3) && op(i - 2) <= Math.max(op(i - 3), cl(i - 3)) + avg(NEAR, T[0]!, i - 3) &&
  op(i - 1) >= Math.min(op(i - 2), cl(i - 2)) - avg(NEAR, T[1]!, i - 2) && op(i - 1) <= Math.max(op(i - 2), cl(i - 2)) + avg(NEAR, T[1]!, i - 2) &&
  ((col(i - 1) === 1 && cl(i - 1) > cl(i - 2) && cl(i - 2) > cl(i - 3) && op(i) > cl(i - 1) && cl(i) < op(i - 3)) ||
   (col(i - 1) === -1 && cl(i - 1) < cl(i - 2) && cl(i - 2) < cl(i - 3) && op(i) < cl(i - 1) && cl(i) > op(i - 3)))
    ? col(i - 1) * 100 : 0);

export const cdl3Outside = cdl("3OUTSIDE", "Three Outside Up/Down", 3, [], (i) =>
  (col(i - 1) === 1 && col(i - 2) === -1 && cl(i - 1) > op(i - 2) && op(i - 1) < cl(i - 2) && cl(i) > cl(i - 1)) ||
  (col(i - 1) === -1 && col(i - 2) === 1 && op(i - 1) > cl(i - 2) && cl(i - 1) < op(i - 2) && cl(i) < cl(i - 1))
    ? col(i - 1) * 100 : 0);

export const cdl3StarsInSouth = cdl("3STARSINSOUTH", "Three Stars In The South", 12, [[BL, 2], [SVS, 1], [SVS, 0], [BS, 0]], (i, T) =>
  col(i - 2) === -1 && col(i - 1) === -1 && col(i) === -1 &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && ls(i - 2) > avg(SL, 0, i - 2) &&
  rb(i - 1) < rb(i - 2) && op(i - 1) > cl(i - 2) && op(i - 1) <= hi(i - 2) && lo(i - 1) < cl(i - 2) && lo(i - 1) >= lo(i - 2) &&
  ls(i - 1) > avg(SVS, T[1]!, i - 1) &&
  rb(i) < avg(BS, T[3]!, i) && ls(i) < avg(SVS, T[2]!, i) && us(i) < avg(SVS, T[2]!, i) &&
  lo(i) > lo(i - 1) && hi(i) < hi(i - 1)
    ? 100 : 0);

export const cdl3WhiteSoldiers = cdl("3WHITESOLDIERS", "Three Advancing White Soldiers", 12,
  [[SVS, 2], [SVS, 1], [SVS, 0], [NEAR, 2], [NEAR, 1], [FAR, 2], [FAR, 1], [BS, 0]], (i, T) =>
  col(i - 2) === 1 && us(i - 2) < avg(SVS, T[0]!, i - 2) &&
  col(i - 1) === 1 && us(i - 1) < avg(SVS, T[1]!, i - 1) &&
  col(i) === 1 && us(i) < avg(SVS, T[2]!, i) &&
  cl(i) > cl(i - 1) && cl(i - 1) > cl(i - 2) && op(i - 1) > op(i - 2) && op(i - 1) <= cl(i - 2) + avg(NEAR, T[3]!, i - 2) &&
  op(i) > op(i - 1) && op(i) <= cl(i - 1) + avg(NEAR, T[4]!, i - 1) &&
  rb(i - 1) > rb(i - 2) - avg(FAR, T[5]!, i - 2) && rb(i) > rb(i - 1) - avg(FAR, T[6]!, i - 1) &&
  rb(i) > avg(BS, T[7]!, i)
    ? 100 : 0);

export const cdlAbandonedBaby = cdl("ABANDONEDBABY", "Abandoned Baby", 12, [[BL, 2], [BD, 1], [BS, 0]], (i, T, pen) =>
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) <= avg(BD, T[1]!, i - 1) && rb(i) > avg(BS, T[2]!, i) &&
  ((col(i - 2) === 1 && col(i) === -1 && cl(i) < cl(i - 2) - rb(i - 2) * pen && lo(i - 1) > hi(i - 2) && hi(i) < lo(i - 1)) ||
   (col(i - 2) === -1 && col(i) === 1 && cl(i) > fma(rb(i - 2), pen, cl(i - 2)) && hi(i - 1) < lo(i - 2) && lo(i) > hi(i - 1)))
    ? col(i) * 100 : 0, { pen: 0.3 });

export const cdlAdvanceBlock = cdl("ADVANCEBLOCK", "Advance Block", 12,
  [[SS, 2], [SS, 1], [SS, 0], [NEAR, 2], [NEAR, 1], [FAR, 2], [FAR, 1], [BL, 2]], (i, T) =>
  col(i - 2) === 1 && col(i - 1) === 1 && col(i) === 1 &&
  cl(i) > cl(i - 1) && cl(i - 1) > cl(i - 2) && op(i - 1) > op(i - 2) && op(i - 1) <= cl(i - 2) + avg(NEAR, T[3]!, i - 2) &&
  op(i) > op(i - 1) && op(i) <= cl(i - 1) + avg(NEAR, T[4]!, i - 1) &&
  rb(i - 2) > avg(BL, T[7]!, i - 2) && us(i - 2) < avg(SS, T[0]!, i - 2) &&
  ((rb(i - 1) < rb(i - 2) - avg(FAR, T[5]!, i - 2) && rb(i) < rb(i - 1) + avg(NEAR, T[4]!, i - 1)) ||
   rb(i) < rb(i - 1) - avg(FAR, T[6]!, i - 1) ||
   (rb(i) < rb(i - 1) && rb(i - 1) < rb(i - 2) && (us(i) > avg(SS, T[2]!, i) || us(i - 1) > avg(SS, T[1]!, i - 1))) ||
   (rb(i) < rb(i - 1) && us(i) > avg(SL, 0, i)))
    ? -100 : 0);

export const cdlBeltHold = cdl("BELTHOLD", "Belt-hold", 10, [[BL, 0], [SVS, 0]], (i, T) =>
  rb(i) > avg(BL, T[0]!, i) &&
  ((col(i) === 1 && ls(i) < avg(SVS, T[1]!, i)) || (col(i) === -1 && us(i) < avg(SVS, T[1]!, i)))
    ? col(i) * 100 : 0);

export const cdlBreakaway = cdl("BREAKAWAY", "Breakaway", 14, [[BL, 4]], (i, T) =>
  col(i - 4) === col(i - 3) && col(i - 3) === col(i - 1) && col(i - 1) === -col(i) &&
  rb(i - 4) > avg(BL, T[0]!, i - 4) &&
  ((col(i - 4) === -1 && Math.max(op(i - 3), cl(i - 3)) < Math.min(op(i - 4), cl(i - 4)) &&
    hi(i - 2) < hi(i - 3) && lo(i - 2) < lo(i - 3) && hi(i - 1) < hi(i - 2) && lo(i - 1) < lo(i - 2) &&
    cl(i) > op(i - 3) && cl(i) < cl(i - 4)) ||
   (col(i - 4) === 1 && Math.min(op(i - 3), cl(i - 3)) > Math.max(op(i - 4), cl(i - 4)) &&
    hi(i - 2) > hi(i - 3) && lo(i - 2) > lo(i - 3) && hi(i - 1) > hi(i - 2) && lo(i - 1) > lo(i - 2) &&
    cl(i) < op(i - 3) && cl(i) > cl(i - 4)))
    ? col(i) * 100 : 0);

export const cdlClosingMarubozu = cdl("CLOSINGMARUBOZU", "Closing Marubozu", 10, [[BL, 0], [SVS, 0]], (i, T) =>
  rb(i) > avg(BL, T[0]!, i) &&
  ((col(i) === 1 && us(i) < avg(SVS, T[1]!, i)) || (col(i) === -1 && ls(i) < avg(SVS, T[1]!, i)))
    ? col(i) * 100 : 0);

export const cdlConcealBabySwall = cdl("CONCEALBABYSWALL", "Concealing Baby Swallow", 13, [[SVS, 3], [SVS, 2], [SVS, 1]], (i, T) =>
  col(i - 3) === -1 && col(i - 2) === -1 && col(i - 1) === -1 && col(i) === -1 &&
  ls(i - 3) < avg(SVS, T[0]!, i - 3) && us(i - 3) < avg(SVS, T[0]!, i - 3) &&
  ls(i - 2) < avg(SVS, T[1]!, i - 2) && us(i - 2) < avg(SVS, T[1]!, i - 2) &&
  Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2)) &&
  us(i - 1) > avg(SVS, T[2]!, i - 1) && hi(i - 1) > cl(i - 2) &&
  hi(i) > hi(i - 1) && lo(i) < lo(i - 1)
    ? 100 : 0);

export const cdlCounterAttack = cdl("COUNTERATTACK", "Counterattack", 11, [[EQ, 1], [BL, 1], [BL, 0]], (i, T) =>
  col(i - 1) === -col(i) &&
  rb(i - 1) > avg(BL, T[1]!, i - 1) && rb(i) > avg(BL, T[2]!, i) &&
  cl(i) <= cl(i - 1) + avg(EQ, T[0]!, i - 1) && cl(i) >= cl(i - 1) - avg(EQ, T[0]!, i - 1)
    ? col(i) * 100 : 0);

export const cdlDarkCloudCover = cdl("DARKCLOUDCOVER", "Dark Cloud Cover", 11, [[BL, 1]], (i, T, pen) =>
  col(i - 1) === 1 && rb(i - 1) > avg(BL, T[0]!, i - 1) &&
  col(i) === -1 && op(i) > hi(i - 1) && cl(i) > op(i - 1) && cl(i) < cl(i - 1) - rb(i - 1) * pen
    ? -100 : 0, { pen: 0.5 });

export const cdlDoji = cdl("DOJI", "Doji", 10, [[BD, 0]], (i, T) => rb(i) <= avg(BD, T[0]!, i) ? 100 : 0);

export const cdlDojiStar = cdl("DOJISTAR", "Doji Star", 11, [[BL, 1], [BD, 0]], (i, T) =>
  rb(i - 1) > avg(BL, T[0]!, i - 1) && rb(i) <= avg(BD, T[1]!, i) &&
  ((col(i - 1) === 1 && Math.min(op(i), cl(i)) > Math.max(op(i - 1), cl(i - 1))) ||
   (col(i - 1) === -1 && Math.max(op(i), cl(i)) < Math.min(op(i - 1), cl(i - 1))))
    ? -col(i - 1) * 100 : 0);

export const cdlDragonflyDoji = cdl("DRAGONFLYDOJI", "Dragonfly Doji", 10, [[BD, 0], [SVS, 0]], (i, T) =>
  rb(i) <= avg(BD, T[0]!, i) && us(i) < avg(SVS, T[1]!, i) && ls(i) > avg(SVS, T[1]!, i)
    ? 100 : 0);

export const cdlEngulfing = cdl("ENGULFING", "Engulfing Pattern", 2, [], (i) =>
  (col(i) === 1 && col(i - 1) === -1 && ((cl(i) >= op(i - 1) && op(i) < cl(i - 1)) || (cl(i) > op(i - 1) && op(i) <= cl(i - 1)))) ||
  (col(i) === -1 && col(i - 1) === 1 && ((op(i) >= cl(i - 1) && cl(i) < op(i - 1)) || (op(i) > cl(i - 1) && cl(i) <= op(i - 1))))
    ? (op(i) !== cl(i - 1) && cl(i) !== op(i - 1) ? col(i) * 100 : col(i) * 80) : 0);

export const cdlEveningDojiStar = cdl("EVENINGDOJISTAR", "Evening Doji Star", 12, [[BL, 2], [BD, 1], [BS, 0]], (i, T, pen) =>
  col(i - 2) === 1 && col(i) === -1 && Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2)) &&
  cl(i) < cl(i - 2) - rb(i - 2) * pen &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) <= avg(BD, T[1]!, i - 1) && rb(i) > avg(BS, T[2]!, i)
    ? -100 : 0, { pen: 0.3 });

export const cdlEveningStar = cdl("EVENINGSTAR", "Evening Star", 12, [[BL, 2], [BS, 1], [BS, 0]], (i, T, pen) =>
  col(i - 2) === 1 && col(i) === -1 && Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2)) &&
  cl(i) < cl(i - 2) - rb(i - 2) * pen &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) <= avg(BS, T[1]!, i - 1) && rb(i) > avg(BS, T[2]!, i)
    ? -100 : 0, { pen: 0.3 });

export const cdlGapSideSideWhite = cdl("GAPSIDESIDEWHITE", "Up/Down-gap side-by-side white lines", 7, [[NEAR, 1], [EQ, 1]], (i, T) => {
  const up = Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2));
  return ((up && Math.min(op(i), cl(i)) > Math.max(op(i - 2), cl(i - 2))) ||
    (Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2)) && Math.max(op(i), cl(i)) < Math.min(op(i - 2), cl(i - 2)))) &&
    col(i - 1) === 1 && col(i) === 1 &&
    rb(i) >= rb(i - 1) - avg(NEAR, T[0]!, i - 1) && rb(i) <= rb(i - 1) + avg(NEAR, T[0]!, i - 1) &&
    op(i) >= op(i - 1) - avg(EQ, T[1]!, i - 1) && op(i) <= op(i - 1) + avg(EQ, T[1]!, i - 1)
    ? (up ? 100 : -100) : 0;
});

export const cdlGravestoneDoji = cdl("GRAVESTONEDOJI", "Gravestone Doji", 10, [[BD, 0], [SVS, 0]], (i, T) =>
  rb(i) <= avg(BD, T[0]!, i) && ls(i) < avg(SVS, T[1]!, i) && us(i) > avg(SVS, T[1]!, i)
    ? 100 : 0);

export const cdlHammer = cdl("HAMMER", "Hammer", 11, [[BS, 0], [SVS, 0], [NEAR, 1]], (i, T) =>
  rb(i) < avg(BS, T[0]!, i) && ls(i) > avg(SL, 0, i) && us(i) < avg(SVS, T[1]!, i) &&
  Math.min(cl(i), op(i)) <= lo(i - 1) + avg(NEAR, T[2]!, i - 1)
    ? 100 : 0);

export const cdlHangingMan = cdl("HANGINGMAN", "Hanging Man", 11, [[BS, 0], [SVS, 0], [NEAR, 1]], (i, T) =>
  rb(i) < avg(BS, T[0]!, i) && ls(i) > avg(SL, 0, i) && us(i) < avg(SVS, T[1]!, i) &&
  Math.min(cl(i), op(i)) >= hi(i - 1) - avg(NEAR, T[2]!, i - 1)
    ? -100 : 0);

export const cdlHarami = cdl("HARAMI", "Harami Pattern", 11, [[BL, 1], [BS, 0]], (i, T) => {
  if (!(rb(i - 1) > avg(BL, T[0]!, i - 1) && rb(i) <= avg(BS, T[1]!, i))) return 0;
  const mx = Math.max(cl(i), op(i)), mn = Math.min(cl(i), op(i)), pmx = Math.max(cl(i - 1), op(i - 1)), pmn = Math.min(cl(i - 1), op(i - 1));
  return mx < pmx && mn > pmn ? -col(i - 1) * 100 : mx <= pmx && mn >= pmn ? -col(i - 1) * 80 : 0;
});

export const cdlHaramiCross = cdl("HARAMICROSS", "Harami Cross Pattern", 11, [[BL, 1], [BD, 0]], (i, T) => {
  if (!(rb(i - 1) > avg(BL, T[0]!, i - 1) && rb(i) <= avg(BD, T[1]!, i))) return 0;
  const mx = Math.max(cl(i), op(i)), mn = Math.min(cl(i), op(i)), pmx = Math.max(cl(i - 1), op(i - 1)), pmn = Math.min(cl(i - 1), op(i - 1));
  return mx < pmx && mn > pmn ? -col(i - 1) * 100 : mx <= pmx && mn >= pmn ? -col(i - 1) * 80 : 0;
});

export const cdlHighWave = cdl("HIGHWAVE", "High-Wave Candle", 10, [[BS, 0]], (i, T) =>
  rb(i) < avg(BS, T[0]!, i) && us(i) > avg(SVL, 0, i) && ls(i) > avg(SVL, 0, i)
    ? col(i) * 100 : 0);

// Hikkake: a state machine over the bars after an inside bar. The state (days left to confirm, result,
// saved high/low) lives in columns written from the previous bar's; TA-Lib starts it 3 bars before the first output.
function hikkake(id: string, name: string, mod: boolean) {
  const L = mod ? 10 : 5;
  const start = L - 3;
  return mkStudy(id, name, [], (g) => {
    const T = mod ? tot(g, NEAR, 2, start) : null;
    const cdC = g.col(), resC = g.col(), shC = g.col(), slC = g.col();
    const sig = g.node((nd, a, b) => {
      bind(g);
      const v = nd.v, cdv = cdC.v, rs = resC.v, sh = shC.v, sl = slC.v;
      for (let i = a; i < b; i++) {
        if (i < start) { v[i] = NaN; continue; }
        let cd = i > start ? cdv[i - 1]! : 0, res = i > start ? rs[i - 1]! : 0, sHi = i > start ? sh[i - 1]! : 0, sLo = i > start ? sl[i - 1]! : 0;
        let out = 0;
        const base = mod
          ? hi(i - 2) < hi(i - 3) && lo(i - 2) > lo(i - 3) && hi(i - 1) < hi(i - 2) && lo(i - 1) > lo(i - 2) &&
            ((hi(i) < hi(i - 1) && lo(i) < lo(i - 1) && cl(i - 2) <= lo(i - 2) + avg(NEAR, T!.v[i]!, i - 2)) ||
             (hi(i) > hi(i - 1) && lo(i) > lo(i - 1) && cl(i - 2) >= hi(i - 2) - avg(NEAR, T!.v[i]!, i - 2)))
          : hi(i - 1) < hi(i - 2) && lo(i - 1) > lo(i - 2) &&
            ((hi(i) < hi(i - 1) && lo(i) < lo(i - 1)) || (hi(i) > hi(i - 1) && lo(i) > lo(i - 1)));
        if (base) {
          res = 100 * (hi(i) < hi(i - 1) ? 1 : -1); sHi = hi(i - 1); sLo = lo(i - 1); cd = 4; out = res;
        } else if (cd > 0 && ((res > 0 && cl(i) > sHi) || (res < 0 && cl(i) < sLo))) {
          out = res + 100 * (res > 0 ? 1 : -1); cd = 0;
        }
        if (cd > 0) cd -= 1;
        cdv[i] = cd; rs[i] = res; sh[i] = sHi; sl[i] = sLo;
        v[i] = i >= L ? out : NaN;
      }
    });
    return [sig];
  });
}

export const cdlHikkake = hikkake("HIKKAKE", "Hikkake Pattern", false);
export const cdlHikkakeMod = hikkake("HIKKAKEMOD", "Modified Hikkake Pattern", true);

export const cdlHomingPigeon = cdl("HOMINGPIGEON", "Homing Pigeon", 11, [[BL, 1], [BS, 0]], (i, T) =>
  col(i - 1) === -1 && col(i) === -1 && rb(i - 1) > avg(BL, T[0]!, i - 1) && rb(i) <= avg(BS, T[1]!, i) &&
  op(i) < op(i - 1) && cl(i) > cl(i - 1)
    ? 100 : 0);

export const cdlIdentical3Crows = cdl("IDENTICAL3CROWS", "Identical Three Crows", 12,
  [[SVS, 2], [SVS, 1], [SVS, 0], [EQ, 2], [EQ, 1]], (i, T) =>
  col(i - 2) === -1 && ls(i - 2) < avg(SVS, T[0]!, i - 2) &&
  col(i - 1) === -1 && ls(i - 1) < avg(SVS, T[1]!, i - 1) &&
  col(i) === -1 && ls(i) < avg(SVS, T[2]!, i) &&
  cl(i - 2) > cl(i - 1) && cl(i - 1) > cl(i) &&
  op(i - 1) <= cl(i - 2) + avg(EQ, T[3]!, i - 2) && op(i - 1) >= cl(i - 2) - avg(EQ, T[3]!, i - 2) &&
  op(i) <= cl(i - 1) + avg(EQ, T[4]!, i - 1) && op(i) >= cl(i - 1) - avg(EQ, T[4]!, i - 1)
    ? -100 : 0);

export const cdlInNeck = cdl("INNECK", "In-Neck Pattern", 11, [[EQ, 1], [BL, 1]], (i, T) =>
  col(i - 1) === -1 && rb(i - 1) > avg(BL, T[1]!, i - 1) &&
  col(i) === 1 && op(i) < lo(i - 1) && cl(i) <= cl(i - 1) + avg(EQ, T[0]!, i - 1) && cl(i) >= cl(i - 1)
    ? -100 : 0);

export const cdlInvertedHammer = cdl("INVERTEDHAMMER", "Inverted Hammer", 11, [[BS, 0], [SVS, 0]], (i, T) =>
  Math.max(op(i), cl(i)) < Math.min(op(i - 1), cl(i - 1)) && rb(i) < avg(BS, T[0]!, i) &&
  us(i) > avg(SL, 0, i) && ls(i) < avg(SVS, T[1]!, i)
    ? 100 : 0);

function kicking(i: number, T: Float64Array): boolean {
  return col(i - 1) === -col(i) && rb(i - 1) > avg(BL, T[2]!, i - 1) &&
    us(i - 1) < avg(SVS, T[0]!, i - 1) && ls(i - 1) < avg(SVS, T[0]!, i - 1) &&
    rb(i) > avg(BL, T[3]!, i) && us(i) < avg(SVS, T[1]!, i) && ls(i) < avg(SVS, T[1]!, i) &&
    ((col(i - 1) === -1 && lo(i) > hi(i - 1)) || (col(i - 1) === 1 && hi(i) < lo(i - 1)));
}
const KICK_SLOTS: Slot[] = [[SVS, 1], [SVS, 0], [BL, 1], [BL, 0]];

export const cdlKicking = cdl("KICKING", "Kicking", 11, KICK_SLOTS, (i, T) => (kicking(i, T) ? col(i) * 100 : 0));

export const cdlKickingByLength = cdl("KICKINGBYLENGTH", "Kicking - bull/bear determined by the longer marubozu", 11, KICK_SLOTS, (i, T) =>
  kicking(i, T) ? (col(rb(i) > rb(i - 1) ? i : i - 1)) * 100 : 0);

export const cdlLadderBottom = cdl("LADDERBOTTOM", "Ladder Bottom", 14, [[SVS, 1]], (i, T) =>
  col(i - 4) === -1 && col(i - 3) === -1 && col(i - 2) === -1 &&
  op(i - 4) > op(i - 3) && op(i - 3) > op(i - 2) && cl(i - 4) > cl(i - 3) && cl(i - 3) > cl(i - 2) &&
  col(i - 1) === -1 && us(i - 1) > avg(SVS, T[0]!, i - 1) &&
  col(i) === 1 && op(i) > op(i - 1) && cl(i) > hi(i - 1)
    ? 100 : 0);

export const cdlLongLeggedDoji = cdl("LONGLEGGEDDOJI", "Long Legged Doji", 10, [[BD, 0]], (i, T) =>
  rb(i) <= avg(BD, T[0]!, i) && (ls(i) > avg(SL, 0, i) || us(i) > avg(SL, 0, i))
    ? 100 : 0);

export const cdlLongLine = cdl("LONGLINE", "Long Line Candle", 10, [[BL, 0], [SS, 0]], (i, T) =>
  rb(i) > avg(BL, T[0]!, i) && us(i) < avg(SS, T[1]!, i) && ls(i) < avg(SS, T[1]!, i)
    ? col(i) * 100 : 0);

export const cdlMarubozu = cdl("MARUBOZU", "Marubozu", 10, [[BL, 0], [SVS, 0]], (i, T) =>
  rb(i) > avg(BL, T[0]!, i) && us(i) < avg(SVS, T[1]!, i) && ls(i) < avg(SVS, T[1]!, i)
    ? col(i) * 100 : 0);

export const cdlMatchingLow = cdl("MATCHINGLOW", "Matching Low", 6, [[EQ, 1]], (i, T) =>
  col(i - 1) === -1 && col(i) === -1 &&
  cl(i) <= cl(i - 1) + avg(EQ, T[0]!, i - 1) && cl(i) >= cl(i - 1) - avg(EQ, T[0]!, i - 1)
    ? 100 : 0);

export const cdlMatHold = cdl("MATHOLD", "Mat Hold", 14, [[BL, 4], [BS, 3], [BS, 2], [BS, 1]], (i, T, pen) =>
  col(i - 4) === 1 && col(i - 3) === -1 && col(i) === 1 &&
  Math.min(op(i - 3), cl(i - 3)) > Math.max(op(i - 4), cl(i - 4)) &&
  Math.min(op(i - 2), cl(i - 2)) < cl(i - 4) && Math.min(op(i - 1), cl(i - 1)) < cl(i - 4) &&
  Math.min(op(i - 2), cl(i - 2)) > cl(i - 4) - rb(i - 4) * pen && Math.min(op(i - 1), cl(i - 1)) > cl(i - 4) - rb(i - 4) * pen &&
  Math.max(cl(i - 2), op(i - 2)) < op(i - 3) && Math.max(cl(i - 1), op(i - 1)) < Math.max(cl(i - 2), op(i - 2)) &&
  op(i) > cl(i - 1) && cl(i) > Math.max(Math.max(hi(i - 3), hi(i - 2)), hi(i - 1)) &&
  rb(i - 4) > avg(BL, T[0]!, i - 4) &&
  rb(i - 3) < avg(BS, T[1]!, i - 3) && rb(i - 2) < avg(BS, T[2]!, i - 2) && rb(i - 1) < avg(BS, T[3]!, i - 1)
    ? 100 : 0, { pen: 0.5 });

export const cdlMorningDojiStar = cdl("MORNINGDOJISTAR", "Morning Doji Star", 12, [[BL, 2], [BD, 1], [BS, 0]], (i, T, pen) =>
  col(i - 2) === -1 && col(i) === 1 && Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2)) &&
  cl(i) > fma(rb(i - 2), pen, cl(i - 2)) &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) <= avg(BD, T[1]!, i - 1) && rb(i) > avg(BS, T[2]!, i)
    ? 100 : 0, { pen: 0.3 });

export const cdlMorningStar = cdl("MORNINGSTAR", "Morning Star", 12, [[BL, 2], [BS, 1], [BS, 0]], (i, T, pen) =>
  col(i - 2) === -1 && col(i) === 1 && Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2)) &&
  cl(i) > fma(rb(i - 2), pen, cl(i - 2)) &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) <= avg(BS, T[1]!, i - 1) && rb(i) > avg(BS, T[2]!, i)
    ? 100 : 0, { pen: 0.3 });

export const cdlOnNeck = cdl("ONNECK", "On-Neck Pattern", 11, [[EQ, 1], [BL, 1]], (i, T) =>
  col(i - 1) === -1 && rb(i - 1) > avg(BL, T[1]!, i - 1) &&
  col(i) === 1 && op(i) < lo(i - 1) && cl(i) <= lo(i - 1) + avg(EQ, T[0]!, i - 1) && cl(i) >= lo(i - 1) - avg(EQ, T[0]!, i - 1)
    ? -100 : 0);

export const cdlPiercing = cdl("PIERCING", "Piercing Pattern", 11, [[BL, 1], [BL, 0]], (i, T) =>
  col(i - 1) === -1 && rb(i - 1) > avg(BL, T[0]!, i - 1) &&
  col(i) === 1 && rb(i) > avg(BL, T[1]!, i) &&
  op(i) < lo(i - 1) && cl(i) < op(i - 1) && cl(i) > fma(rb(i - 1), 0.5, cl(i - 1))
    ? 100 : 0);

export const cdlRickshawMan = cdl("RICKSHAWMAN", "Rickshaw Man", 10, [[BD, 0], [NEAR, 0]], (i, T) =>
  rb(i) <= avg(BD, T[0]!, i) && ls(i) > avg(SL, 0, i) && us(i) > avg(SL, 0, i) &&
  Math.min(op(i), cl(i)) <= lo(i) + (hi(i) - lo(i)) / 2 + avg(NEAR, T[1]!, i) &&
  Math.max(op(i), cl(i)) >= lo(i) + (hi(i) - lo(i)) / 2 - avg(NEAR, T[1]!, i)
    ? 100 : 0);

export const cdlRiseFall3Methods = cdl("RISEFALL3METHODS", "Rising/Falling Three Methods", 14,
  [[BL, 4], [BS, 3], [BS, 2], [BS, 1], [BL, 0]], (i, T) => {
  const s = col(i - 4);
  return col(i - 4) === -col(i - 3) && col(i - 3) === col(i - 2) && col(i - 2) === col(i - 1) && col(i - 1) === -col(i) &&
    Math.min(op(i - 3), cl(i - 3)) < hi(i - 4) && Math.max(op(i - 3), cl(i - 3)) > lo(i - 4) &&
    Math.min(op(i - 2), cl(i - 2)) < hi(i - 4) && Math.max(op(i - 2), cl(i - 2)) > lo(i - 4) &&
    Math.min(op(i - 1), cl(i - 1)) < hi(i - 4) && Math.max(op(i - 1), cl(i - 1)) > lo(i - 4) &&
    cl(i - 2) * s < cl(i - 3) * s && cl(i - 1) * s < cl(i - 2) * s &&
    op(i) * s > cl(i - 1) * s && cl(i) * s > cl(i - 4) * s &&
    rb(i - 4) > avg(BL, T[0]!, i - 4) &&
    rb(i - 3) < avg(BS, T[1]!, i - 3) && rb(i - 2) < avg(BS, T[2]!, i - 2) && rb(i - 1) < avg(BS, T[3]!, i - 1) &&
    rb(i) > avg(BL, T[4]!, i)
    ? 100 * s : 0;
});

export const cdlSeparatingLines = cdl("SEPARATINGLINES", "Separating Lines", 11, [[SVS, 0], [BL, 0], [EQ, 1]], (i, T) =>
  col(i - 1) === -col(i) &&
  op(i) <= op(i - 1) + avg(EQ, T[2]!, i - 1) && op(i) >= op(i - 1) - avg(EQ, T[2]!, i - 1) &&
  rb(i) > avg(BL, T[1]!, i) &&
  ((col(i) === 1 && ls(i) < avg(SVS, T[0]!, i)) || (col(i) === -1 && us(i) < avg(SVS, T[0]!, i)))
    ? col(i) * 100 : 0);

export const cdlShootingStar = cdl("SHOOTINGSTAR", "Shooting Star", 11, [[BS, 0], [SVS, 0]], (i, T) =>
  Math.min(op(i), cl(i)) > Math.max(op(i - 1), cl(i - 1)) && rb(i) < avg(BS, T[0]!, i) &&
  us(i) > avg(SL, 0, i) && ls(i) < avg(SVS, T[1]!, i)
    ? -100 : 0);

export const cdlShortLine = cdl("SHORTLINE", "Short Line Candle", 10, [[BS, 0], [SS, 0]], (i, T) =>
  rb(i) < avg(BS, T[0]!, i) && us(i) < avg(SS, T[1]!, i) && ls(i) < avg(SS, T[1]!, i)
    ? col(i) * 100 : 0);

export const cdlSpinningTop = cdl("SPINNINGTOP", "Spinning Top", 10, [[BS, 0]], (i, T) =>
  us(i) > rb(i) && ls(i) > rb(i) && rb(i) < avg(BS, T[0]!, i)
    ? col(i) * 100 : 0);

export const cdlStalledPattern = cdl("STALLEDPATTERN", "Stalled Pattern", 12,
  [[BL, 2], [BL, 1], [BS, 0], [SVS, 1], [NEAR, 2], [NEAR, 1]], (i, T) =>
  col(i - 2) === 1 && col(i - 1) === 1 && col(i) === 1 && cl(i) > cl(i - 1) && cl(i - 1) > cl(i - 2) &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i - 1) > avg(BL, T[1]!, i - 1) &&
  us(i - 1) < avg(SVS, T[3]!, i - 1) &&
  op(i - 1) > op(i - 2) && op(i - 1) <= cl(i - 2) + avg(NEAR, T[4]!, i - 2) &&
  rb(i) < avg(BS, T[2]!, i) && op(i) >= cl(i - 1) - rb(i) - avg(NEAR, T[5]!, i - 1)
    ? -100 : 0);

export const cdlStickSandwich = cdl("STICKSANDWICH", "Stick Sandwich", 7, [[EQ, 2]], (i, T) =>
  col(i - 2) === -1 && col(i - 1) === 1 && col(i) === -1 && lo(i - 1) > cl(i - 2) &&
  cl(i) <= cl(i - 2) + avg(EQ, T[0]!, i - 2) && cl(i) >= cl(i - 2) - avg(EQ, T[0]!, i - 2)
    ? 100 : 0);

export const cdlTakuri = cdl("TAKURI", "Takuri (Dragonfly Doji with very long lower shadow)", 10, [[BD, 0], [SVS, 0]], (i, T) =>
  rb(i) <= avg(BD, T[0]!, i) && us(i) < avg(SVS, T[1]!, i) && ls(i) > avg(SVL, 0, i)
    ? 100 : 0);

export const cdlTasukiGap = cdl("TASUKIGAP", "Tasuki Gap", 7, [[NEAR, 1]], (i, T) =>
  (Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2)) && col(i - 1) === 1 && col(i) === -1 &&
   op(i) < cl(i - 1) && op(i) > op(i - 1) && cl(i) < op(i - 1) && cl(i) > Math.max(cl(i - 2), op(i - 2)) &&
   Math.abs(rb(i - 1) - rb(i)) < avg(NEAR, T[0]!, i - 1)) ||
  (Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2)) && col(i - 1) === -1 && col(i) === 1 &&
   op(i) < op(i - 1) && op(i) > cl(i - 1) && cl(i) > op(i - 1) && cl(i) < Math.min(cl(i - 2), op(i - 2)) &&
   Math.abs(rb(i - 1) - rb(i)) < avg(NEAR, T[0]!, i - 1))
    ? col(i - 1) * 100 : 0);

export const cdlThrusting = cdl("THRUSTING", "Thrusting Pattern", 11, [[EQ, 1], [BL, 1]], (i, T) =>
  col(i - 1) === -1 && rb(i - 1) > avg(BL, T[1]!, i - 1) &&
  col(i) === 1 && op(i) < lo(i - 1) && cl(i) > cl(i - 1) + avg(EQ, T[0]!, i - 1) && cl(i) <= fma(rb(i - 1), 0.5, cl(i - 1))
    ? -100 : 0);

export const cdlTriStar = cdl("TRISTAR", "Tristar Pattern", 12, [[BD, 2]], (i, T) => {
  if (!(rb(i - 2) <= avg(BD, T[0]!, i - 2) && rb(i - 1) <= avg(BD, T[0]!, i - 2) && rb(i) <= avg(BD, T[0]!, i - 2))) return 0;
  let out = 0;
  if (Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2)) && Math.max(op(i), cl(i)) < Math.max(op(i - 1), cl(i - 1))) out = -100;
  if (Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2)) && Math.min(op(i), cl(i)) > Math.min(op(i - 1), cl(i - 1))) out = 100;
  return out;
});

export const cdlUnique3River = cdl("UNIQUE3RIVER", "Unique 3 River", 12, [[BL, 2], [BS, 0]], (i, T) =>
  col(i - 2) === -1 && col(i - 1) === -1 && col(i) === 1 &&
  cl(i - 1) > cl(i - 2) && op(i - 1) <= op(i - 2) && lo(i - 1) < lo(i - 2) && op(i) > lo(i - 1) &&
  rb(i - 2) > avg(BL, T[0]!, i - 2) && rb(i) < avg(BS, T[1]!, i)
    ? 100 : 0);

export const cdlUpsideGap2Crows = cdl("UPSIDEGAP2CROWS", "Upside Gap Two Crows", 12, [[BL, 2], [BS, 1]], (i, T) =>
  col(i - 2) === 1 && rb(i - 2) > avg(BL, T[0]!, i - 2) &&
  col(i - 1) === -1 && rb(i - 1) <= avg(BS, T[1]!, i - 1) &&
  Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2)) &&
  col(i) === -1 && op(i) > op(i - 1) && cl(i) < cl(i - 1) && cl(i) > cl(i - 2)
    ? -100 : 0);

export const cdlXSideGap3Methods = cdl("XSIDEGAP3METHODS", "Upside/Downside Gap Three Methods", 2, [], (i) =>
  col(i - 2) === col(i - 1) && col(i - 1) === -col(i) &&
  op(i) < Math.max(cl(i - 1), op(i - 1)) && op(i) > Math.min(cl(i - 1), op(i - 1)) &&
  cl(i) < Math.max(cl(i - 2), op(i - 2)) && cl(i) > Math.min(cl(i - 2), op(i - 2)) &&
  ((col(i - 2) === 1 && Math.min(op(i - 1), cl(i - 1)) > Math.max(op(i - 2), cl(i - 2))) ||
   (col(i - 2) === -1 && Math.max(op(i - 1), cl(i - 1)) < Math.min(op(i - 2), cl(i - 2))))
    ? col(i - 2) * 100 : 0);
