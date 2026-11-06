export const inputs = { q: 0.0001, r: 1.0 };

export function expected(bars, { q, r }, ctx) {
  const x = ctx.outside("AAA", "close");
  let beta = 1.0, p = 1.0;
  const out = [];
  for (let i = 0; i < bars.close.length; i++) {
    if (!Number.isNaN(x[i]) && !Number.isNaN(bars.close[i])) {
      const pp = p + q;
      const k = (pp * x[i]) / (x[i] * x[i] * pp + r);
      beta = beta + k * (bars.close[i] - beta * x[i]);
      p = (1 - k * x[i]) * pp;
    }
    out.push(beta);
  }
  return { Beta: out };
}
