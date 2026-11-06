import { blank } from "./helpers.mjs";

export const inputs = { len: 20 };

export function expected(bars, { len }) {
  const n = bars.close.length;
  // the whole bar's volume goes to the side its close chose; a doji bar (close == open) counts for neither
  const delta = Array.from(bars.close, (c, i) => (c > bars.open[i] ? bars.volume[i] : c < bars.open[i] ? -bars.volume[i] : 0));
  const total = [], rolling = blank(n);
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += delta[i];
    total.push(run);
    if (i >= len - 1) rolling[i] = delta.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0);
  }
  return { CVD: total, "Rolling delta": rolling };
}
