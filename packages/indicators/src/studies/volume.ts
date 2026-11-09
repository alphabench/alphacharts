// Volume studies from TA-Lib's "Volume Indicators" group.

import type { Graph, Node } from "../engine/graph.js";
import { COLORS, defineStudy, hline, int, line } from "../define.js";
import { emaFirst } from "./ma.js";

/** Accumulation/distribution line: running sum of money-flow multiplier x volume. */
function adLine(g: Graph): Node {
  const self: Node = g.calc((i) => {
    const r = g.high.v[i]! - g.low.v[i]!;
    const mf = r === 0 ? 0 : (((g.close.v[i]! - g.low.v[i]!) - (g.high.v[i]! - g.close.v[i]!)) / r) * g.volume.v[i]!;
    return (i > 0 ? self.v[i - 1]! : 0) + mf;
  });
  return self;
}

export const ad = defineStudy({
  id: "ad", name: "Accumulation/Distribution", family: "volume", needs: "ohlcv", pane: "new",
  inputs: [], columns: ["ad"], plots: [line("ad", COLORS.neutral)],
  build: (g) => [adLine(g)],
  reference: "TA-Lib AD (a flat bar adds 0)",
});

export const adosc = defineStudy({
  id: "adosc", name: "Chaikin Oscillator", family: "volume", needs: "ohlcv", pane: "new",
  inputs: [int("fast", 3, 1, 5000), int("slow", 10, 2, 5000)], columns: ["adosc"],
  plots: [line("adosc", COLORS.purple), hline("zero", 0, COLORS.gray, "dotted")],
  label: (p) => `${p.fast}, ${p.slow}`,
  build: (g, p) => {
    if (p.fast >= p.slow) throw new RangeError(`adosc: fast (${p.fast}) must be below slow (${p.slow})`);
    const a = adLine(g);
    const f = emaFirst(g, a, 2 / (p.fast + 1)), s = emaFirst(g, a, 2 / (p.slow + 1));
    return [g.calc((i) => (i >= p.slow - 1 ? f.v[i]! - s.v[i]! : Number.NaN))];
  },
  reference: "TA-Lib ADOSC: both EMAs are seeded with the first A/D value (TradingView seeds with an SMA; the difference vanishes within ~60 bars)",
});

export const obv = defineStudy({
  id: "obv", name: "On Balance Volume", family: "volume", needs: "ohlcv", pane: "new",
  inputs: [], columns: ["obv"], plots: [line("obv", COLORS.teal)],
  build: (g) => {
    const self: Node = g.calc((i) => {
      if (i === 0) return g.volume.v[0]!;
      const c = g.close.v[i]!, pc = g.close.v[i - 1]!;
      return self.v[i - 1]! + (c > pc ? g.volume.v[i]! : c < pc ? -g.volume.v[i]! : 0);
    });
    return [self];
  },
  reference: "TA-Lib OBV (first value is the first bar's volume)",
});
