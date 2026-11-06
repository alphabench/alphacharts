import { NA, div, mean, popVar, returns, rolling } from "./helpers.mjs";

export const inputs = { len: 60 };

/**
 * The market-neutral price, from its definition: start at the close of the first bar whose hedge (beta) is known, then on each
 * bar multiply by 1 + (own return - beta * index return). A bar with no hedged return draws nothing and adds nothing.
 * Hand case: base 100, hedged returns +0.01 then -0.02 give 100, 101, 98.98.
 */
function neutral(close, excess) {
  const out = [];
  let level = NA;
  for (let i = 0; i < close.length; i++) {
    if (!Number.isNaN(excess[i])) level = Number.isNaN(level) ? close[i] : level * (1 + excess[i]);
    out.push(Number.isNaN(excess[i]) ? NA : level);
  }
  return out;
}
const hand = neutral([100, 100, 100], [0.01, 0.01, -0.02]);
if (hand[0] !== 100 || Math.abs(hand[1] - 101) > 1e-12 || Math.abs(hand[2] - 98.98) > 1e-12) throw new Error("neutral() disagrees with the hand-worked 100, 101, 98.98");

export function expected(bars, { len }, ctx) {
  const close = Array.from(bars.close);
  const idx = ctx.outside("IDX", "close");
  const ra = returns(close);
  const rb = returns(idx);
  const prod = ra.map((v, i) => v * rb[i]);
  const ma = rolling(ra, len, mean), mb = rolling(rb, len, mean);
  const num = rolling(prod, len, mean).map((m, i) => m - ma[i] * mb[i]);
  const den = rolling(rb, len, popVar);
  const beta = num.map((n, i) => (Number.isNaN(n) ? NA : div(n, den[i])));
  const excess = ra.map((r, i) => r - beta[i] * rb[i]);
  return { "Market-neutral price": neutral(close, excess) };
}
