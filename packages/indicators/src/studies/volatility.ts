// Volatility studies: TA-Lib's true range, and Wilder's average true range (not TA-Lib's).

import { COLORS, defineStudy, int, line } from "../define.js";

export const trange = defineStudy({
  id: "trange", name: "True Range", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [], columns: ["trange"], plots: [line("trange", COLORS.orange)],
  build: (g) => [g.tr()],
  reference: "TA-Lib TRANGE",
});

export const atr = defineStudy({
  id: "atr", name: "Average True Range", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 1, 5000)], columns: ["atr"], plots: [line("atr", COLORS.orange)],
  label: (p) => `${p.length}`,
  build: (g, p) => [g.atr(p.length)],
  reference: "Wilder's ATR (not TA-Lib's): true range of bar 0 is high - low, seeded with the mean of true ranges 0..length-1 (first value at bar length-1), then Wilder smoothing. TA-Lib skips the first true range and starts one bar later",
});

export const natr = defineStudy({
  id: "natr", name: "Normalized Average True Range", family: "volatility", needs: "ohlc", pane: "new",
  inputs: [int("length", 14, 1, 5000)], columns: ["natr"], plots: [line("natr", COLORS.orange)],
  label: (p) => `${p.length}`,
  build: (g, p) => {
    const a = g.atr(p.length);
    return [g.calc((i) => (100 * a.v[i]!) / g.close.v[i]!)];
  },
  reference: "NATR = 100 * ATR / close, on Wilder's ATR (not TA-Lib's, see atr)",
});
