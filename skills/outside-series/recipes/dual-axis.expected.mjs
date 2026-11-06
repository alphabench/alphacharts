export const inputs = {};

// The other series' own close, on the chart's bars: nothing is computed on it, only drawn on the left axis.
export function expected(bars, _inputs, ctx) {
  return { "Other series": Array.from(ctx.outside("IDX", "close")) };
}
