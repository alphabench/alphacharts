// Price transforms (TA-Lib "Price Transform"): one price from the bar's four.

import type { Col, Graph, Node } from "../engine/graph.js";
import { COLORS, defineStudy, line } from "../define.js";

const price = (id: string, name: string, color: string, f: (g: Graph) => Node, ref: string) =>
  defineStudy({ id, name, family: "price", needs: "ohlc", pane: "overlay", inputs: [], columns: [id], plots: [line(id, color)], build: (g) => [f(g)], reference: ref });

export const avgprice = price("avgprice", "Average Price", COLORS.blue, (g) => g.src("ohlc4"), "TA-Lib AVGPRICE = (O + H + L + C) / 4");
export const medprice = price("medprice", "Median Price", COLORS.orange, (g) => g.src("hl2"), "TA-Lib MEDPRICE = (H + L) / 2");
export const typprice = price("typprice", "Typical Price", COLORS.green, (g) => g.src("hlc3"), "TA-Lib TYPPRICE = (H + L + C) / 3");
export const wclprice = price("wclprice", "Weighted Close Price", COLORS.purple, (g) => g.src("hlcc4"), "TA-Lib WCLPRICE = (H + L + 2C) / 4");

export type { Col };
