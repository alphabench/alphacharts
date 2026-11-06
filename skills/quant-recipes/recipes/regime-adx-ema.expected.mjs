import { blank } from "./helpers.mjs";

export const inputs = { len: 14, trend: 25, span: 50 };

/** Wilder's ADX as TA-Lib defines it: sums seeded over len-1 bars, DX averaged over the next len, then smoothed. */
function adx(bars, len) {
  const n = bars.close.length;
  const out = blank(n);
  const pdm = [0], mdm = [0], tr = [0];
  for (let i = 1; i < n; i++) {
    const up = bars.high[i] - bars.high[i - 1], dn = bars.low[i - 1] - bars.low[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - bars.close[i - 1]), Math.abs(bars.low[i] - bars.close[i - 1])));
  }
  let sp = 0, sm = 0, st = 0;
  for (let i = 1; i < len; i++) { sp += pdm[i]; sm += mdm[i]; st += tr[i]; }
  const dx = [];
  for (let i = len; i < n; i++) {
    sp = sp - sp / len + pdm[i];
    sm = sm - sm / len + mdm[i];
    st = st - st / len + tr[i];
    const pdi = (100 * sp) / st, mdi = (100 * sm) / st;
    dx[i] = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    if (i === 2 * len - 1) out[i] = dx.slice(len, 2 * len).reduce((a, b) => a + b, 0) / len;
    else if (i > 2 * len - 1) out[i] = (out[i - 1] * (len - 1) + dx[i]) / len;
  }
  return out;
}

function ema(values, span) {
  const k = 2 / (span + 1);
  const out = blank(values.length);
  out[span - 1] = values.slice(0, span).reduce((a, b) => a + b, 0) / span; // seeded with the SMA of the first span closes
  for (let i = span; i < values.length; i++) out[i] = out[i - 1] + k * (values[i] - out[i - 1]);
  return out;
}

export function expected(bars, { len, trend, span }) {
  const a = adx(bars, len), e = ema(Array.from(bars.close), span);
  return { Regime: a.map((x, i) => (Number.isNaN(x) || Number.isNaN(e[i]) ? NaN : x > trend ? (bars.close[i] > e[i] ? 1 : -1) : 0)) };
}
