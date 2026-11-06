export function expected(_bars, _inputs, ctx) {
  return {
    "Previous high": ctx.outside(null, "high", "1d"),
    "Previous low": ctx.outside(null, "low", "1d"),
    "Previous close": ctx.outside(null, "close", "1d"),
  };
}
