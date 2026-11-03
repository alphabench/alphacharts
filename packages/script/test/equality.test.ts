// A script must produce exactly (bit for bit, NaN positions included) what the
// equivalent built-in study produces: both run the same kernels.

import { describe, it } from "vitest";
import { builtin, DATA, run, runStudy, same } from "./support.js";

/** [built-in id, its inputs, the script call that is the same computation] */
const CALLS: [string, Record<string, number | string | boolean>, string][] = [
  ["sma", { length: 20 }, "ta.sma(close, 20)"],
  ["ema", { length: 12 }, "ta.ema(close, 12)"],
  ["wma", { length: 9 }, "ta.wma(close, 9)"],
  ["dema", { length: 9 }, "ta.dema(close, 9)"],
  ["tema", { length: 9 }, "ta.tema(close, 9)"],
  ["trima", { length: 30 }, "ta.trima(close, 30)"],
  ["kama", { length: 10 }, "ta.kama(close, 10)"],
  ["t3", { length: 5 }, "ta.t3(close, 5)"],
  ["hma", { length: 21 }, "ta.hma(close, 21)"],
  ["rsi", { length: 14 }, "ta.rsi(close, 14)"],
  ["rsi", { length: 7, source: "hl2" }, "ta.rsi(hl2, 7)"],
  ["macd", {}, "ta.macd(close, 12, 26, 9)"],
  ["ppo", {}, "ta.ppo(close, 12, 26, 9)"],
  ["bbands", { length: 20 }, "ta.bbands(close, 20, 2, 2, \"sma\")"],
  ["atr", { length: 14 }, "ta.atr(14)"],
  ["natr", { length: 14 }, "ta.natr(14)"],
  ["trange", {}, "ta.trange()"],
  ["mom", { length: 10 }, "ta.mom(close, 10)"],
  ["roc", { length: 9 }, "ta.roc(close, 9)"],
  ["cci", { length: 20 }, "ta.cci(20)"],
  ["stoch", {}, "ta.stoch()"],
  ["adx", { length: 14 }, "ta.adx(14)"],
  ["aroon", { length: 25 }, "ta.aroon(25)"],
  ["supertrend", {}, "ta.supertrend()"],
  ["keltner", {}, "ta.keltner()"],
  ["donchian", { length: 20 }, "ta.donchian(20)"],
  ["linearreg", { length: 14 }, "ta.linearreg(close, 14)"],
  ["tsf", { length: 14 }, "ta.tsf(close, 14)"],
  ["cmo", { length: 9 }, "ta.cmo(close, 9)"],
  ["trix", { length: 18 }, "ta.trix(close, 18)"],
  ["obv", {}, "ta.obv()"],
  ["mfi", { length: 14 }, "ta.mfi(14)"],
  ["vwma", { length: 20 }, "ta.vwma(close, 20)"],
  ["sar", {}, "ta.sar()"],
  ["typprice", {}, "hlc3"],
  ["medprice", {}, "hl2"],
  ["avgprice", {}, "ohlc4"],
  ["wclprice", {}, "ta.wclprice()"],
  ["stddev", { length: 5 }, "ta.stdev(close, 5)"],
  ["var", { length: 5 }, "ta.variance(close, 5)"],
  ["midprice", { length: 14 }, "(ta.highest(high, 14) + ta.lowest(low, 14)) / 2"],
];

describe("script == built-in study", () => {
  for (const [id, inputs, call] of CALLS) {
    it(`${id} ${JSON.stringify(inputs)}`, () => {
      const def = builtin(id);
      const want = runStudy(def, inputs, DATA);
      const src = want.length === 1
        ? `plot(${call})`
        : `[${want.map((_, k) => `c${k}`).join(", ")}] = ${call}\n${want.map((_, k) => `plot(c${k}, "c${k}")`).join("\n")}`;
      const got = run(src);
      same(got[0]!, want[0]!);
      want.forEach((w, k) => same(got[k]!, w));
    });
  }

  it("willr written out in the language", () => {
    same(run(`hh = ta.highest(high, 14)
ll = ta.lowest(low, 14)
r = hh - ll
plot(na(r) or r == 0 ? na : (-100 * (hh - close)) / r)`)[0]!, runStudy(builtin("willr"), { length: 14 }, DATA)[0]!);
  });

  it("obv with var and history", () => {
    same(run(`var float acc = 0.0
acc := bar_index == 0 ? volume : nz(acc[1]) + (close > close[1] ? volume : close < close[1] ? -volume : 0.0)
plot(acc)`)[0]!, runStudy(builtin("obv"), {}, DATA)[0]!);
  });

  it("sma by an input equals the built-in with that input", () => {
    same(run("len = input.int(30, minval=1)\nplot(ta.sma(close, len))", { len: 7 })[0]!, runStudy(builtin("sma"), { length: 7 }, DATA)[0]!);
  });

  it("ta.bb is the middle/upper/lower of bbands", () => {
    const want = runStudy(builtin("bbands"), { length: 20 }, DATA);
    const got = run("[m, u, l] = ta.bb(close, 20, 2)\nplot(m)\nplot(u)\nplot(l)");
    same(got[0]!, want[1]!); same(got[1]!, want[0]!); same(got[2]!, want[2]!);
  });
});
