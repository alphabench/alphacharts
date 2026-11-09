// Cycle studies: TA-Lib's Hilbert-transform family (Ehlers) and MAMA/FAMA.
//
// TA-Lib keeps the Hilbert filters in odd/even circular buffers; here every
// intermediate series (smoothed price, detrender, Q1, jI, jQ, I2, Q2, Re, Im,
// period, smoothed period, ...) is a column indexed by bar. A same-parity
// Hilbert step is the 4-tap filter a*x[i] + b*x[i-2] - b*x[i-4] - a*x[i-6]
// scaled by 0.075*period[i-1] + 0.54, and "I1" is the detrender three bars back.
//
// TA-Lib's recursive state starts at zero at its own first processed bar
// S = 3 + warm (warm = 9 for HT_DCPERIOD/PHASOR/MAMA, 34 for the studies that
// also run the dominant-cycle phase). Bars before S read as 0 inside the
// filters (that is TA-Lib's zeroed state); the outputs are absent before TA-Lib's
// first output (index 32 or 63).

import { COLORS, defineStudy, float, hist, line, source } from "../define.js";
import type { Col, Graph, Node } from "../engine/graph.js";

const A = 0.0962;
const B = 0.5769;
const ATAN1 = Math.atan(1);
const RAD2DEG = 45 / ATAN1;
const DEG2RAD = 1 / RAD2DEG;
const TWO_PI = ATAN1 * 8;

interface Core {
  /** First bar TA-Lib processes. */
  S: number;
  sm: Col;
  det: Col;
  q1: Col;
  /** Smoothed dominant cycle period. */
  sper: Node;
}

/** Same-parity Hilbert step of `v` (value `lag` bars old is the newest tap). */
function hil(v: Float64Array, i: number, lag: number, adj: number): number {
  return adj * (A * v[i - lag]! + B * v[i - lag - 2]! - B * v[i - lag - 4]! - A * v[i - lag - 6]!);
}

function hilbertCore(g: Graph, x: Col, warm: number): Core {
  const S = 3 + warm;
  const sm = g.col(), det = g.col(), q1 = g.col(), ji = g.col(), jq = g.col();
  const q2 = g.col(), i2 = g.col(), re = g.col(), im = g.col(), per = g.col();
  const sper = g.node((self, from, to) => {
    const xv = x.v, smv = sm.v, dv = det.v, qv = q1.v, jiv = ji.v, jqv = jq.v;
    const q2v = q2.v, i2v = i2.v, rev = re.v, imv = im.v, pv = per.v, sv = self.v;
    for (let i = from; i < to; i++) {
      if (i < S) {
        smv[i] = dv[i] = qv[i] = jiv[i] = jqv[i] = q2v[i] = i2v[i] = rev[i] = imv[i] = pv[i] = sv[i] = 0;
        continue;
      }
      const prevPeriod = pv[i - 1]!;
      const adj = 0.075 * prevPeriod + 0.54;
      smv[i] = (4 * xv[i]! + 3 * xv[i - 1]! + 2 * xv[i - 2]! + xv[i - 3]!) / 10;
      dv[i] = hil(smv, i, 0, adj);
      qv[i] = hil(dv, i, 0, adj);
      jiv[i] = hil(dv, i, 3, adj);
      jqv[i] = hil(qv, i, 0, adj);
      const pq2 = q2v[i - 1]!, pi2 = i2v[i - 1]!;
      const nq2 = 0.2 * (qv[i]! + jiv[i]!) + 0.8 * pq2;
      const ni2 = 0.2 * (dv[i - 3]! - jqv[i]!) + 0.8 * pi2;
      q2v[i] = nq2;
      i2v[i] = ni2;
      const nre = 0.8 * rev[i - 1]! + 0.2 * (ni2 * pi2 + nq2 * pq2);
      const nim = 0.8 * imv[i - 1]! + 0.2 * (ni2 * pq2 - nq2 * pi2);
      rev[i] = nre;
      imv[i] = nim;
      let p = prevPeriod;
      if (nim !== 0 && nre !== 0) p = 360 / (Math.atan(nim / nre) * RAD2DEG);
      if (p > 1.5 * prevPeriod) p = 1.5 * prevPeriod;
      if (p < 0.67 * prevPeriod) p = 0.67 * prevPeriod;
      if (p < 6) p = 6;
      else if (p > 50) p = 50;
      p = 0.2 * p + 0.8 * prevPeriod;
      pv[i] = p;
      sv[i] = 0.33 * p + 0.67 * sv[i - 1]!;
    }
  });
  return { S, sm, det, q1, sper };
}

/** `v` from bar `first` on, absent before (TA-Lib's lookback). */
function from(g: Graph, v: Col, first: number): Node {
  return g.calc((i) => (i >= first ? v.v[i]! : Number.NaN));
}

/** Dominant cycle phase in degrees (TA-Lib HT_DCPHASE), carried bar to bar. */
function dcPhase(g: Graph, c: Core): Node {
  const { S, sm, sper } = c;
  return g.node((self, a, b) => {
    const smv = sm.v, sp = sper.v, v = self.v;
    for (let i = a; i < b; i++) {
      if (i < S) { v[i] = 0; continue; }
      const dc = Math.floor(sp[i]! + 0.5);
      let real = 0, imag = 0;
      for (let k = 0; k < dc; k++) {
        const ang = (k * TWO_PI) / dc;
        const s = i - k >= 0 ? smv[i - k]! : 0;
        real += Math.sin(ang) * s;
        imag += Math.cos(ang) * s;
      }
      let ph = v[i - 1]!;
      if (Math.abs(imag) > 0) ph = Math.atan(real / imag) * RAD2DEG;
      else if (real < 0) ph -= 90;
      else if (real > 0) ph += 90;
      ph += 90;
      ph += 360 / sp[i]!;
      if (imag < 0) ph += 180;
      if (ph > 315) ph -= 360;
      v[i] = ph;
    }
  });
}

/** Instantaneous trendline and its running 4-3-2-1 smoothing of the cycle-period average. */
function trendline(g: Graph, x: Col, c: Core): Node {
  const { S, sper } = c;
  const itr = g.col();
  return g.node((self, a, b) => {
    const xv = x.v, sp = sper.v, it = itr.v, v = self.v;
    for (let i = a; i < b; i++) {
      if (i < S) { it[i] = 0; v[i] = 0; continue; }
      const dc = Math.floor(sp[i]! + 0.5);
      let t = 0;
      for (let j = 0; j < dc && i - j >= 0; j++) t += xv[i - j]!;
      if (dc > 0) t /= dc;
      it[i] = t;
      v[i] = (4 * t + 3 * it[i - 1]! + 2 * it[i - 2]! + it[i - 3]!) / 10;
    }
  });
}

const FIRST_SHORT = 32;
const FIRST_LONG = 63;

export const htDcPeriod = defineStudy({
  id: "ht-dcperiod", name: "Hilbert Transform - Dominant Cycle Period", family: "cycle", needs: "value", pane: "new",
  inputs: [source()], columns: ["period"], plots: [line("period", COLORS.neutral)],
  build: (g, p) => [from(g, hilbertCore(g, g.src(p.source), 9).sper, FIRST_SHORT)],
  reference: "TA-Lib HT_DCPERIOD",
});

export const htDcPhase = defineStudy({
  id: "ht-dcphase", name: "Hilbert Transform - Dominant Cycle Phase", family: "cycle", needs: "value", pane: "new",
  inputs: [source()], columns: ["phase"], plots: [line("phase", COLORS.orange)],
  build: (g, p) => [from(g, dcPhase(g, hilbertCore(g, g.src(p.source), 34)), FIRST_LONG)],
  reference: "TA-Lib HT_DCPHASE",
});

export const htPhasor = defineStudy({
  id: "ht-phasor", name: "Hilbert Transform - Phasor Components", family: "cycle", needs: "value", pane: "new",
  inputs: [source()], columns: ["inphase", "quadrature"],
  plots: [line("inphase", COLORS.neutral), line("quadrature", COLORS.orange)],
  build: (g, p) => {
    const c = hilbertCore(g, g.src(p.source), 9);
    const inphase = g.calc((i) => (i >= FIRST_SHORT ? c.det.v[i - 3]! : Number.NaN));
    return [inphase, from(g, c.q1, FIRST_SHORT)];
  },
  reference: "TA-Lib HT_PHASOR",
});

export const htSine = defineStudy({
  id: "ht-sine", name: "Hilbert Transform - SineWave", family: "cycle", needs: "value", pane: "new",
  inputs: [source()], columns: ["sine", "leadsine"],
  plots: [line("sine", COLORS.neutral), line("leadsine", COLORS.orange)],
  build: (g, p) => {
    const ph = dcPhase(g, hilbertCore(g, g.src(p.source), 34));
    return [
      g.calc((i) => (i >= FIRST_LONG ? Math.sin(ph.v[i]! * DEG2RAD) : Number.NaN)),
      g.calc((i) => (i >= FIRST_LONG ? Math.sin((ph.v[i]! + 45) * DEG2RAD) : Number.NaN)),
    ];
  },
  reference: "TA-Lib HT_SINE",
});

export const htTrendline = defineStudy({
  id: "ht-trendline", name: "Hilbert Transform - Instantaneous Trendline", family: "cycle", needs: "value", pane: "overlay",
  inputs: [source()], columns: ["trendline"], plots: [line("trendline", COLORS.neutral)],
  build: (g, p) => {
    const x = g.src(p.source);
    return [from(g, trendline(g, x, hilbertCore(g, x, 34)), FIRST_LONG)];
  },
  reference: "TA-Lib HT_TRENDLINE",
});

export const htTrendMode = defineStudy({
  id: "ht-trendmode", name: "Hilbert Transform - Trend vs Cycle Mode", family: "cycle", needs: "value", pane: "new",
  inputs: [source()], columns: ["trendmode"], plots: [hist("trendmode", COLORS.teal)],
  build: (g, p) => {
    const x = g.src(p.source);
    const c = hilbertCore(g, x, 34);
    const ph = dcPhase(g, c);
    const tl = trendline(g, x, c);
    const sine = g.col(), lead = g.col(), days = g.col();
    const trend = g.node((self, a, b) => {
      const smv = c.sm.v, sp = c.sper.v, pv = ph.v, tv = tl.v, sn = sine.v, ld = lead.v, dy = days.v, v = self.v;
      for (let i = a; i < b; i++) {
        if (i < c.S) { sn[i] = ld[i] = dy[i] = v[i] = 0; continue; }
        const s = Math.sin(pv[i]! * DEG2RAD), l = Math.sin((pv[i]! + 45) * DEG2RAD);
        sn[i] = s;
        ld[i] = l;
        const ps = sn[i - 1]!, pl = ld[i - 1]!;
        let t = 1, d = dy[i - 1]!;
        if ((s > l && ps <= pl) || (s < l && ps >= pl)) { d = 0; t = 0; }
        d += 1;
        dy[i] = d;
        if (d < 0.5 * sp[i]!) t = 0;
        const dphi = pv[i]! - pv[i - 1]!;
        if (sp[i] !== 0 && dphi > (0.67 * 360) / sp[i]! && dphi < (1.5 * 360) / sp[i]!) t = 0;
        const trl = tv[i]!;
        if (trl !== 0 && Math.abs((smv[i]! - trl) / trl) >= 0.015) t = 1;
        v[i] = t;
      }
    });
    // TA-Lib returns the integer 0 (not absent) during warm-up; the fixtures compare that.
    return [g.calc((i) => (i >= FIRST_LONG ? trend.v[i]! : 0))];
  },
  reference: "TA-Lib HT_TRENDMODE (0 = cycle mode, 1 = trend mode; 0 during warm-up as in TA-Lib)",
});

export const mama = defineStudy({
  id: "mama", name: "MESA Adaptive Moving Average", family: "overlap", needs: "value", pane: "overlay",
  inputs: [float("fastlimit", 0.5, 0.01, 0.99, 0.01), float("slowlimit", 0.05, 0.01, 0.99, 0.01), source()],
  columns: ["mama", "fama"],
  plots: [line("mama", COLORS.neutral), line("fama", COLORS.orange)],
  label: (p) => `${p.fastlimit}, ${p.slowlimit}`,
  build: (g, p) => {
    const fast: number = p.fastlimit, slow: number = p.slowlimit;
    const x = g.src(p.source);
    const c = hilbertCore(g, x, 9);
    const fama = g.col(), phase = g.col();
    const mm = g.node((self, a, b) => {
      const xv = x.v, dv = c.det.v, qv = c.q1.v, fv = fama.v, pv = phase.v, v = self.v;
      for (let i = a; i < b; i++) {
        if (i < c.S) { v[i] = fv[i] = pv[i] = 0; continue; }
        const i1 = dv[i - 3]!;
        const ph = i1 !== 0 ? Math.atan(qv[i]! / i1) * RAD2DEG : 0;
        pv[i] = ph;
        let d = pv[i - 1]! - ph;
        if (d < 1) d = 1;
        let alpha = fast;
        if (d > 1) {
          alpha = fast / d;
          if (alpha < slow) alpha = slow;
        }
        const m = (1 - alpha) * v[i - 1]! + alpha * xv[i]!;
        v[i] = m;
        const h = alpha * 0.5;
        fv[i] = (1 - h) * fv[i - 1]! + h * m;
      }
    });
    return [from(g, mm, FIRST_SHORT), from(g, fama, FIRST_SHORT)];
  },
  reference: "TA-Lib MAMA",
});
