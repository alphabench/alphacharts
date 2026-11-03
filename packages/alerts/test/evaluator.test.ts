// Deterministic replays: fixed tick sequences, exact trigger times and values
// for every condition and trigger mode.

import { describe, expect, it } from "vitest";
import { AlertEvaluator, evaluate } from "../src/evaluator.js";
import { linePrice } from "../src/lines.js";
import type { AlertDefinition, Condition, DrawingGeometry, Tick, TriggerOptions } from "../src/types.js";

/** Tick i at time i·1000; `perBar` ticks share a bar (bar open time = first tick of the group). */
function ticks(prices: number[], perBar = 3, t0 = 0): Tick[] {
  return prices.map((price, i) => ({ time: t0 + i * 1000, price, bar: t0 + Math.floor(i / perBar) * perBar * 1000 }));
}

const alert = (condition: Condition, trigger: TriggerOptions = { mode: "everyTime" }, extra: Partial<AlertDefinition> = {}): AlertDefinition => ({ id: "a", condition, trigger, ...extra });
const times = (ts: ReturnType<typeof evaluate>) => ts.map((t) => t.time);

describe("crossing", () => {
  const seq = ticks([98, 99, 100, 101, 100, 99]);

  it("any direction: up at the touch (tick 2), back down at the next touch (tick 4)", () => {
    const out = evaluate([alert({ type: "crossing", price: 100, direction: "any" })], seq);
    expect(out.map((t) => [t.time, t.price, t.prevPrice, t.values.level])).toEqual([[2000, 100, 99, 100], [4000, 100, 101, 100]]);
    expect(out.map((t) => t.seq)).toEqual([1, 2]);
  });

  it("crossing up only", () => {
    expect(times(evaluate([alert({ type: "crossing", price: 100, direction: "up" })], seq))).toEqual([2000]);
  });

  it("crossing down only", () => {
    expect(times(evaluate([alert({ type: "crossing", price: 100, direction: "down" })], seq))).toEqual([4000]);
  });

  it("falling through the level", () => {
    const out = evaluate([alert({ type: "crossing", price: 100, direction: "down" })], ticks([102, 101, 99.5, 99]));
    expect(out.map((t) => [t.time, t.price, t.prevPrice])).toEqual([[2000, 99.5, 101]]);
  });

  it("jumping over the level counts", () => {
    expect(times(evaluate([alert({ type: "crossing", price: 100, direction: "up" })], ticks([99, 103])))).toEqual([1000]);
  });

  it("a first tick exactly on the level is not a cross; leaving it is not either", () => {
    expect(evaluate([alert({ type: "crossing", price: 100, direction: "any" })], ticks([100, 101, 102]))).toEqual([]);
  });

  it("a touch and retreat is a cross up then a cross back down", () => {
    expect(times(evaluate([alert({ type: "crossing", price: 100, direction: "any" })], ticks([99, 100, 99])))).toEqual([1000, 2000]);
  });
});

describe("crossing: sitting on the level", () => {
  const c = (direction: "any" | "up" | "down") => alert({ type: "crossing", price: 100, direction });
  it("fires once when price reaches the level and stays there", () => {
    expect(times(evaluate([c("any")], ticks([99, 100, 100, 100, 100])))).toEqual([1000]);
    expect(times(evaluate([c("up")], ticks([99, 100, 100, 100, 100])))).toEqual([1000]);
  });
  it("touch then continue is one cross; touch then retreat is a cross back", () => {
    expect(times(evaluate([c("any")], ticks([99, 100, 100, 101, 102])))).toEqual([1000]);
    expect(times(evaluate([c("any")], ticks([99, 100, 100, 99])))).toEqual([1000, 3000]);
  });
});

describe("indicator crossover", () => {
  it("fires when the other indicator moves through", () => {
    const a = [10, 10], b = [11, 9];
    const env = { indicators: { a: (t: Tick) => a[t.time / 1000], b: (t: Tick) => b[t.time / 1000] } };
    expect(times(evaluate([alert({ type: "indicator", id: "a", op: "crossingUp", value: { id: "b" } })], ticks([1, 1]), env))).toEqual([1000]);
  });
});

describe("one broken alert", () => {
  it("does not discard another alert's trigger on the same tick", () => {
    const env = { indicators: { bad: () => Number.NaN } };
    const ev = new AlertEvaluator([{ ...alert({ type: "greaterThan", price: 1 }), id: "ok" }, { ...alert({ type: "indicator", id: "bad", op: "greaterThan", value: 0 }), id: "bad" }], env);
    expect(ev.tick({ time: 0, price: 2, bar: 0 }).map((t) => t.alertId)).toEqual(["ok"]);
    expect(ev.status("bad")).toBe("error");
    expect(ev.error("bad")).toMatch(/non-finite/);
  });
  it("persists runtime state so a restart does not re-fire a spent alert", () => {
    const a = new AlertEvaluator([alert({ type: "greaterThan", price: 1 }, { mode: "once" })]);
    a.tick({ time: 0, price: 2, bar: 0 });
    const b = new AlertEvaluator();
    const rt = a.runtime()[0]!;
    b.add(a.definitions()[0]!, rt.status, rt);
    expect(b.tick({ time: 1, price: 2, bar: 0 })).toEqual([]);
  });
});

describe("greater / less", () => {
  const seq = ticks([99, 100, 101, 102, 99]);
  it("greater than fires while it holds (strictly)", () => {
    expect(times(evaluate([alert({ type: "greaterThan", price: 100 })], seq))).toEqual([2000, 3000]);
  });
  it("less than", () => {
    expect(times(evaluate([alert({ type: "lessThan", price: 100 })], seq))).toEqual([0, 4000]);
  });
});

describe("channels", () => {
  const seq = ticks([95, 99, 100, 105, 110, 111, 112, 109]);
  it("entering: from outside to inside, bounds inclusive", () => {
    const out = evaluate([alert({ type: "enteringChannel", low: 100, high: 110 })], seq);
    expect(out.map((t) => [t.time, t.price, t.values.low, t.values.high])).toEqual([[2000, 100, 100, 110], [7000, 109, 100, 110]]);
  });
  it("exiting: from inside to outside", () => {
    const out = evaluate([alert({ type: "exitingChannel", low: 100, high: 110 })], seq);
    expect(out.map((t) => [t.time, t.price])).toEqual([[5000, 111]]);
  });
  it("starting inside is not an entry", () => {
    expect(evaluate([alert({ type: "enteringChannel", low: 100, high: 110 })], ticks([105, 106]))).toEqual([]);
  });
});

describe("moving within N bars", () => {
  // bars of two ticks each: [100, 100.5] [101, 101.5] [102.5, 102.6]
  const seq = ticks([100, 100.5, 101, 101.5, 102.5, 102.6], 2);
  it("up by an amount within 3 bars: the window low is 100, so 102.5 is +2.5", () => {
    const out = evaluate([alert({ type: "moving", direction: "up", bars: 3, amount: 2 })], seq);
    expect(out.map((t) => [t.time, t.price, t.values.windowLow, t.values.move, t.values.threshold])).toEqual([[4000, 102.5, 100, 2.5, 2], [5000, 102.6, 100, 102.6 - 100, 2]]);
  });
  it("within 2 bars the first bar has left the window: the low is 101, so only +1.5 / +1.6", () => {
    expect(evaluate([alert({ type: "moving", direction: "up", bars: 2, amount: 2 })], seq)).toEqual([]);
    expect(times(evaluate([alert({ type: "moving", direction: "up", bars: 2, amount: 1.55 })], seq))).toEqual([5000]);
  });
  it("by percent of the window low: 2 % of 100 = 2", () => {
    const out = evaluate([alert({ type: "moving", direction: "up", bars: 3, percent: 2 })], seq);
    expect(out[0]!.values.threshold).toBe(2);
    expect(out[0]!.time).toBe(4000);
  });
  it("down by an amount from the window high", () => {
    const prices = [110, 109, 108, 106.5, 106.9, 106.8];
    // 2 bars: when the second bar arrives only [110,109] and [108,106.5] exist: high 110, move 3.5. Then the first bar leaves: high 108.
    const two = evaluate([alert({ type: "moving", direction: "down", bars: 2, amount: 3 })], ticks(prices, 2));
    expect(two.map((t) => [t.time, t.price, t.values.windowHigh, t.values.move])).toEqual([[3000, 106.5, 110, 110 - 106.5]]);
    const three = evaluate([alert({ type: "moving", direction: "down", bars: 3, amount: 3 })], ticks(prices, 2));
    expect(three.map((t) => [t.time, t.price, t.values.windowHigh, t.values.move])).toEqual([[3000, 106.5, 110, 110 - 106.5], [4000, 106.9, 110, 110 - 106.9], [5000, 106.8, 110, 110 - 106.8]]);
  });
});

describe("indicators", () => {
  const rsi = new Map<number, number>([[0, 65], [1000, 68], [2000, 71], [3000, 69], [4000, 72]]);
  const env = { indicators: { rsi: (t: Tick) => rsi.get(t.time), fast: (t: Tick) => t.price, slow: () => 100 } };
  const seq = ticks([1, 2, 3, 4, 5]);

  it("crossing up a number", () => {
    const out = evaluate([alert({ type: "indicator", id: "rsi", op: "crossingUp", value: 70 })], seq, env);
    expect(out.map((t) => [t.time, t.values.value, t.values.level])).toEqual([[2000, 71, 70], [4000, 72, 70]]);
  });

  it("greater than / crossing down", () => {
    expect(times(evaluate([alert({ type: "indicator", id: "rsi", op: "greaterThan", value: 70 })], seq, env))).toEqual([2000, 4000]);
    expect(times(evaluate([alert({ type: "indicator", id: "rsi", op: "crossingDown", value: 70 })], seq, env))).toEqual([3000]);
  });

  it("one indicator crossing another", () => {
    const px = ticks([98, 99, 101, 102]);
    expect(times(evaluate([alert({ type: "indicator", id: "fast", op: "crossingUp", value: { id: "slow" } })], px, env))).toEqual([2000]);
  });

  it("a tick without an indicator value is skipped, not treated as zero", () => {
    const sparse = { indicators: { rsi: (t: Tick) => (t.time === 1000 ? undefined : rsi.get(t.time)) } };
    // 65 (tick 0), gap (tick 1), 71 (tick 2): the cross is seen across the gap
    expect(times(evaluate([alert({ type: "indicator", id: "rsi", op: "crossingUp", value: 70 })], seq, sparse))).toEqual([2000, 4000]);
  });

  it("an unknown indicator is refused when the alert is added", () => {
    expect(() => new AlertEvaluator([alert({ type: "indicator", id: "macd", op: "greaterThan", value: 0 })], env)).toThrow(/"macd" is not provided/);
  });
});

describe("drawing lines", () => {
  const trend: DrawingGeometry = { id: "t", tool: "trendLine", anchors: [{ time: 0, price: 100 }, { time: 10_000, price: 110 }], extendLeft: false, extendRight: false };

  it("line price is linear in time between the anchors; outside a segment there is none", () => {
    expect(linePrice(trend, "main", 0)).toBe(100);
    expect(linePrice(trend, "main", 4000)).toBe(104);
    expect(linePrice(trend, "main", 10_000)).toBe(110);
    expect(linePrice(trend, "main", 11_000)).toBeUndefined();
    expect(linePrice({ ...trend, extendRight: true }, "main", 11_000)).toBe(111);
    expect(linePrice({ ...trend, tool: "ray" }, "main", -1000)).toBeUndefined();
    expect(linePrice({ ...trend, tool: "extendedLine" }, "main", -1000)).toBe(99);
  });

  it("horizontal lines, rays and channels", () => {
    const h: DrawingGeometry = { id: "h", tool: "horizontalLine", anchors: [{ time: 5000, price: 105 }], extendLeft: false, extendRight: false };
    expect(linePrice(h, "main", 0)).toBe(105);
    expect(linePrice({ ...h, tool: "horizontalRay" }, "main", 0)).toBeUndefined();
    expect(linePrice({ ...h, tool: "horizontalRay" }, "main", 6000)).toBe(105);
    const ch: DrawingGeometry = { id: "c", tool: "parallelChannel", anchors: [{ time: 0, price: 100 }, { time: 10_000, price: 110 }, { time: 5000, price: 109 }], extendLeft: false, extendRight: false };
    // baseline at t=5000 is 105; the third anchor is 109 → offset +4
    expect(linePrice(ch, "base", 5000)).toBe(105);
    expect(linePrice(ch, "offset", 5000)).toBe(109);
    expect(linePrice(ch, "middle", 5000)).toBe(107);
    expect(linePrice(ch, "offset", 0)).toBe(104);
  });

  it("price crossing the trend line is judged against the line at the tick's bar time", () => {
    // bars of 2 ticks at 1 s: bar 0 line = 100, bar 2000 line = 102, bar 4000 line = 104
    const seq = ticks([99, 100.5, 101.5, 102.5, 103.5, 104.5], 2);
    const out = evaluate([alert({ type: "drawing", drawing: trend, line: "main", op: "crossingUp" })], seq);
    expect(out.map((t) => [t.time, t.bar, t.price, t.values.line])).toEqual([
      [1000, 0, 100.5, 100],
      [3000, 2000, 102.5, 102],
      [5000, 4000, 104.5, 104],
    ]);
  });

  it("price re-crossing a line that moved under it is not a cross", () => {
    // price sits at 101: line at 100 (below), then 102 (above): no price move, no cross
    const seq = [{ time: 0, price: 101, bar: 0 }, { time: 1000, price: 101, bar: 0 }, { time: 2000, price: 101, bar: 2000 }];
    expect(evaluate([alert({ type: "drawing", drawing: trend, line: "main", op: "crossing" })], seq)).toEqual([]);
  });

  it("a tick where the line does not exist is skipped", () => {
    const seq = [{ time: 11_000, price: 120, bar: 11_000 }, { time: 12_000, price: 90, bar: 12_000 }];
    expect(evaluate([alert({ type: "drawing", drawing: trend, line: "main", op: "crossing" })], seq)).toEqual([]);
  });

  it("entering and exiting a channel drawing", () => {
    const ch: DrawingGeometry = { id: "c", tool: "parallelChannel", anchors: [{ time: 0, price: 100 }, { time: 10_000, price: 100 }, { time: 0, price: 110 }], extendLeft: false, extendRight: true };
    const seq = ticks([95, 101, 105, 111, 109]);
    expect(times(evaluate([alert({ type: "drawing", drawing: ch, line: "base", op: "enteringChannel" })], seq))).toEqual([1000, 4000]);
    expect(times(evaluate([alert({ type: "drawing", drawing: ch, line: "base", op: "exitingChannel" })], seq))).toEqual([3000]);
  });

  it("an unsupported tool or line is refused", () => {
    expect(() => new AlertEvaluator([alert({ type: "drawing", drawing: { ...trend, tool: "rectangle" }, line: "main", op: "crossing" })])).toThrow(/no alertable line/);
    expect(() => new AlertEvaluator([alert({ type: "drawing", drawing: trend, line: "upper", op: "crossing" })])).toThrow(/no line "upper"/);
  });

  it("a bar-index geometry (logical) is honoured", () => {
    // bars 0..9 at times 0,1,2,3,10,11,12,13,14,15 (a gap); the line runs from bar index 0 to 9
    const times10 = [0, 1, 2, 3, 10, 11, 12, 13, 14, 15];
    const logical = (t: number) => {
      const i = times10.findIndex((x) => x >= t);
      return i < 0 ? times10.length - 1 : i;
    };
    const g: DrawingGeometry = { id: "t", tool: "trendLine", anchors: [{ time: 0, price: 100 }, { time: 15, price: 109 }], extendLeft: false, extendRight: false };
    expect(linePrice(g, "main", 10, logical)).toBe(104); // bar index 4: 100 + 9·4/9
    expect(linePrice(g, "main", 10)).toBeCloseTo(100 + (9 * 10) / 15, 12); // straight in time
  });
});

describe("trigger modes", () => {
  // bars of 3 ticks: [99,101,99] [101,99,101] [102,103,104]; level 100 on greaterThan
  const seq = ticks([99, 101, 99, 101, 99, 101, 102, 103, 104]);
  const cond: Condition = { type: "greaterThan", price: 100 };

  it("every time", () => {
    expect(times(evaluate([alert(cond)], seq))).toEqual([1000, 3000, 5000, 6000, 7000, 8000]);
  });

  it("once: the first, then the alert is spent", () => {
    const ev = new AlertEvaluator([alert(cond, { mode: "once" })]);
    const out = seq.flatMap((t) => ev.tick(t));
    expect(times(out)).toEqual([1000]);
    expect(ev.status("a")).toBe("triggered");
  });

  it("once per bar: the first firing tick of each bar", () => {
    const out = evaluate([alert(cond, { mode: "oncePerBar" })], seq);
    expect(out.map((t) => [t.time, t.bar])).toEqual([[1000, 0], [3000, 3000], [6000, 6000]]);
  });

  it("once per bar close: evaluated on each bar's last tick, reported when the next bar's first tick arrives", () => {
    // closes: bar 0 → 99, bar 1 → 101, bar 2 → 104 (closed by closeBar)
    const ev = new AlertEvaluator([alert(cond, { mode: "oncePerBarClose" })]);
    const out = [...seq.flatMap((t) => ev.tick(t)), ...ev.closeBar(9000)];
    expect(out.map((t) => [t.time, t.bar, t.price, t.prevPrice])).toEqual([[6000, 3000, 101, 99], [9000, 6000, 104, 101]]);
  });

  it("bar-close crossing sees closes only: an intrabar cross that reverses is invisible", () => {
    const seq2 = ticks([99, 101, 99, 99, 99, 99, 101, 102, 103], 3); // closes 99, 99, 103
    const ev = new AlertEvaluator([alert({ type: "crossing", price: 100, direction: "up" }, { mode: "oncePerBarClose" })]);
    const out = [...seq2.flatMap((t) => ev.tick(t)), ...ev.closeBar(9000)];
    expect(out.map((t) => [t.time, t.bar, t.price, t.prevPrice])).toEqual([[9000, 6000, 103, 99]]);
  });

  it("debounce suppresses triggers inside the window without spending a once-alert", () => {
    const out = evaluate([alert({ type: "greaterThan", price: 100 }, { mode: "everyTime", debounceMs: 2500 })], ticks([101, 101, 101, 101, 101, 101, 101], 10));
    expect(times(out)).toEqual([0, 3000, 6000]);
    const ev = new AlertEvaluator([alert(cond, { mode: "once", debounceMs: 10_000 })]);
    ev.tick({ time: 0, price: 99, bar: 0 });
    expect(ev.tick({ time: 1000, price: 101, bar: 0 })).toHaveLength(1);
  });

  it("expiry: no trigger at or after expiresAt, and the status says so", () => {
    const ev = new AlertEvaluator([alert({ type: "greaterThan", price: 100 }, { mode: "everyTime" }, { expiresAt: 2500 })]);
    const out = ticks([101, 101, 101, 101]).flatMap((t) => ev.tick(t));
    expect(times(out)).toEqual([0, 1000, 2000]);
    expect(ev.status("a")).toBe("expired");
  });
});

describe("input discipline", () => {
  it("rejects out-of-order ticks, bars that reopen, and non-finite values", () => {
    const ev = new AlertEvaluator([alert({ type: "greaterThan", price: 1 })]);
    ev.tick({ time: 2000, price: 1, bar: 0 });
    expect(() => ev.tick({ time: 1000, price: 1, bar: 0 })).toThrow(/before the previous tick/);
    ev.tick({ time: 3000, price: 1, bar: 3000 });
    expect(() => ev.tick({ time: 3500, price: 1, bar: 0 })).toThrow(/already closed/);
    ev.tick({ time: 3600, price: 1, bar: 9000 });
    expect(() => ev.tick({ time: 3700, price: 1, bar: 5000 })).toThrow(/after bar 9000 started/);
    expect(() => ev.tick({ time: 4000, price: Number.NaN, bar: 9000 })).toThrow(/finite/);
    ev.closeBar(4000);
    expect(() => ev.tick({ time: 5000, price: 1, bar: 9000 })).toThrow(/already closed/);
  });

  it("resetClock starts a new tick series: earlier bars and times are accepted, status and counts stay, remembered prices go", () => {
    const ev = new AlertEvaluator([alert({ type: "crossing", price: 100, direction: "up" }, { mode: "oncePerBar" }), alert({ type: "greaterThan", price: 1e9 }, { mode: "everyTime" }, { id: "b" })]);
    ev.tick({ time: 9000, price: 99, bar: 9000 });
    expect(ev.tick({ time: 9500, price: 101, bar: 9000 }).map((t) => t.alertId)).toEqual(["a"]);
    expect(() => ev.tick({ time: 100, price: 99, bar: 0 })).toThrow(/before the previous tick/); // what an interval switch used to hit
    ev.resetClock();
    // a new series at lower times and bars; the 101 -> 99 -> 101 path must not count the old series' last price
    expect(ev.tick({ time: 100, price: 101, bar: 0 })).toEqual([]);
    expect(ev.tick({ time: 200, price: 99, bar: 0 })).toEqual([]);
    expect(ev.tick({ time: 300, price: 101, bar: 0 }).map((t) => [t.alertId, t.bar, t.seq])).toEqual([["a", 0, 2]]); // not blocked by the old series' last trigger bar; count continues
    expect(ev.status("a")).toBe("active");
  });

  it("resetClock({ keepTriggerBars }) does not let a once-per-bar alert fire twice on its bar", () => {
    const ev = new AlertEvaluator([alert({ type: "greaterThan", price: 1 }, { mode: "oncePerBar" })]);
    expect(ev.tick({ time: 100, price: 2, bar: 0 })).toHaveLength(1);
    ev.resetClock({ keepTriggerBars: true });
    expect(ev.tick({ time: 200, price: 2, bar: 0 })).toEqual([]);
    ev.resetClock();
    expect(ev.tick({ time: 300, price: 2, bar: 0 })).toHaveLength(1);
  });

  it("refuses invalid definitions with the reason", () => {
    const bad = (c: Condition, t: TriggerOptions = { mode: "once" }) => () => new AlertEvaluator([alert(c, t)]);
    expect(bad({ type: "enteringChannel", low: 10, high: 10 })).toThrow(/low < high/);
    expect(bad({ type: "moving", direction: "up", bars: 0, amount: 1 })).toThrow(/bars ≥ 1/);
    expect(bad({ type: "moving", direction: "up", bars: 2 })).toThrow(/exactly one of amount and percent/);
    expect(bad({ type: "moving", direction: "up", bars: 2, amount: 1, percent: 1 })).toThrow(/exactly one/);
    expect(bad({ type: "crossing", price: Number.NaN, direction: "any" })).toThrow(/finite/);
    expect(bad({ type: "crossing", price: 1, direction: "any" }, { mode: "sometimes" as never })).toThrow(/trigger mode/);
    expect(bad({ type: "crossing", price: 1, direction: "any" }, { mode: "once", debounceMs: -1 })).toThrow(/debounceMs/);
    expect(() => new AlertEvaluator([alert({ type: "greaterThan", price: 1 }), alert({ type: "greaterThan", price: 2 })])).toThrow(/duplicate/);
  });
});

describe("serialization", () => {
  const defs: AlertDefinition[] = [
    { id: "x", label: "cross", condition: { type: "crossing", price: 100, direction: "up" }, trigger: { mode: "everyTime", debounceMs: 0 }, expiresAt: null },
    { id: "y", condition: { type: "moving", direction: "down", bars: 3, percent: 1.5 }, trigger: { mode: "oncePerBar" } },
    { id: "z", condition: { type: "drawing", line: "main", op: "crossingDown", drawing: { id: "t", tool: "trendLine", anchors: [{ time: 0, price: 100 }, { time: 9000, price: 90 }], extendLeft: false, extendRight: true } }, trigger: { mode: "once" } },
  ];
  const seq = ticks([98, 101, 99, 100.5, 98, 97, 96, 95, 94, 93, 92, 91]);

  it("JSON round trip gives the same definitions and the same triggers", () => {
    const a = new AlertEvaluator(defs);
    const json = JSON.parse(JSON.stringify(a.toJSON()));
    expect(json.version).toBe(1);
    const b = new AlertEvaluator(json.alerts);
    expect(b.definitions()).toEqual(a.definitions());
    const direct = evaluate(defs, seq);
    expect(direct.length).toBeGreaterThan(0);
    expect(seq.flatMap((t) => b.tick(t))).toEqual(direct);
  });
});
