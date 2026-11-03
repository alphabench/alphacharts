// Regression tests for the M1 long-term review (H1–H5).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataModel } from "../src/data/model.js";
import { InstanceWindow, RECORD_FLOATS } from "../src/render/window.js";
import { priceTicks, PriceFormatter } from "../src/scale/ticks.js";

describe("H1: every price tick is a value its label shows exactly", () => {
  const cases: [number, number, number][] = [
    [100, 100.5, 0.01],
    [100, 102, 0.1],
    [0, 20, 1],
    [1.0841, 1.0862, 0.00001],
    [24_990, 25_010, 0.05],
    [0.0000121, 0.0000129, 0.00000001],
  ];
  for (const [lo, hi, mm] of cases) {
    it(`[${lo}, ${hi}] minMove ${mm}`, () => {
      const f = new PriceFormatter(mm);
      for (const h of [120, 300, 600, 1200]) {
        const { ticks } = priceTicks(lo, hi, h, 30, mm);
        expect(ticks.length).toBeGreaterThan(0);
        for (const t of ticks) expect(Math.abs(+f.format(t) - t)).toBeLessThan(mm * 1e-6);
      }
    });
  }
});

describe("H2: a removed series cannot touch the shared timeline", () => {
  it("throws on setData, prepend and update", () => {
    const m = new DataModel();
    const a = m.add("value");
    const b = m.add("value");
    m.setData(a, [{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    m.setData(b, [{ time: 1, value: 1 }]);
    m.remove(b);
    expect(() => m.update(b, { time: 5, value: 1 })).toThrow(/removed/);
    expect(() => m.setData(b, [{ time: 9, value: 1 }])).toThrow(/removed/);
    expect(() => m.prepend(b, [{ time: 0, value: 1 }])).toThrow(/removed/);
    expect(m.timeline.length).toBe(2);
  });
});

describe("H3: the bar containing a time", () => {
  it("is the bar at or before it", () => {
    const m = new DataModel();
    const s = m.add("value");
    m.setData(s, [0, 5, 10, 15].map((t) => ({ time: t * 60_000, value: 1 })));
    const tl = m.timeline;
    expect(tl.indexAtOrBefore(7 * 60_000)).toBe(1); // 10:07 is in the 10:05 bar
    expect(tl.indexAtOrBefore(10 * 60_000)).toBe(2);
    expect(tl.indexAtOrBefore(99 * 60_000)).toBe(3);
    expect(tl.indexAtOrBefore(-1)).toBeUndefined();
  });
});

describe("H4: a sparse line uploads every present point, joined", () => {
  let uploaded = new Float32Array(0);
  const gl = {
    ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2,
    createBuffer: () => ({}), bindBuffer: () => {}, deleteBuffer: () => {},
    bufferData: (_t: number, d: Float32Array) => void (uploaded = d.slice()),
    bufferSubData: () => {},
  } as unknown as WebGL2RenderingContext;

  it("compacts holes away for pair renderers", () => {
    const m = new DataModel();
    const candles = m.add("value");
    const line = m.add("value");
    m.setData(candles, Array.from({ length: 10 }, (_, t) => ({ time: t, value: 1 })));
    m.setData(line, [1, 3, 5].map((t) => ({ time: t, value: t * 10 })));
    const win = new InstanceWindow(gl, line, false, true);
    win.ensure(0, 0, 9);
    expect(win.count).toBe(3);
    const xs = [0, 1, 2].map((k) => uploaded[k * RECORD_FLOATS]! + win.base);
    expect(xs).toEqual([1, 3, 5]);
    // Live update of the last point re-uploads correctly with holes present.
    m.update(line, { time: 5, value: 99 });
    const c = { series: line, kind: "update" as const, lo: 5, hi: 6, reindexed: false, appended: false };
    win.dataChanged(c);
    win.ensure(0, 0, 9);
    expect(uploaded[2 * RECORD_FLOATS + 4]! + win.priceBase).toBeCloseTo(99, 4);
  });
});

describe("H5: one chart's render error does not freeze the others", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders every dirty chart, then throws the first error", async () => {
    let cb: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => ((cb = f), 1));
    const { requestRender } = await import("../src/chart/scheduler.js");
    const seen: string[] = [];
    requestRender({ render: () => { seen.push("a"); throw new Error("boom"); } }, 1);
    requestRender({ render: () => void seen.push("b") }, 1);
    expect(() => cb!(0)).toThrow("boom");
    expect(seen).toEqual(["a", "b"]);
  });

  it("rejects an unreadable colour when the option is set, not in a frame", async () => {
    const { Series } = await import("../src/chart/series.js");
    const { DARK } = await import("../src/chart/theme.js");
    const m = new DataModel();
    const host = { optionsChanged: () => {} } as never;
    expect(() => new Series("candles", m.add("ohlc"), host, { upColor: "red" }, DARK)).toThrow(/unsupported colour/);
    const s = new Series("line", m.add("value"), host, {}, DARK);
    expect(() => s.applyOptions({ color: "blue" })).toThrow(/unsupported colour/);
    expect(s.options().color).toBe(DARK.accent);
  });
});
