// Moving-average building blocks shared by the studies of this package: the
// TA-Lib MA types as graph nodes, and EMA variants with TA-Lib's exact seeding.

import type { Col, Graph, Node } from "../engine/graph.js";

export const MA_TYPES = ["sma", "ema", "wma", "rma", "dema", "tema", "trima", "kama", "t3"] as const;
export type MaType = (typeof MA_TYPES)[number];

/** Kaufman's adaptive MA: efficiency ratio over p bars, fast/slow smoothing limits. TA-Lib seeds with the bar before the first output. */
export function kama(g: Graph, x: Col, p: number, fast = 2, slow = 30): Node {
  const d = g.map2(x, g.lag(x, 1), (a, b) => Math.abs(a - b));
  const sd = g.sum(d, p);
  const lagP = g.lag(x, p);
  const fsc = 2 / (fast + 1), ssc = 2 / (slow + 1);
  const self: Node = g.calc((i) => {
    const s = sd.v[i]!, xi = x.v[i]!, x0 = lagP.v[i]!;
    if (s !== s || xi !== xi || x0 !== x0) return Number.NaN;
    const er = s <= 0 ? 0 : Math.abs(xi - x0) / s;
    const sc = (er * (fsc - ssc) + ssc) ** 2;
    const prevK = i > 0 ? self.v[i - 1]! : Number.NaN;
    const prev = prevK === prevK ? prevK : x.v[i - 1]!;
    return prev + sc * (xi - prev);
  });
  return self;
}

/** Tillson T3: six EMAs, volume factor `a`. */
export function t3(g: Graph, x: Col, p: number, a = 0.7): Node {
  let e: Node = g.ema(x, p);
  const stages: Node[] = [e];
  for (let k = 1; k < 6; k++) stages.push((e = g.ema(e, p)));
  const a2 = a * a, a3 = a2 * a;
  const c1 = -a3, c2 = 3 * a2 + 3 * a3, c3 = -6 * a2 - 3 * a - 3 * a3, c4 = 1 + 3 * a + a3 + 3 * a2;
  const [, , e3, e4, e5, e6] = stages as [Node, Node, Node, Node, Node, Node];
  return g.calc((i) => c1 * e6.v[i]! + c2 * e5.v[i]! + c3 * e4.v[i]! + c4 * e3.v[i]!);
}

export function dema(g: Graph, x: Col, p: number): Node {
  const e1 = g.ema(x, p), e2 = g.ema(e1, p);
  return g.calc((i) => 2 * e1.v[i]! - e2.v[i]!);
}

export function tema(g: Graph, x: Col, p: number): Node {
  const e1 = g.ema(x, p), e2 = g.ema(e1, p), e3 = g.ema(e2, p);
  return g.calc((i) => 3 * e1.v[i]! - 3 * e2.v[i]! + e3.v[i]!);
}

/** Triangular MA: an SMA of an SMA with the periods TA-Lib splits p into. */
export function trima(g: Graph, x: Col, p: number): Node {
  const odd = p % 2 === 1;
  return odd ? g.sma(g.sma(x, (p + 1) / 2), (p + 1) / 2) : g.sma(g.sma(x, p / 2), p / 2 + 1);
}

/**
 * EMA that starts at the first bar `gate` is valid, seeded with the simple
 * mean of the p values ending there (TA-Lib seeds MACD's fast EMA at the slow
 * EMA's first bar this way).
 */
export function emaGated(g: Graph, x: Col, p: number, alpha: number, gate: Col): Node {
  const cnt = g.validRun(x);
  return g.node((s, a, b) => {
    const xv = x.v, c = cnt.v, gv = gate.v, v = s.v;
    for (let i = a; i < b; i++) {
      const prev = i > 0 ? v[i - 1]! : Number.NaN;
      if (prev === prev && xv[i]! === xv[i]!) v[i] = prev + alpha * (xv[i]! - prev);
      else if (gv[i]! === gv[i]! && c[i]! >= p) {
        let t = 0;
        for (let j = i - p + 1; j <= i; j++) t += xv[j]!;
        v[i] = t / p;
      } else v[i] = Number.NaN;
    }
  });
}

/** EMA seeded with the first value instead of a mean (TA-Lib ADOSC). */
export function emaFirst(g: Graph, x: Col, alpha: number): Node {
  const self: Node = g.calc((i) => {
    const xi = x.v[i]!;
    if (xi !== xi) return Number.NaN;
    const prev = i > 0 ? self.v[i - 1]! : Number.NaN;
    return prev === prev ? prev + alpha * (xi - prev) : xi;
  });
  return self;
}

/** One moving average of the given type. */
export function ma(g: Graph, type: MaType, x: Col, p: number): Node {
  switch (type) {
    case "sma": return g.sma(x, p);
    case "ema": return g.ema(x, p);
    case "wma": return g.wma(x, p);
    case "rma": return g.rma(x, p);
    case "dema": return dema(g, x, p);
    case "tema": return tema(g, x, p);
    case "trima": return trima(g, x, p);
    case "kama": return kama(g, x, p);
    case "t3": return t3(g, x, p);
  }
}

/**
 * `ma`, except that an EMA starts where `gate` first has a value (TA-Lib's APO,
 * PPO and MACD compute the fast average from the slow average's first bar).
 */
export function maGated(g: Graph, type: MaType, x: Col, p: number, gate: Col): Node {
  return type === "ema" ? emaGated(g, x, p, 2 / (p + 1), gate) : ma(g, type, x, p);
}
