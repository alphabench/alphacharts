// Outside series: the join rules of engine/feed.ts, proven on hand-worked cases and by properties.
//  - "same": exactly the feed bar with the study bar's time, else absent; nothing carried from another bar or day.
//  - "closed": the latest feed bar that has finished (open + span <= the study bar's time).
//  - no lookahead: cutting off the future (study bars or feed bars) never changes an earlier value.
//  - incremental == batch: appends, revisions and feed ticks leave the columns a batch run gives.
import { describe, expect, it } from "vitest";
import { Feed, joinFeed, type FeedBar, type FeedBars } from "../src/engine/feed.js";
import { StudyEngine } from "../src/engine/study.js";
import type { StudyDef } from "../src/types.js";
import { randomBars, rng } from "./support.js";

const M = 60_000;
const H = 60 * M;
const D = 24 * H;

function bars(times: number[], f: (t: number, i: number) => number = (_t, i) => 100 + i): FeedBars {
  const v = (g: (t: number, i: number) => number) => Float64Array.from(times.map(g));
  return { time: Float64Array.from(times), open: v((t, i) => f(t, i) - 1), high: v((t, i) => f(t, i) + 1), low: v((t, i) => f(t, i) - 2), close: v(f), volume: v((_t, i) => 10 * (i + 1)) };
}
const feedOf = (b: FeedBars, align: "same" | "closed", spanMs = 0): Feed => {
  const f = new Feed();
  f.load(b, { align, spanMs });
  return f;
};

describe("same-timeframe join", () => {
  it("takes the bar with exactly the study bar's time and leaves a missing bar absent", () => {
    // feed has no bar at 3 * M (the other instrument did not trade that minute)
    const f = feedOf(bars([0, M, 2 * M, 4 * M, 5 * M]), "same");
    const out = joinFeed(f, "close", [0, M, 2 * M, 3 * M, 4 * M, 5 * M, 6 * M]);
    expect(Array.from(out)).toEqual([100, 101, 102, Number.NaN, 103, 104, Number.NaN]);
  });

  it("never carries a value across a session gap", () => {
    // day 1 ends at 10:00, day 2 starts at the next day's 09:15; the study has a bar at day 2 09:15 the feed lacks
    const day2 = D + 9 * H;
    const f = feedOf(bars([8 * H, 9 * H, 10 * H, day2 + M]), "same");
    expect(Array.from(joinFeed(f, "close", [10 * H, day2, day2 + M]))).toEqual([102, Number.NaN, 103]);
  });

  it("answers the same whichever order the bars are asked in", () => {
    const t = Array.from({ length: 50 }, (_, i) => i * M);
    const f = feedOf(bars(t.filter((_, i) => i % 3 !== 0)), "same");
    const forward = joinFeed(f, "close", t);
    const backward = Array.from(joinFeed(f, "close", [...t].reverse())).reverse();
    expect(Array.from(forward)).toEqual(backward);
  });
});

describe("closed (higher timeframe) join", () => {
  // hourly feed bars opening 09:00, 10:00, 11:00 (values 100, 101, 102)
  const hourly = () => feedOf(bars([9 * H, 10 * H, 11 * H]), "closed", H);

  it("shows an hourly bar only from the first study bar at or after its close", () => {
    const f = hourly();
    const at = (m: number) => joinFeed(f, "close", [m * M])[0]!;
    expect(at(9 * 60)).toBeNaN(); // the 09:00 bar is forming
    expect(at(9 * 60 + 59)).toBeNaN();
    expect(at(10 * 60)).toBe(100); // the 09:00 bar closed at 10:00
    expect(at(10 * 60 + 30)).toBe(100); // 10:00 still forming: the last closed value
    expect(at(11 * 60)).toBe(101);
    expect(at(12 * 60)).toBe(102);
    expect(at(30 * 60)).toBe(102); // kept until a later bar closes
  });

  it("previous-day levels: a daily bar is visible all of the next day and none of its own", () => {
    const days = feedOf(bars([0, D, 2 * D], (_t, i) => 500 + i), "closed", D);
    const intraday = [0 + 9 * H, 0 + 15 * H, D + 9 * H, D + 15 * H, 2 * D + 9 * H];
    expect(Array.from(joinFeed(days, "close", intraday))).toEqual([Number.NaN, Number.NaN, 500, 500, 501]);
  });

  it("the live bar sees the last closed value, whatever the forming bar does", () => {
    const f = hourly();
    const live = 11 * H + 20 * M;
    const before = joinFeed(f, "close", [live])[0];
    f.apply({ time: 11 * H, open: 0, high: 1e9, low: -1e9, close: 1e9, volume: 1 });
    expect(joinFeed(f, "close", [live])[0]).toBe(before);
    expect(before).toBe(101);
  });
});

describe("no lookahead", () => {
  const feedTimes = (n: number, step: number, seed: number) => {
    const r = rng(seed);
    const t: number[] = [];
    let x = 0;
    for (let i = 0; i < n; i++) {
      x += step * (r() < 0.2 ? 2 : 1); // gaps now and then
      t.push(x);
    }
    return t;
  };

  for (const [align, span, step] of [["same", 0, M], ["closed", 15 * M, 15 * M], ["closed", H, H]] as const) {
    it(`${align} (${span / M} min): cutting off later bars never changes an earlier value`, () => {
      const ft = feedTimes(400, step, 7);
      const full = bars(ft, (t) => Math.sin(t / 1e6) * 50 + 100);
      const study = Array.from({ length: 900 }, (_, i) => (i + 1) * M);
      const whole = joinFeed(feedOf(full, align, span), "close", study);
      for (const cut of [37, 200, 555, 899]) {
        const T = study[cut]!;
        // study bars cut after T, and feed bars cut after T
        const k = ft.filter((t) => t <= T).length;
        const cutFeed = { time: full.time.slice(0, k), open: full.open.slice(0, k), high: full.high.slice(0, k), low: full.low.slice(0, k), close: full.close.slice(0, k), volume: full.volume.slice(0, k) };
        const part = joinFeed(feedOf(cutFeed, align, span), "close", study.slice(0, cut + 1));
        expect(Array.from(part)).toEqual(Array.from(whole.slice(0, cut + 1)));
      }
    });

    it(`${align} (${span / M} min): rewriting every feed bar that has not finished by a study bar leaves its value alone`, () => {
      const ft = feedTimes(300, step, 11);
      const a = bars(ft, (t) => Math.cos(t / 3e5) * 40 + 100);
      const study = Array.from({ length: 700 }, (_, i) => (i + 1) * M);
      const base = joinFeed(feedOf(a, align, span), "close", study);
      // poison all feed bars whose finish is after study bar i, then compare bar i
      for (const i of [10, 100, 333, 650]) {
        const t = study[i]!;
        const lim = align === "same" ? t : t - span;
        const poisoned = { ...a, close: a.close.map((v, j) => (ft[j]! > lim ? 1e12 : v)) };
        expect(joinFeed(feedOf(poisoned, align, span), "close", [t])[0]).toBe(base[i]);
      }
    });
  }
});

describe("validation", () => {
  it("refuses bars that are not a series, naming the series", () => {
    const f = new Feed();
    expect(() => f.load({ ...bars([0, M]), close: new Float64Array(1) }, { align: "same", spanMs: 0 }, "outside series X")).toThrow(/outside series X: close has 1 rows, time has 2/);
    expect(() => f.load(bars([M, M]), { align: "same", spanMs: 0 })).toThrow(/strictly increasing/);
    expect(() => f.load(bars([0]), { align: "closed", spanMs: 0 })).toThrow(/spanMs > 0/);
    f.load(bars([0, M]), { align: "same", spanMs: 0 });
    expect(() => f.apply({ time: -1, open: 1, high: 1, low: 1, close: 1, volume: 1 })).toThrow(/earlier than the last bar/);
  });
});

// A study reading the feed "x": close of the feed minus the study's close, and its volume.
const def: StudyDef = {
  id: "feed-probe", name: "Feed probe", family: "tv", inputs: [], needs: "ohlcv", pane: "new", columns: ["diff", "vol"], plots: [],
  build: (g) => [g.sub(g.external("x", "close"), g.close), g.external("x", "volume")],
};

const asBar = (b: FeedBars, i: number): FeedBar => ({ time: b.time[i]!, open: b.open[i]!, high: b.high[i]!, low: b.low[i]!, close: b.close[i]!, volume: b.volume[i]! });

describe("a study reading an outside series", () => {
  const N = 240;
  const own = randomBars(N, 5);
  const other = (align: "same" | "closed", span: number) => {
    const r = rng(21);
    const t: number[] = [];
    for (let x = align === "same" ? 0 : -span; x < N * M; x += align === "same" ? M : span) if (align === "closed" || r() > 0.1) t.push(own.time[0]! + x);
    return bars(t, (_tt, i) => 90 + Math.sin(i / 7) * 10 + i * 0.01);
  };

  for (const [align, span] of [["same", 0], ["closed", 15 * M]] as const) {
    it(`${align}: appends, revisions and feed ticks leave exactly the columns of a batch run`, () => {
      const fb = other(align, span);
      const batch = new StudyEngine(def);
      batch.setFeed("x", fb, { align, spanMs: span });
      batch.load(own);

      // live: the feed arrives bar by bar (a tick revises the forming bar first), the study's bars likewise
      const live = new StudyEngine(def);
      live.setFeed("x", { time: new Float64Array(0), open: new Float64Array(0), high: new Float64Array(0), low: new Float64Array(0), close: new Float64Array(0), volume: new Float64Array(0) }, { align, spanMs: span });
      let k = 0;
      const r = rng(3);
      for (let i = 0; i < N; i++) {
        // feed bars that open at or before this study bar arrive first
        while (k < fb.time.length && fb.time[k]! <= own.time[i]!) {
          const b = asBar(fb, k++);
          live.pushFeed("x", { ...b, close: b.close + r() }); // a forming value first
          live.pushFeed("x", b);
        }
        const b = { time: own.time[i]!, open: own.open[i]!, high: own.high[i]!, low: own.low[i]!, close: own.close[i]!, volume: own.volume[i]! };
        live.push({ ...b, close: b.close + 1, high: b.high + 1 });
        live.reviseLast(b);
        // the other instrument ticks inside this study bar
        if (k < fb.time.length && align === "same" && fb.time[k - 1] === own.time[i]) {
          const last = asBar(fb, k - 1);
          expect(live.pushFeed("x", { ...last, close: last.close + 5 })).toBe(true);
          live.pushFeed("x", last);
        }
      }
      for (let c = 0; c < 2; c++) {
        const a = batch.column(c), b = live.column(c);
        for (let i = 0; i < N; i++) if (!Object.is(a[i], b[i])) throw new Error(`${def.columns[c]}[${i}]: batch ${a[i]}, incremental ${b[i]}`);
      }
    });
  }

  it("a feed tick that changes nothing the last bar sees recomputes nothing", () => {
    const e = new StudyEngine(def);
    e.setFeed("x", bars([0, 15 * M, 30 * M]), { align: "closed", spanMs: 15 * M });
    e.load({ time: Float64Array.of(31 * M), open: Float64Array.of(1), high: Float64Array.of(1), low: Float64Array.of(1), close: Float64Array.of(1), volume: Float64Array.of(1) });
    // the bar at 45 min is forming: a tick on it, or a first tick of the bar after it, leaves the study bar at 31 min as it was
    expect(e.pushFeed("x", { time: 30 * M, open: 1, high: 2, low: 0, close: 7, volume: 1 })).toBe(false);
    expect(e.pushFeed("x", { time: 45 * M, open: 1, high: 2, low: 0, close: 8, volume: 1 })).toBe(false);
    expect(() => e.pushFeed("nope", { time: 60 * M, open: 1, high: 1, low: 1, close: 1, volume: 1 })).toThrow(/no outside series "nope"/);
  });
});
