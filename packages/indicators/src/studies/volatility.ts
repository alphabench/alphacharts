// Volatility studies from TA-Lib: true range and the Wilder average.

import { COLORS, defineStudy, int, line } from "../define.js";

export const trange = defineStudy({
  id: "trange", name: "True Range", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [], columns: ["trange"], plots: [line("trange", COLORS.orange)],
  build: (g) => [g.tr()],
  reference: "TA-Lib TRANGE",
});

export const atr = defineStudy({
  id: "atr", name: "Average True Range", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 1, 5000)], columns: ["atr"], plots: [line("atr", COLORS.red)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.atr(p.length)],
  reference: "TA-Lib ATR (Wilder, seeded with the mean of the first `length` true ranges)",
});

export const natr = defineStudy({
  id: "natr", name: "Normalized Average True Range", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 1, 5000)], columns: ["natr"], plots: [line("natr", COLORS.red)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const a = g.atr(p.length);
    return [g.calc((i) => (100 * a.v[i]!) / g.close.v[i]!)];
  },
  reference: "TA-Lib NATR = 100 * ATR / close",
});
