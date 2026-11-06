// outside(symbol, field, timeframe): the plan lists every dependency without running anything, the join onto the
// chart's bars follows the rules of indicators/src/engine/feed.ts (proved there; here through scripts), incremental
// == batch holds with feed ticks, a value on a finished bar never depends on later bars (lookahead), and the worker
// sandbox takes the columns with its limits and its lockdown unchanged.

import { describe, expect, it } from "vitest";
import { StudyEngine, type BarColumns, type BarInput, type FeedBars, type WorkerLike } from "@alphacharts/indicators";
import { alignFor, compile, DEFAULT_LIMITS, feedKey, feedsOf, parseTimeframe, ScriptRunner } from "../src/index.js";
import { BLOCKED_GLOBALS, serveScripts, withBridge, type FromWorker } from "../src/sandbox.js";
import { ok } from "./support.js";

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const T0 = 1_700_000_000_000;

const seeded = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
function ohlc(times: number[], f: (i: number) => number): Required<BarColumns> {
  const col = (g: (i: number) => number) => Float64Array.from(times.map((_, i) => g(i)));
  return { time: Float64Array.from(times), open: col((i) => f(i) - 0.5), high: col((i) => f(i) + 1), low: col((i) => f(i) - 1), close: col(f), volume: col((i) => 100 + i) };
}
const toBar = (b: BarColumns & { volume: Float64Array; open: Float64Array; high: Float64Array; low: Float64Array }, i: number): BarInput => ({ time: b.time[i]!, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]!, volume: b.volume[i]! });
const minutes = (n: number, from = 0) => Array.from({ length: n }, (_, i) => T0 + (from + i) * M);
const col = (e: StudyEngine, k = 0) => Array.from(e.column(k));

function engine(src: string, feeds: Record<string, { bars: FeedBars; align: "same" | "closed"; spanMs: number }>, chart: Required<BarColumns>): StudyEngine {
  const e = new StudyEngine(ok(src).study);
  for (const [k, f] of Object.entries(feeds)) e.setFeed(k, f.bars, f);
  e.load(chart);
  return e;
}

describe("the plan lists dependencies without running anything", () => {
  it("one entry per distinct (symbol, field, timeframe), in order, na and omitted alike", () => {
    const r = ok(`a = outside("NSE:AAA")
b = outside("NSE:AAA", "close")
c = outside("NSE:AAA", "volume")
d = outside(timeframe = "1d")
e = outside(na, "high", "1d")
f = outside("NSE:BBB", timeframe = "1h", field = "open")
plot(a + b + c + d + e + f)`);
    expect(r.plan.dependencies).toEqual([
      { symbol: "NSE:AAA", field: "close", timeframe: null },
      { symbol: "NSE:AAA", field: "volume", timeframe: null },
      { symbol: null, field: "close", timeframe: "1d" },
      { symbol: null, field: "high", timeframe: "1d" },
      { symbol: "NSE:BBB", field: "open", timeframe: "1h" },
    ]);
    expect(feedsOf(r.plan.dependencies)).toEqual([
      { key: feedKey("NSE:AAA", null), symbol: "NSE:AAA", timeframe: null, fields: ["close", "volume"] },
      { key: feedKey(null, "1d"), symbol: null, timeframe: "1d", fields: ["close", "high"] },
      { key: feedKey("NSE:BBB", "1h"), symbol: "NSE:BBB", timeframe: "1h", fields: ["open"] },
    ]);
  });
  it("a script that reads none has none, and the plan names barcolor / bgcolor and the axis", () => {
    const r = ok('indicator("t", overlay=true, scale="left")\nbarcolor(close > open, color.yellow)\nbgcolor(close < open, color.new(color.red, 80))\nplot(close)');
    expect(r.plan.dependencies).toEqual([]);
    expect(r.plan.scale).toBe("left");
    expect(r.plan.plots.map((p) => p.kind)).toEqual(["barcolor", "bgcolor", "line"]);
    expect(ok("plot(close)").plan.scale).toBe("right");
  });
  it("is read from the program: compiling never needs a feed, and an unloaded feed is absent, not an error", () => {
    const e = new StudyEngine(ok('plot(outside("X"))').study);
    e.load(ohlc(minutes(5), (i) => 10 + i));
    expect(col(e).every((v) => v !== v)).toBe(true);
  });
  it("the symbol is opaque: any printable text, kept exactly", () => {
    const r = ok('plot(outside("Bank Nifty \\"spot\\"; DROP"))');
    expect(r.plan.dependencies[0]!.symbol).toBe('Bank Nifty "spot"; DROP');
  });
  it("adds no name that reaches a host object", () => {
    // the language still names nothing: an outside series is data the host passes in, never a host object
    for (const name of ["fetch", "self", "globalThis", "request", "feed", "window"]) {
      const r = compile(`plot(${name}("X"))`);
      expect(r.ok).toBe(false);
    }
  });
});

describe("timeframes", () => {
  it("parses <n><unit> and nothing else", () => {
    expect(parseTimeframe("5m")).toBe(5 * M);
    expect(parseTimeframe("4h")).toBe(4 * H);
    expect(parseTimeframe("1d")).toBe(D);
    expect(parseTimeframe("1w")).toBe(7 * D);
    for (const bad of ["", "m", "0m", "5", "5x", "1D", "05m", "1.5h", " 5m", "5m ", "1000m"]) expect(parseTimeframe(bad)).toBeNull();
  });
  it("decides how an outside series joins a chart", () => {
    expect(alignFor(null, 5 * M)).toEqual({ align: "same", spanMs: 5 * M });
    expect(alignFor("5m", 5 * M)).toEqual({ align: "same", spanMs: 5 * M });
    expect(alignFor("15m", 5 * M)).toEqual({ align: "closed", spanMs: 15 * M });
    expect(alignFor("1d", 5 * M)).toEqual({ align: "closed", spanMs: D });
    expect(() => alignFor("1m", 5 * M)).toThrow(/shorter than the chart's bars/);
    expect(() => alignFor("soon", 5 * M)).toThrow(/not written like/);
    expect(() => alignFor(null, 0)).toThrow(/positive number of milliseconds/);
  });
});

describe("what a script computes from an outside series", () => {
  it("relative strength, a ratio with its average, arithmetic and ta.* of it, on matching bars", () => {
    const t = minutes(30);
    const chart = ohlc(t, (i) => 200 + i);
    const other = ohlc(t, (i) => 100 + 2 * i);
    const f = { "X\u0001": { bars: other, align: "same" as const, spanMs: M } };
    const rs = engine('plot(close / outside("X") * 100)', f, chart);
    expect(col(rs)[0]).toBeCloseTo((200 / 100) * 100, 12);
    expect(col(rs)[10]).toBeCloseTo((210 / 120) * 100, 12);
    const avg = engine('r = close / outside("X")\nplot(ta.sma(r, 3))', f, chart);
    expect(col(avg)[1]).toBeNaN();
    expect(col(avg)[2]).toBeCloseTo((200 / 100 + 201 / 102 + 202 / 104) / 3, 12);
    const vol = engine('plot(outside("X", "volume"))', f, chart);
    expect(col(vol)[4]).toBe(104);
  });
  it("a bar the other instrument has no bar for stays absent, and so does everything derived from it in a window", () => {
    const t = minutes(10);
    const other = ohlc(t.filter((_, i) => i !== 4), (i) => 50 + i);
    const e = engine('plot(outside("X"))\nplot(ta.sma(outside("X"), 3))', { "X\u0001": { bars: other, align: "same", spanMs: M } }, ohlc(t, () => 1));
    expect(col(e)[4]).toBeNaN();
    expect(col(e)[3]).toBe(53);
    expect(col(e)[5]).toBe(54);
    expect(col(e, 1)[4]).toBeNaN();
    expect(col(e, 1)[5]).toBeNaN(); // a series without a timeframe is read on the chart's bars: the window of 3 reaches the hole
    expect(col(e, 1)[7]).toBeCloseTo((54 + 55 + 56) / 3, 12);
  });
  it("a daily series on an intraday chart: previous-day levels and a return that only uses closed days", () => {
    const days = [0, 1, 2, 3].map((d) => T0 - (T0 % D) + d * D);
    const daily = ohlc(days, (i) => 1000 + 10 * i);
    const intraday = days.flatMap((d) => [d + 4 * H, d + 8 * H]);
    const e = engine('plot(outside(timeframe="1d", field="high"))\nplot(outside(timeframe="1d") / outside(timeframe="1d")[1] - 1)', { "\u00011d": { bars: daily, align: "closed", spanMs: D } }, ohlc(intraday, () => 5));
    const hi = col(e);
    expect(hi.slice(0, 2).every((v) => v !== v)).toBe(true); // day 0's own daily bar is still forming
    expect(hi.slice(2, 4)).toEqual([1001, 1001]); // day 1 sees day 0
    expect(hi.slice(4, 6)).toEqual([1011, 1011]);
    expect(hi.slice(6, 8)).toEqual([1021, 1021]);
    // `outside(tf)[1]` is the previous DAILY bar (an expression of one series is computed on that series' own bars, then joined):
    // the daily return is na on day 0 (no previous day) and constant over the chart bars of one day, which see the last closed day.
    const ret = col(e, 1);
    expect(ret.slice(0, 4).every((v) => v !== v)).toBe(true); // bars 2,3 see day 0 (1000), whose previous day does not exist
    expect(ret[4]).toBeCloseTo(1010 / 1000 - 1, 12); // bars 4,5 see day 1 (1010) over day 0 (1000)
    expect(ret[5]).toBeCloseTo(1010 / 1000 - 1, 12);
    expect(ret[6]).toBeCloseTo(1020 / 1010 - 1, 12); // bars 6,7 see day 2 (1020) over day 1 (1010)
    expect(ret[7]).toBeCloseTo(1020 / 1010 - 1, 12);
  });
  it("a state variable can use an outside series", () => {
    const t = minutes(8);
    const e = engine('var float s = 0.0\ns += outside("X") - close\nplot(s)', { "X\u0001": { bars: ohlc(t, (i) => 10 + i), align: "same", spanMs: M } }, ohlc(t, () => 4));
    expect(col(e)).toEqual([6, 13, 21, 30, 40, 51, 63, 76]);
  });
});

describe("what is computed on an outside series' own bars (a series with a timeframe)", () => {
  // five-minute chart over 40 hours; an hourly series of its own
  const hours = Array.from({ length: 40 }, (_, i) => T0 + i * H);
  const hourly = ohlc(hours, (i) => 100 + Math.sin(i / 3) * 10 + i * 0.1);
  const chart = ohlc(Array.from({ length: 40 * 12 }, (_, i) => T0 + i * 5 * M), (i) => 50 + i * 0.01);
  const feed = { "\u00011h": { bars: hourly, align: "closed" as const, spanMs: H } };
  /** The value of hourly column `h` at each chart bar: the latest hourly bar that has finished. */
  const joined = (h: ArrayLike<number>) => Array.from(chart.time, (t) => { let j = -1; hours.forEach((o, k) => { if (o + H <= t) j = k; }); return j < 0 ? Number.NaN : h[j]!; });
  const sameNumbers = (a: number[], b: ArrayLike<number>) => a.forEach((v, i) => { if (!(Object.is(v, b[i]) || Math.abs(v - b[i]!) < 1e-9)) throw new Error(`[${i}] ${v} vs ${b[i]}`); });

  it("ta.rsi of an hourly series is the hourly RSI, joined: 14 hourly bars whatever the chart's timeframe", () => {
    const e = engine('plot(ta.rsi(outside(timeframe = "1h"), 14))', feed, chart);
    const rsi = new StudyEngine(ok("plot(ta.rsi(close, 14))").study);
    rsi.load(hourly);
    sameNumbers(joined(rsi.column(0)), col(e));
    // not the RSI of the step-held series on the chart's bars
    const onChart = engine('x = outside(timeframe = "1h") + 0 * close\nplot(ta.rsi(x, 14))', feed, chart);
    expect(col(onChart).slice(300).some((v, i) => Math.abs(v - col(e)[300 + i]!) > 1)).toBe(true);
  });
  it("a variable, history and a tuple keep the series' own bars; mixing with the chart's series joins first", () => {
    const e = engine('d = outside(timeframe = "1h")\nr = d / d[1] - 1\nplot(ta.sma(r, 3))\n[m, s, h] = ta.macd(d, 5, 10, 3)\nplot(h)\nplot(ta.sma(d * close, 3))', feed, chart);
    const hr = Array.from(hourly.close, (c, i) => (i === 0 ? Number.NaN : c / hourly.close[i - 1]! - 1));
    const sma3 = hr.map((_, i) => (i < 3 ? Number.NaN : (hr[i]! + hr[i - 1]! + hr[i - 2]!) / 3));
    sameNumbers(joined(sma3), col(e, 0));
    const macd = new StudyEngine(ok("[m, s, h] = ta.macd(close, 5, 10, 3)\nplot(h)").study);
    macd.load(hourly);
    sameNumbers(joined(macd.column(0)), col(e, 1));
    // d * close is on the chart's bars: a 3-bar average of five-minute values
    const jc = joined(hourly.close);
    const mixed = jc.map((v, i) => v * chart.close[i]!);
    const want = mixed.map((_, i) => (i < 2 ? Number.NaN : (mixed[i]! + mixed[i - 1]! + mixed[i - 2]!) / 3));
    sameNumbers(want, col(e, 2));
  });
  it("rolling Sharpe of daily returns on an intraday chart", () => {
    const days = Array.from({ length: 30 }, (_, i) => T0 - (T0 % D) + i * D);
    const daily = ohlc(days, (i) => 1000 * (1 + Math.sin(i) * 0.02) + i);
    const intraday = ohlc(days.flatMap((d) => [d + 4 * H, d + 8 * H]), () => 5);
    const e = engine('r = outside(timeframe = "1d") / outside(timeframe = "1d")[1] - 1\nplot(ta.sma(r, 5) / ta.stdev(r, 5))', { "\u00011d": { bars: daily, align: "closed", spanMs: D } }, intraday);
    const r = Array.from(daily.close, (c, i) => (i === 0 ? Number.NaN : c / daily.close[i - 1]! - 1));
    const sharpe = r.map((_, i) => {
      if (i < 5) return Number.NaN;
      const w = r.slice(i - 4, i + 1), m = w.reduce((a, b) => a + b, 0) / 5;
      return m / Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 5);
    });
    // chart bar b of day k sees day k-1's closed value
    const want = Array.from({ length: intraday.time.length }, (_, b) => { const k = Math.floor(b / 2) - 1; return k < 0 ? Number.NaN : sharpe[k]!; });
    sameNumbers(want, col(e));
  });
  it("two outside series, or one and the chart, meet on the chart's bars", () => {
    const t = minutes(30);
    const a = ohlc(t, (i) => 10 + i), b = ohlc(t, (i) => 5 + 2 * i);
    const e = engine('plot(ta.sma(outside("A") - outside("B"), 3))', { "A\u0001": { bars: a, align: "same", spanMs: M }, "B\u0001": { bars: b, align: "same", spanMs: M } }, ohlc(t, () => 1));
    expect(col(e)[10]).toBeCloseTo(((20 - 25) + (19 - 23) + (18 - 21)) / 3, 9);
  });
});

describe("no lookahead through a script", () => {
  const src = 'r = close / outside("X")\nplot(r)\nplot(ta.sma(outside("X", "high"), 4))\nplot(ta.ema(outside(timeframe = "15m"), 3))';
  const rnd = seeded(5);
  const chartT = minutes(600);
  const chart = ohlc(chartT, (i) => 100 + Math.sin(i / 9) * 5 + rnd());
  const sameT = chartT.filter((_, i) => i % 7 !== 3);
  const xBars = ohlc(sameT, (i) => 40 + Math.cos(i / 11) * 4 + rnd());
  const qT = Array.from({ length: 41 }, (_, i) => T0 + i * 15 * M);
  const quarter = ohlc(qT, (i) => 70 + Math.sin(i / 3) * 6);
  const feeds = (xb: Required<BarColumns>, qb: Required<BarColumns>) => ({ "X\u0001": { bars: xb, align: "same" as const, spanMs: M }, "\u000115m": { bars: qb, align: "closed" as const, spanMs: 15 * M } });
  const cut = <T extends Required<BarColumns>>(b: T, keep: number): T => ({ time: b.time.slice(0, keep), open: b.open.slice(0, keep), high: b.high.slice(0, keep), low: b.low.slice(0, keep), close: b.close.slice(0, keep), volume: b.volume.slice(0, keep) }) as T;

  it("truncating the future of the chart and of the outside series never changes an earlier value", () => {
    const whole = engine(src, feeds(xBars, quarter), chart);
    for (const at of [20, 133, 300, 599]) {
      const T = chartT[at]!;
      const xk = sameT.filter((t) => t <= T).length, qk = qT.filter((t) => t <= T).length;
      const part = engine(src, feeds(cut(xBars, xk), cut(quarter, qk)), cut(chart, at + 1));
      for (let k = 0; k < 3; k++) {
        const a = col(whole, k).slice(0, at + 1), b = col(part, k);
        expect(b).toEqual(a);
      }
    }
  });
  it("rewriting every outside bar that had not finished by a chart bar leaves that bar's value alone", () => {
    const whole = engine(src, feeds(xBars, quarter), chart);
    const at = 250;
    const T = chartT[at]!;
    const poison = (b: Required<BarColumns>, limit: number): Required<BarColumns> => {
      const bad = (a: Float64Array) => a.map((v, i) => (b.time[i]! > limit ? 1e12 : v));
      return { ...b, open: bad(b.open), high: bad(b.high), low: bad(b.low), close: bad(b.close), volume: bad(b.volume) };
    };
    const e = engine(src, feeds(poison(xBars, T), poison(quarter, T - 15 * M)), chart);
    for (let k = 0; k < 3; k++) expect(col(e, k)[at]).toBe(col(whole, k)[at]);
  });
});

describe("incremental == batch with outside series", () => {
  for (const [name, src, feedDefs] of [
    ["same", 'plot(close / outside("X"))\nplot(ta.ema(outside("X", "high"), 5))', { "X\u0001": { align: "same" as const, span: M, drop: true } }],
    ["closed", 'plot(close - outside(timeframe = "30m"))\nplot(ta.sma(outside(timeframe = "30m", field = "low"), 3))', { "\u000130m": { align: "closed" as const, span: 30 * M, drop: false } }],
  ] as const) {
    it(name, () => {
      const N = 360;
      const t = minutes(N);
      const r = seeded(17);
      const chart = ohlc(t, (i) => 100 + Math.sin(i / 8) * 4);
      const feedBars: Record<string, Required<BarColumns>> = {};
      const defs = feedDefs as Record<string, { align: "same" | "closed"; span: number; drop: boolean }>;
      for (const [key, d] of Object.entries(defs)) {
        const times = d.align === "same" ? t.filter(() => r() > 0.1) : Array.from({ length: N / 30 + 2 }, (_, i) => T0 - 30 * M + i * 30 * M);
        feedBars[key] = ohlc(times, (i) => 60 + Math.cos(i / 5) * 3);
      }
      const batch = new StudyEngine(ok(src).study);
      for (const [k, d] of Object.entries(defs)) batch.setFeed(k, feedBars[k]!, { align: d.align, spanMs: d.span });
      batch.load(chart);

      const live = new StudyEngine(ok(src).study);
      const empty: FeedBars = { time: new Float64Array(0), open: new Float64Array(0), high: new Float64Array(0), low: new Float64Array(0), close: new Float64Array(0), volume: new Float64Array(0) };
      for (const [k, d] of Object.entries(defs)) live.setFeed(k, empty, { align: d.align, spanMs: d.span });
      const next: Record<string, number> = Object.fromEntries(Object.keys(defs).map((k) => [k, 0]));
      const wr = seeded(3);
      for (let i = 0; i < N; i++) {
        for (const k of Object.keys(defs)) {
          const fb = feedBars[k]!;
          while (next[k]! < fb.time.length && fb.time[next[k]!]! <= chart.time[i]!) {
            const b = toBar(fb, next[k]!++);
            live.pushFeed(k, { ...b, close: b.close + wr(), high: b.high + 2 }); // forming value
            live.pushFeed(k, b);
          }
        }
        const b = toBar(chart, i);
        live.push({ ...b, close: b.close + 1, high: b.high + 1 });
        live.reviseLast(b);
        for (const k of Object.keys(defs)) {
          const fb = feedBars[k]!, j = next[k]! - 1;
          if (j >= 0 && fb.time[j] === chart.time[i]) { live.pushFeed(k, { ...toBar(fb, j), close: 1 }); live.pushFeed(k, toBar(fb, j)); }
        }
      }
      for (let c = 0; c < 2; c++) {
        const a = col(batch, c), b = col(live, c);
        for (let i = 0; i < N; i++) if (!Object.is(a[i], b[i])) throw new Error(`column ${c}[${i}]: batch ${a[i]}, incremental ${b[i]}`);
      }
    });
  }
});

describe("serveScripts with outside series", () => {
  function harness() {
    const out: FromWorker[] = [];
    const handle = serveScripts((m) => out.push(m));
    const next = async (pred: (m: FromWorker) => boolean) => {
      for (let k = 0; k < 400; k++) { const m = out.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 5)); }
      throw new Error("no reply");
    };
    return { handle, out, next };
  }
  const t = minutes(40);
  const chart = () => ohlc(t, (i) => 100 + i);
  const feed = (n = 40) => ({ bars: ohlc(t.slice(0, n), (i) => 50 + i), align: "same" as const, spanMs: M });
  const src = 'plot(close / outside("X"))';
  const key = "X\u0001";

  it("runs with the columns, then a feed bar that the last bar sees revises it, and one it does not see is idle", async () => {
    const { handle, out, next } = harness();
    handle({ type: "run", id: 1, sid: 1, source: src, params: {}, bars: chart(), feeds: { [key]: feed(39) } });
    const res = (await next((m) => m.type === "result")) as Extract<FromWorker, { type: "result" }>;
    expect(res.n).toBe(40);
    const lastOut = res.buffers[res.buffers.length - 2]!; // the plotted column: the last node the script wrote (the bridge node follows it)
    expect(lastOut[38]).toBeCloseTo(138 / 88, 12);
    expect(lastOut[39]).toBeNaN(); // the other instrument has no bar for the chart's last bar yet
    // its bar for the last time arrives: the last bar now has a value
    handle({ type: "feed-bar", sid: 1, key, bar: { time: t[39]!, open: 1, high: 1, low: 1, close: 90, volume: 1 } });
    const v = (await next((m) => m.type === "values")) as Extract<FromWorker, { type: "values" }>;
    expect(v.index).toBe(39);
    expect(v.values[0]).toBeCloseTo(139 / 90, 12);
    // a bar for a time the chart has not reached changes nothing it sees
    handle({ type: "feed-bar", sid: 1, key, bar: { time: t[39]! + M, open: 1, high: 1, low: 1, close: 91, volume: 1 } });
    await next((m) => m.type === "idle");
    expect(out.filter((m) => m.type === "values")).toHaveLength(1);
  });
  it("a feed bar for a series the script does not read, or for an instance the worker lacks, is an error reply", async () => {
    const { handle, next } = harness();
    handle({ type: "feed-bar", sid: 9, key, bar: { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 } });
    expect(((await next((m) => m.type === "tick-error")) as Extract<FromWorker, { type: "tick-error" }>).error.message).toMatch(/no computed state in this worker/);
    const h2 = harness();
    h2.handle({ type: "run", id: 1, sid: 1, source: src, params: {}, bars: chart(), feeds: { [key]: feed() } });
    await h2.next((m) => m.type === "result");
    h2.handle({ type: "feed-bar", sid: 1, key: "Y\u0001", bar: { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 } });
    expect(((await h2.next((m) => m.type === "tick-error")) as Extract<FromWorker, { type: "tick-error" }>).error.message).toMatch(/reads no outside series/);
  });
  it("counts the columns against the limits: how many series, how many bars each, how many bytes", async () => {
    const many = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`S${i}\u0001`, feed()]));
    const a = harness();
    a.handle({ type: "run", id: 1, sid: 1, source: src, params: {}, bars: chart(), feeds: many, limits: { maxFeeds: 2 } });
    expect(((await a.next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>).error.message).toMatch(/3 outside series exceed the limit of 2/);
    const b = harness();
    const long = { bars: ohlc(minutes(50), (i) => i), align: "same" as const, spanMs: M };
    b.handle({ type: "run", id: 2, sid: 1, source: src, params: {}, bars: chart(), feeds: { [key]: long }, limits: { maxBars: 45 } });
    expect(((await b.next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>).error.message).toMatch(/an outside series has 50 bars; the limit is 45/);
    // the chart's own columns fit in chartBytes; one outside series of 40 bars adds 40 x 6 x 8 x 3 for its graph and 40 x 6 x 8 for the page's copy
    const chartBytes = new StudyEngine(withBridge(ok(src).study)).graph.cols.length * 40 * 8 * 3;
    const fits = harness();
    fits.handle({ type: "run", id: 3, sid: 1, source: src, params: {}, bars: chart(), limits: { maxBytes: chartBytes + 1000 } });
    await fits.next((m) => m.type === "result");
    const c = harness();
    c.handle({ type: "run", id: 4, sid: 1, source: src, params: {}, bars: chart(), feeds: { [key]: feed() }, limits: { maxBytes: chartBytes + 1000 } });
    const e = (await c.next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>;
    expect(e.error.message).toMatch(/1 outside series need \d+ MiB/);
    expect(e.error.kind).toBe("budget");
    expect(DEFAULT_LIMITS.maxFeeds).toBe(8);
  });
  it("the lockdown is the one it was: nothing about outside series adds a capability", () => {
    expect([...BLOCKED_GLOBALS]).toEqual(expect.arrayContaining(["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "EventSource", "indexedDB", "caches", "Worker", "SharedWorker", "BroadcastChannel", "navigator", "location", "document", "window"]));
    expect(BLOCKED_GLOBALS.length).toBe(25);
  });
});

class FakeWorker implements WorkerLike {
  terminated = false;
  sent: unknown[] = [];
  private handlers: ((e: { data: unknown }) => void)[] = [];
  postMessage(m: unknown): void { this.sent.push(m); }
  reply(r: unknown): void { this.handlers.forEach((h) => h({ data: r })); }
  addEventListener(type: string, fn: (e: never) => void): void { if (type === "message") this.handlers.push(fn as never); }
  terminate(): void { this.terminated = true; }
}

describe("ScriptRunner and outside series", () => {
  const mk = (limits = {}) => {
    const workers: FakeWorker[] = [];
    const runner = new ScriptRunner(() => { const w = new FakeWorker(); workers.push(w); return w; }, limits);
    const def = withBridge(ok('plot(outside("X"))').study);
    const values: number[] = [];
    const errors: string[] = [];
    const sid = runner.attach(def, 'plot(outside("X"))', { values: (i) => values.push(i), error: (e) => errors.push(e.message) });
    return { runner, workers, def, sid, values, errors };
  };
  const bar = { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };

  it("transfers the columns with the batch and sends a feed bar on the tick channel", () => {
    const { runner, workers, def } = mk();
    const feeds = { "X\u0001": { align: "same" as const, spanMs: M, bars: ohlc(minutes(3), (i) => i) } };
    runner.run(def, { studyId: def.id, params: {}, bars: { time: new Float64Array(3), close: new Float64Array(3) }, feeds }).promise.catch(() => {});
    runner.feedBar(def, "X\u0001", bar);
    const sent = workers[0]!.sent as { type: string }[];
    expect(sent.map((m) => m.type)).toEqual(["run", "feed-bar"]);
    expect((sent[0] as unknown as { feeds: object }).feeds).toBe(feeds);
    runner.dispose();
  });
  it("an answered feed bar (values or idle) stops its timer; an unanswered one terminates the worker like a tick", async () => {
    const a = mk({ tickMs: 25 });
    a.runner.feedBar(a.def, "X\u0001", bar);
    a.workers[0]!.reply({ type: "idle", sid: a.sid });
    await new Promise((r) => setTimeout(r, 70));
    expect(a.errors).toEqual([]);
    a.runner.feedBar(a.def, "X\u0001", bar);
    a.workers[0]!.reply({ type: "values", sid: a.sid, index: 0, values: Float64Array.of(1) });
    await new Promise((r) => setTimeout(r, 70));
    expect(a.errors).toEqual([]);
    expect(a.values).toEqual([0]);
    a.runner.feedBar(a.def, "X\u0001", bar);
    await new Promise((r) => setTimeout(r, 70));
    expect(a.errors).toEqual(["a tick took longer than 25 ms; the script was terminated"]);
    expect(a.workers[0]!.terminated).toBe(true);
  });
  it("sends nothing for an instance the runner no longer holds", () => {
    const { runner, workers, def, sid } = mk();
    runner.feedBar(def, "X\u0001", bar);
    runner.detach(sid);
    const before = workers[0]!.sent.length;
    runner.feedBar(def, "X\u0001", bar);
    expect(workers[0]!.sent.length).toBe(before);
  });
});
