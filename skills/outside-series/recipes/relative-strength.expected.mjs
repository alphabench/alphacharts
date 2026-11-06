import { NA, div } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }, ctx) {
  const idx = ctx.outside("IDX", "close");
  const rs = bars.close.map((c, i) => div(c, idx[i]));
  return { "Relative strength": rs.map((v, i) => (i < len ? NA : div(100 * v, rs[i - len]))) };
}
