// Incremental == batch for scripts: bars appended one at a time with random
// last-bar revisions leave exactly the columns a one-shot batch run gives.

import { describe, expect, it } from "vitest";
import { StudyEngine, type BarInput } from "@alphacharts/indicators";
import { ok } from "./support.js";
import { randomBars, rng } from "../../indicators/test/support.js";

const SCRIPTS: Record<string, string> = {
  pure: "plot(ta.ema(close, 9) - ta.sma(close, 20))",
  macd: "[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(s)\nplot(h)",
  counter: "var n = 0\nn := n + 1\nplot(n)",
  obv: "var float acc = 0.0\nacc := bar_index == 0 ? volume : nz(acc[1]) + (close > close[1] ? volume : close < close[1] ? -volume : 0.0)\nplot(acc)",
  trail: `var float stop = na
float s = ta.sma(close, 10)
if na(stop)
    stop := s
else
    stop := close > stop ? math.max(stop, s) : math.min(stop, s)
plot(stop)`,
  loop: `float acc = 0.0
for k = 0 to 4
    acc += nz(close[k])
plot(acc / 5)`,
  cross: "plotshape(ta.crossover(close, ta.sma(close, 10)), style=shape.triangleup, location=location.belowbar)\nplot(close)",
  state_cross: `var float f = 0.0
f := nz(f[1]) + (close - nz(f[1])) * 0.2
plotshape(ta.crossover(close, f))
plot(f)`,
};

const bar = (d: ReturnType<typeof randomBars>, i: number): BarInput => ({ time: d.time[i]!, open: d.open[i]!, high: d.high[i]!, low: d.low[i]!, close: d.close[i]!, volume: d.volume[i]! });
function wiggle(b: BarInput, r: () => number): BarInput {
  const c = b.close * (1 + (r() - 0.5) * 0.01);
  return { time: b.time, open: b.open, close: c, high: Math.max(b.open, c, b.high) + r(), low: Math.max(0.01, Math.min(b.open, c, b.low) - r()), volume: Math.round(b.volume * (0.5 + r())) };
}

describe("incremental == batch (with revisions)", () => {
  for (const [name, src] of Object.entries(SCRIPTS)) {
    it(name, () => {
      const N = 300;
      const d = randomBars(N, 4321);
      const r = rng(7);
      const def = ok(src).study;
      const batch = new StudyEngine(def);
      batch.load(d);
      const live = new StudyEngine(def);
      for (let i = 0; i < N; i++) {
        const b = bar(d, i);
        live.push(wiggle(b, r));
        for (let k = r() * 4; k > 0; k--) live.reviseLast(wiggle(b, r));
        live.reviseLast(b);
      }
      expect(live.length).toBe(N);
      for (let k = 0; k < def.columns.length; k++) {
        const a = batch.column(k), b = live.column(k);
        for (let i = 0; i < N; i++) if (!Object.is(a[i], b[i]) && a[i] !== b[i]) throw new Error(`${name}.${def.columns[k]}[${i}]: batch ${a[i]}, incremental ${b[i]}`);
      }
    });
  }
  it("a script produced values at all", () => {
    const d = randomBars(100, 1);
    const e = new StudyEngine(ok(SCRIPTS.trail!).study);
    e.load(d);
    expect(Array.from(e.column(0)).filter((v) => v === v).length).toBeGreaterThan(80);
  });
});
