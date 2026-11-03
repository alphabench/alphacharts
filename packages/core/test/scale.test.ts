import { describe, expect, it } from "vitest";
import { DataModel } from "../src/data/model.js";
import { InstanceWindow, RECORD_FLOATS } from "../src/render/window.js";
import { PriceScale, DEFAULT_PRICE_SCALE } from "../src/scale/price-scale.js";
import { DEFAULT_TIME_SCALE, TimeScale } from "../src/scale/time-scale.js";

function timeScale(first: number, end: number, width: number) {
  const t = new TimeScale({ ...DEFAULT_TIME_SCALE });
  t.first = first;
  t.end = end;
  t.width = width;
  return t;
}

describe("TimeScale", () => {
  it("x and logical are inverses", () => {
    const t = timeScale(-500, 10_000, 1234);
    t.spacing = 3.7;
    t.rightOffset = -812.25;
    for (const i of [-500, 0, 4321, 9999]) expect(t.logical(t.x(i))).toBeCloseTo(i, 9);
  });

  it("zoom keeps the bar under the anchor where it was", () => {
    for (const [anchor, f] of [[800, 1.7], [10, 0.3], [1590, 4], [400, 0.001]] as const) {
      // A view inside the history, so the clamp does not take over.
      const t = timeScale(0, 1_000_000, 1600);
      t.rightOffset = -500_000;
      const before = t.logical(anchor);
      t.zoom(anchor, f);
      expect(t.logical(anchor)).toBeCloseTo(before, 6);
    }
  });

  it("can fit 10M bars and never pans everything off screen", () => {
    const t = timeScale(0, 10_000_000, 1600);
    t.fitAll();
    const v = t.visible();
    expect(v.lo).toBe(0);
    expect(v.hi).toBe(9_999_999);
    t.spacing = 8;
    t.pan(1e9);
    expect(t.visible().hi - t.visible().lo).toBeGreaterThanOrEqual(1);
    t.pan(-1e12);
    expect(t.visible().hi).toBe(t.last);
  });
});

describe("PriceScale", () => {
  it("maps price to y and back, honouring margins", () => {
    const p = new PriceScale("right", { ...DEFAULT_PRICE_SCALE, marginTop: 0.2, marginBottom: 0.1 });
    p.height = 500;
    p.fit(100, 200);
    expect(p.y(200)).toBeCloseTo(100, 9);
    expect(p.y(100)).toBeCloseTo(450, 9);
    expect(p.price(p.y(137.25))).toBeCloseTo(137.25, 9);
  });

  it("gives a flat series a usable range", () => {
    const p = new PriceScale("right", { ...DEFAULT_PRICE_SCALE });
    p.height = 300;
    p.fit(42, 42);
    expect(p.max).toBeGreaterThan(p.min);
    expect(p.y(42)).toBeCloseTo(150, 6);
  });
});

describe("GPU upload precision", () => {
  // Stub GL: InstanceWindow only creates, binds and fills one buffer.
  let uploaded = new Float32Array(0);
  const gl = {
    ARRAY_BUFFER: 1,
    DYNAMIC_DRAW: 2,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: (_t: number, data: Float32Array) => void (uploaded = data.slice()),
    bufferSubData: () => {},
    deleteBuffer: () => {},
  } as unknown as WebGL2RenderingContext;

  it("keeps a ₹1,00,000 price zoomed to a 0.05 range within a device pixel", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    const n = 1000;
    const time = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      time[i] = i * 60_000;
      const p = 100_000 + Math.round(Math.sin(i / 7) * 10) * 0.005; // ±0.05 around 1e5 in 0.005 steps
      o[i] = p; c[i] = p + 0.005; h[i] = p + 0.01; l[i] = p - 0.005;
    }
    m.setData(s, { time, open: o, high: h, low: l, close: c });
    const win = new InstanceWindow(gl, s, false);
    win.ensure(0, 0, n - 1);

    const price = new PriceScale("right", { ...DEFAULT_PRICE_SCALE, marginTop: 0, marginBottom: 0 });
    price.height = 900; // CSS px
    price.fit(99_999.94, 100_000.07);
    const dpr = 2;
    // What the shader computes: y = u_y.y - p_rel * u_y.x, all in Float32.
    const uyx = Math.fround(price.pxPerUnit * dpr);
    const uyy = Math.fround(price.y(win.priceBase) * dpr);
    let worst = 0;
    for (let k = 0; k < win.count; k++) {
      const close = uploaded[k * RECORD_FLOATS + 4]!;
      const gpu = Math.fround(uyy - Math.fround(close * uyx));
      const exact = price.y(c[k]!) * dpr;
      worst = Math.max(worst, Math.abs(gpu - exact));
    }
    // The span is 0.13 over 1800 device px (~14,000 px per rupee); absolute
    // Float32 prices would be off by ~0.008 ₹ ≈ 110 px. Relative upload holds
    // well under one pixel.
    expect(worst).toBeLessThan(0.5);
    const naive = Math.abs(Math.fround(100_000.005) - 100_000.005) * price.pxPerUnit * dpr;
    expect(naive).toBeGreaterThan(1);
  });
});

describe("PriceScale modes", () => {
  const make = (mode: "linear" | "log" | "percent" | "indexed", invert = false) => {
    const p = new PriceScale("right", { ...DEFAULT_PRICE_SCALE, mode, invert, marginTop: 0, marginBottom: 0 });
    p.height = 400;
    p.base = 50;
    p.fit(10, 1000);
    return p;
  };
  for (const mode of ["linear", "log", "percent", "indexed"] as const) {
    for (const invert of [false, true]) {
      it(`${mode}${invert ? " inverted" : ""}: y and price are inverses, and y is affine in the uploaded coordinate`, () => {
        const p = make(mode, invert);
        for (const v of [10, 37.5, 100, 999]) {
          expect(p.price(p.y(v))).toBeCloseTo(v, 6);
          // What the GPU computes from the coordinate must equal y().
          const c = p.coord(v), c0 = p.coord(100);
          expect(p.yOfCoord(c0) + (c - c0) * p.pxPerCoord).toBeCloseTo(p.y(v), 6);
        }
        expect(p.y(1000) < p.y(10)).toBe(!invert);
      });
    }
  }
  it("log: decades are evenly spaced", () => {
    const p = make("log");
    expect(p.y(10) - p.y(100)).toBeCloseTo(p.y(100) - p.y(1000), 6);
  });
  it("percent: base sits at 0%", () => {
    const p = make("percent");
    expect(p.display(50)).toBe(0);
    expect(p.display(75)).toBeCloseTo(50, 9);
  });
});
