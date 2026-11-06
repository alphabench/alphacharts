import { NA, div } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }, ctx) {
  const sector = ctx.outside("SECT", "close");
  return {
    "Excess return, percent": Array.from(bars.close, (c, i) => (i < len ? NA : 100 * ((div(c, bars.close[i - len]) - 1) - (div(sector[i], sector[i - len]) - 1)))),
  };
}
