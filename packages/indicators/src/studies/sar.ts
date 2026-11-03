// Parabolic SAR (TA-Lib SAR and SAREXT). A state machine whose trend flag,
// extreme point, acceleration factors and next SAR live in columns; the first
// output is bar 1 (TA-Lib's lookback).

import { COLORS, defineStudy, float, markers } from "../define.js";
import type { Col, Graph, Node } from "../engine/graph.js";

/** Initial trend as TA-Lib decides it: short when the first bar's -DM(1) is positive. */
function startsShort(g: Graph): boolean {
  const h = g.high.v, l = g.low.v;
  const diffP = h[1]! - h[0]!, diffM = l[0]! - l[1]!;
  return diffM > 0 && diffP < diffM;
}

interface SarOpts {
  /** startvalue: 0 = decide from the first two bars, > 0 long from that SAR, < 0 short from |value|. */
  startValue: number;
  offsetOnReverse: number;
  initLong: number; accLong: number; maxLong: number;
  initShort: number; accShort: number; maxShort: number;
  /** Signed output (negative when short) as SAREXT. */
  signed: boolean;
}

function parabolic(g: Graph, o: SarOpts): Node {
  const isLong = g.col(), sarS = g.col(), ep = g.col(), afL = g.col(), afS = g.col();
  return g.node((self, a, b) => {
    const hi = g.high.v, lo = g.low.v, lg = isLong.v, ss = sarS.v, ee = ep.v, fl = afL.v, fs = afS.v, v = self.v;
    for (let i = a; i < b; i++) {
      if (i < 1) { v[i] = Number.NaN; continue; }
      let long: boolean, sar: number, e: number, al: number, as_: number, prevLow: number, prevHigh: number;
      if (i === 1) {
        if (o.startValue === 0) long = !startsShort(g);
        else long = o.startValue > 0;
        if (o.startValue === 0) {
          if (long) { e = hi[1]!; sar = lo[0]!; } else { e = lo[1]!; sar = hi[0]!; }
        } else if (o.startValue > 0) { e = hi[1]!; sar = o.startValue; } else { e = lo[1]!; sar = Math.abs(o.startValue); }
        al = o.initLong;
        as_ = o.initShort;
        // TA-Lib seeds "previous" with the first processed bar itself
        prevLow = lo[1]!;
        prevHigh = hi[1]!;
      } else {
        long = lg[i - 1]! === 1; sar = ss[i - 1]!; e = ee[i - 1]!; al = fl[i - 1]!; as_ = fs[i - 1]!;
        prevLow = lo[i - 1]!;
        prevHigh = hi[i - 1]!;
      }
      const newLow = lo[i]!, newHigh = hi[i]!;
      let out: number;
      if (long) {
        if (newLow <= sar) {
          long = false;
          sar = e;
          if (sar < prevHigh) sar = prevHigh;
          if (sar < newHigh) sar = newHigh;
          if (o.offsetOnReverse !== 0) sar += sar * o.offsetOnReverse;
          out = o.signed ? -sar : sar;
          as_ = o.initShort;
          e = newLow;
          sar = sar + as_ * (e - sar);
          if (sar < prevHigh) sar = prevHigh;
          if (sar < newHigh) sar = newHigh;
        } else {
          out = sar;
          if (newHigh > e) {
            e = newHigh;
            al += o.accLong;
            if (al > o.maxLong) al = o.maxLong;
          }
          sar = sar + al * (e - sar);
          if (sar > prevLow) sar = prevLow;
          if (sar > newLow) sar = newLow;
        }
      } else if (newHigh >= sar) {
        long = true;
        sar = e;
        if (sar > prevLow) sar = prevLow;
        if (sar > newLow) sar = newLow;
        if (o.offsetOnReverse !== 0) sar -= sar * o.offsetOnReverse;
        out = sar;
        al = o.initLong;
        e = newHigh;
        sar = sar + al * (e - sar);
        if (sar > prevLow) sar = prevLow;
        if (sar > newLow) sar = newLow;
      } else {
        out = o.signed ? -sar : sar;
        if (newLow < e) {
          e = newLow;
          as_ += o.accShort;
          if (as_ > o.maxShort) as_ = o.maxShort;
        }
        sar = sar + as_ * (e - sar);
        if (sar < prevHigh) sar = prevHigh;
        if (sar < newHigh) sar = newHigh;
      }
      lg[i] = long ? 1 : 0; ss[i] = sar; ee[i] = e; fl[i] = al; fs[i] = as_;
      v[i] = out;
    }
  });
}

const acc = (key: string, def: number) => float(key, def, 0, 100, 0.01);

export const sar = defineStudy({
  id: "sar", name: "Parabolic SAR", family: "overlap", needs: "ohlc", pane: "overlay",
  inputs: [acc("start", 0.02), acc("increment", 0.02), acc("maximum", 0.2)],
  columns: ["sar"],
  plots: [markers("sar", "circle", "value", COLORS.blue)],
  label: (p) => `${p.start}, ${p.increment}, ${p.maximum}`,
  build: (g, p) => {
    const max: number = p.maximum;
    const start = Math.min(p.start as number, max);
    return [parabolic(g, { startValue: 0, offsetOnReverse: 0, initLong: start, accLong: p.increment, maxLong: max, initShort: start, accShort: p.increment, maxShort: max, signed: false })];
  },
  reference: "TA-Lib SAR (start = increment = acceleration)",
});

export const sarext = defineStudy({
  id: "sarext", name: "Parabolic SAR - Extended", family: "overlap", needs: "ohlc", pane: "overlay",
  inputs: [
    float("startvalue", 0, -1e9, 1e9, 0.1),
    acc("offsetonreverse", 0),
    acc("accelerationinitlong", 0.02), acc("accelerationlong", 0.02), acc("accelerationmaxlong", 0.2),
    acc("accelerationinitshort", 0.02), acc("accelerationshort", 0.02), acc("accelerationmaxshort", 0.2),
  ],
  columns: ["sarext", "level"],
  plots: [markers("level", "circle", "value", COLORS.blue, { title: "SAR" })],
  label: () => "sarext is negative when short",
  build: (g, p) => {
    const maxL: number = p.accelerationmaxlong, maxS: number = p.accelerationmaxshort;
    const sx: Node = parabolic(g, {
      startValue: p.startvalue, offsetOnReverse: p.offsetonreverse,
      initLong: Math.min(p.accelerationinitlong as number, maxL), accLong: Math.min(p.accelerationlong as number, maxL), maxLong: maxL,
      initShort: Math.min(p.accelerationinitshort as number, maxS), accShort: Math.min(p.accelerationshort as number, maxS), maxShort: maxS,
      signed: true,
    });
    // the unsigned price level, for drawing on the price pane
    const level: Col = g.map(sx, Math.abs);
    return [sx, level];
  },
  reference: "TA-Lib SAREXT (signed: negative when short)",
});
