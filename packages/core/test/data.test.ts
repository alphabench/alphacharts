import { describe, expect, it } from "vitest";
import { ColumnDeque, F64_NAN } from "../src/data/deque.js";
import { LOD_BASE, LOD_H, LOD_L, LOD_O, LOD_C } from "../src/data/lod.js";
import { COL_C, COL_H, COL_L, COL_O, DataModel, type OhlcBar } from "../src/data/model.js";
import { civilFromLocal, TimeZone } from "../src/data/tz.js";

// Deterministic PRNG so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function bars(n: number, t0: number, seed: number, step = 60_000): OhlcBar[] {
  const r = rng(seed);
  const out: OhlcBar[] = [];
  let p = 1000;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + (r() - 0.5) * 4;
    out.push({ time: t0 + i * step, open: o, high: Math.max(o, c) + r(), low: Math.min(o, c) - r(), close: c });
    p = c;
  }
  return out;
}

describe("ColumnDeque", () => {
  it("keeps absolute indices through growth at both ends", () => {
    const q = new ColumnDeque([F64_NAN]);
    q.cover(0, 1);
    q.cols[0]![q.pos(0)] = 0;
    for (let i = 1; i < 500; i++) {
      q.cover(-i, i + 1);
      q.cols[0]![q.pos(-i)] = -i;
      q.cols[0]![q.pos(i)] = i;
    }
    expect(q.first).toBe(-499);
    expect(q.end).toBe(500);
    for (let i = -499; i < 500; i++) expect(q.cols[0]![q.pos(i)]).toBe(i);
  });
});

describe("LOD pyramid", () => {
  function check(m: DataModel, s: ReturnType<DataModel["add"]>) {
    const st = s.store;
    const [CO, CH, CL, CC] = s.shape === "ohlc" ? [COL_O, COL_H, COL_L, COL_C] : [0, 0, 0, 0];
    for (let k = LOD_BASE; k <= s.lod.topLevel; k++) {
      const lv = s.lod.level(k)!;
      for (let b = lv.first; b < lv.end; b++) {
        let o = NaN, h = -Infinity, l = Infinity, c = NaN;
        for (let i = Math.max(b << k, st.first); i < Math.min((b + 1) << k, st.end); i++) {
          if (!s.has(i)) continue;
          if (Number.isNaN(o)) o = s.get(i, CO);
          h = Math.max(h, s.get(i, CH));
          l = Math.min(l, s.get(i, CL));
          c = s.get(i, CC);
        }
        const p = lv.pos(b);
        expect(lv.cols[LOD_O]![p]).toBeCloseTo(Math.fround(o), 3);
        expect(lv.cols[LOD_H]![p]).toBe(Math.fround(h));
        expect(lv.cols[LOD_L]![p]).toBe(Math.fround(l));
        expect(lv.cols[LOD_C]![p]).toBeCloseTo(Math.fround(c), 3);
      }
    }
    // Range queries equal a linear scan of the raw rows.
    const r = rng(7);
    const out = new Float64Array(2);
    for (let q = 0; q < 300; q++) {
      const a = st.first + Math.floor(r() * st.length);
      const b = a + Math.floor(r() * (st.end - a));
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i <= b; i++) {
        if (!s.has(i)) continue;
        hi = Math.max(hi, s.get(i, CH));
        lo = Math.min(lo, s.get(i, CL));
      }
      s.lod.minMax(a, b, out);
      if (lo === Infinity) {
        expect(out[0]).toBeNaN();
        expect(out[1]).toBeNaN();
        continue;
      }
      // Level values are Float32: equal to the float32 rounding of the true extreme.
      expect(Math.fround(out[0]!)).toBe(Math.fround(lo));
      expect(Math.fround(out[1]!)).toBe(Math.fround(hi));
    }
    void m;
  }

  it("matches brute force after setData", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    m.setData(s, bars(5003, 0, 1));
    check(m, s);
  });

  it("matches brute force after many prepends and appends", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    const all = bars(6000, 0, 2);
    m.setData(s, all.slice(3000, 3100));
    let lo = 3000;
    const r = rng(3);
    while (lo > 0) {
      const n = Math.min(lo, 1 + Math.floor(r() * 400));
      m.prepend(s, all.slice(lo - n, lo));
      lo -= n;
    }
    for (let i = 3100; i < 6000; i++) {
      m.update(s, all[i]!);
      if (r() < 0.3) m.update(s, { ...all[i]!, close: all[i]!.close + 0.5, high: all[i]!.high + 1 });
    }
    expect(s.store.length).toBe(6000);
    expect(m.timeline.first).toBe(-3000);
    check(m, s);
  });

  it("re-indexes other series when a union adds interior times", () => {
    const m = new DataModel();
    const a = m.add("ohlc");
    const v = m.add("value");
    const even = bars(100, 0, 4, 120_000);
    m.setData(a, even);
    // Odd minutes only: every time is new and interior.
    m.setData(v, even.map((b) => ({ time: b.time + 60_000, value: b.close })));
    expect(m.timeline.length).toBe(200);
    for (let i = 0; i < 100; i++) {
      const ia = m.timeline.indexOf(even[i]!.time)!;
      expect(a.get(ia, COL_C)).toBe(even[i]!.close);
      expect(a.has(ia + 1)).toBe(false);
      expect(v.get(ia + 1, 0)).toBe(even[i]!.close);
    }
    check(m, a);
    check(m, v);
  });

  it("rejects an update older than the last bar", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    m.setData(s, bars(10, 0, 5));
    expect(() => m.update(s, bars(1, 0, 6)[0]!)).toThrow(RangeError);
  });

  it("rejects non-finite values instead of rendering them", () => {
    const m = new DataModel();
    const s = m.add("value");
    expect(() => m.setData(s, [{ time: 0, value: Number.NaN }])).toThrow(TypeError);
  });
});

describe("Timeline", () => {
  it("lowerBound and indexOf round-trip every time", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    const b = bars(1000, 1_700_000_000_000, 8, 37_000);
    m.setData(s, b);
    for (let i = 0; i < b.length; i++) {
      expect(m.timeline.indexOf(b[i]!.time)).toBe(i);
      expect(m.timeline.lowerBound(b[i]!.time - 1)).toBe(i);
      expect(m.timeline.timeAt(i)).toBe(b[i]!.time);
    }
    expect(m.timeline.indexOf(b[0]!.time + 1)).toBeUndefined();
  });
});

describe("TimeZone", () => {
  it("civil fields match Date for UTC", () => {
    const r = rng(9);
    for (let i = 0; i < 2000; i++) {
      const t = Math.floor((r() - 0.3) * 4e12);
      const d = new Date(t);
      const c = civilFromLocal(t);
      expect([c.year, c.month, c.day, c.hour, c.minute, c.second]).toEqual([
        d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
      ]);
    }
  });

  it("cached offsets equal exact offsets across DST transitions", () => {
    for (const id of ["America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe"]) {
      const tz = new TimeZone(id);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: id, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
      // Every 17 minutes over 2024 hits both transitions in every zone above.
      for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2025, 0, 1); t += 17 * 60_000) {
        const c = tz.civil(t);
        const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
        expect([c.year, c.month, c.day, c.hour, c.minute]).toEqual([+p.year!, +p.month!, +p.day!, +p.hour!, +p.minute!]);
      }
    }
  });
});

describe("DataModel.setData fast path and batch", () => {
  const T0 = 1_700_000_000_000;
  const times = (idx: number[]) => idx.map((i) => T0 + i * 60_000);
  const vals = (idx: number[], v = 1) => idx.map((i) => ({ time: T0 + i * 60_000, value: v + i }));
  const timeline = (m: DataModel) => Array.from({ length: m.timeline.length }, (_, k) => (m.timeline.timeAt(m.timeline.first + k) - T0) / 60_000);
  const series = (s: ReturnType<DataModel["add"]>) => {
    const out: [number, number][] = [];
    for (let i = s.store.first; i < s.store.end; i++) if (s.has(i)) out.push([i, s.get(i, 0)]);
    return out;
  };
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  function base() {
    const m = new DataModel();
    const a = m.add("value");
    m.setData(a, vals(range(10)));
    return { m, a };
  }
  function events(m: DataModel) {
    const ev: { reindexed: boolean }[] = [];
    m.onChange((c) => ev.push({ reindexed: c.reindexed }));
    return ev;
  }

  for (const inBatch of [false, true]) {
    const run = <T>(m: DataModel, fn: () => T) => (inBatch ? m.batch(fn) : fn());
    describe(inBatch ? "inside batch" : "outside batch", () => {
      it("a subset lands on the shared timeline without reindexing", () => {
        const { m, a } = base();
        const ev = events(m);
        const b = m.add("value");
        run(m, () => m.setData(b, vals([2, 5, 9], 100)));
        expect(timeline(m)).toEqual(range(10));
        expect(series(b)).toEqual([[2, 102], [5, 105], [9, 109]]);
        expect(series(a).length).toBe(10);
        expect(ev.every((e) => !e.reindexed)).toBe(true);
        expect(ev.length).toBe(1);
      });
      it("the same times as an existing series", () => {
        const { m } = base();
        const b = m.add("value");
        run(m, () => m.setData(b, vals(range(10), 5)));
        expect(series(b).map((x) => x[1])).toEqual(range(10).map((i) => 5 + i));
      });
      it("a superset widens the timeline", () => {
        const { m, a } = base();
        const ev = events(m);
        const b = m.add("value");
        run(m, () => m.setData(b, vals(range(14), 0)));
        expect(timeline(m)).toEqual(range(14));
        expect(series(a).map((x) => x[0])).toEqual(range(10));
        expect(ev.some((e) => e.reindexed)).toBe(true);
      });
      it("an interior time no series has reindexes the others", () => {
        const { m, a } = base();
        m.setData(a, vals([0, 2, 4, 6]));
        const b = m.add("value");
        run(m, () => m.setData(b, vals([1, 2, 3], 100)));
        expect(timeline(m)).toEqual([0, 1, 2, 3, 4, 6]);
        expect(series(a).map((x) => x[1])).toEqual([0, 2, 4, 6].map((i) => 1 + i));
        expect(series(b).map((x) => x[1])).toEqual([101, 102, 103].map((v) => v));
        expect(series(a).map((x) => x[0])).toEqual([0, 2, 4, 5]);
      });
      it("replacing with fewer times drops times nobody holds", () => {
        const { m, a } = base();
        run(m, () => m.setData(a, vals([3, 4, 5])));
        expect(timeline(m)).toEqual([3, 4, 5]);
      });
      it("replacing with the same times keeps others and recomputes the LOD", () => {
        const { m, a } = base();
        const b = m.add("value");
        run(m, () => {
          m.setData(b, vals(range(10), 0));
          m.setData(b, vals(range(10), 50));
        });
        expect(series(b)[0]).toEqual([0, 50]);
        expect(series(a).length).toBe(10);
      });
      it("an empty series, then a first series, builds the timeline", () => {
        const m = new DataModel();
        const a = m.add("value"), b = m.add("value");
        run(m, () => {
          m.setData(a, vals(range(5)));
          m.setData(b, vals([1, 3]));
        });
        expect(timeline(m)).toEqual(range(5));
        expect(series(b).map((x) => x[0])).toEqual([1, 3]);
      });
    });
  }

  it("batch emits nothing until its end, then one event per series, and rebuilds once", () => {
    const { m } = base();
    const ev = events(m);
    const bs = [m.add("value"), m.add("value"), m.add("value")];
    m.batch(() => {
      m.setData(bs[0]!, vals(range(10), 1)); // fast path
      m.setData(bs[1]!, vals(range(12), 2)); // needs the union
      m.setData(bs[2]!, vals([11], 3)); // needs the union
      expect(ev.length).toBe(0);
    });
    expect(ev.length).toBe(3);
    expect(timeline(m)).toEqual(range(12));
    expect(series(bs[2]!)).toEqual([[11, 14]]);
    expect(series(bs[0]!).length).toBe(10);
  });

  it("batch nests and settles on the outermost end, also when fn throws", () => {
    const { m } = base();
    const ev = events(m);
    const b = m.add("value");
    expect(() => m.batch(() => { m.batch(() => m.setData(b, vals(range(10)))); expect(ev.length).toBe(0); throw new Error("x"); })).toThrow("x");
    expect(ev.length).toBe(1);
    expect(series(b).length).toBe(10);
  });

  it("update/prepend/remove inside a batch settle what is pending first", () => {
    const { m, a } = base();
    const b = m.add("value");
    m.batch(() => {
      m.setData(b, vals(range(12), 7));
      m.update(a, { time: T0 + 12 * 60_000, value: 1 });
      expect(series(b).map((x) => x[0])).toEqual(range(12));
    });
    expect(timeline(m)).toEqual(range(13));
    m.batch(() => {
      m.setData(b, vals(range(13), 7));
      m.remove(a);
    });
    expect(series(b).length).toBe(13);
    expect(timeline(m)).toEqual(range(13));
  });

  it("matches the old behaviour: random sequences end with the same timeline and data as one-by-one rebuilds", () => {
    const r = rng(7);
    for (let round = 0; round < 40; round++) {
      const sets: number[][] = [];
      for (let k = 0; k < 5; k++) sets.push(range(30).filter(() => r() < 0.4 + 0.1 * k));
      const sequential = new DataModel(), batched = new DataModel();
      const a = sets.map(() => sequential.add("value")), b = sets.map(() => batched.add("value"));
      sets.forEach((idx, k) => sequential.setData(a[k]!, vals(idx, k)));
      batched.batch(() => sets.forEach((idx, k) => batched.setData(b[k]!, vals(idx, k))));
      expect(timeline(batched)).toEqual(timeline(sequential));
      sets.forEach((_, k) => {
        expect(series(b[k]!).map((x) => x[1])).toEqual(series(a[k]!).map((x) => x[1]));
        const at = (m: DataModel, d: ReturnType<DataModel["add"]>) => series(d).map((x) => m.timeline.timeAt(x[0]));
        expect(at(batched, b[k]!)).toEqual(at(sequential, a[k]!));
      });
    }
  });
});
