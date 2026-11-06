import { blank, mean } from "./helpers.mjs";

export const inputs = { len: 20, mult: 1.5 };

export function expected(bars, { len, mult }) {
  const n = bars.close.length;
  const rng = Array.from(bars.close, (_, i) => bars.high[i] - bars.low[i]);
  const flag = blank(n), mark = blank(n);
  for (let i = len - 1; i < n; i++) {
    flag[i] = rng[i] > mult * mean(rng.slice(i - len + 1, i + 1)) ? 1 : 0;
    if (flag[i] === 1) mark[i] = 1; // plotshape puts 1 on a marked bar and na elsewhere
  }
  return { Flag: flag, "Wide bar": mark };
}
