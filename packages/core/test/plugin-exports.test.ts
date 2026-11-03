import { describe, expect, it } from "vitest";
import { COL_C, COL_H, COL_L, COL_O, DataModel } from "../src/data/model.js";
import { timeText } from "../src/scale/ticks.js";
import { LOD_BASE, LOD_C, LOD_COLOR, LOD_H, LOD_L, LOD_O } from "../src/index.js";

// Plugin renderers read LOD buckets by column; these exports are that contract.
describe("LOD column exports", () => {
  it("index the open-first, high-max, low-min, close-last columns of a bucket", () => {
    const m = new DataModel();
    const s = m.add("ohlc");
    const n = 1 << LOD_BASE;
    const bars = Array.from({ length: n }, (_, i) => ({ time: (i + 1) * 1000, open: 10 + i, high: 20 + i, low: 5 - i, close: 11 + i }));
    m.setData(s, bars);
    const lv = s.lod.level(LOD_BASE)!;
    const p = lv.pos(0);
    expect(lv.cols[LOD_O]![p]).toBe(10);
    expect(lv.cols[LOD_H]![p]).toBe(20 + n - 1);
    expect(lv.cols[LOD_L]![p]).toBe(5 - (n - 1));
    expect(lv.cols[LOD_C]![p]).toBe(11 + n - 1);
    expect([LOD_O, LOD_H, LOD_L, LOD_C, LOD_COLOR]).toEqual([COL_O, COL_H, COL_L, COL_C, 4]);
  });
});

// timeLabel: the host's text replaces the calendar's, and a bad one fails loudly.
describe("timeText", () => {
  it("uses the calendar text without a host label", () => {
    expect(timeText(undefined, "tick", 5, () => "Jan 1")).toBe("Jan 1");
  });
  it("uses the host label, passing the time and where the text goes", () => {
    const seen: unknown[][] = [];
    const s = timeText((t, k) => (seen.push([t, k]), `#${t}`), "crosshair", 7, () => "never");
    expect(s).toBe("#7");
    expect(seen).toEqual([[7, "crosshair"]]);
  });
  it("throws when the host label is not a string", () => {
    expect(() => timeText((() => 3) as never, "tick", 9, () => "x")).toThrow(/not a string/);
  });
});

// The rendering internals live in "@alphacharts/core/internal"; the public entry must not grow them back.
describe("internal subpath", () => {
  it("keeps rendering internals out of the public entry and in ./internal", async () => {
    const pub = await import("../src/index.js");
    const internal = await import("../src/internal.js");
    for (const name of ["GLContext", "GLSL_COMMON", "InstanceWindow", "RECORD_FLOATS", "RECORD_BYTES", "HOLE_TEST", "chooseLevel"]) {
      expect(name in pub, `${name} on the public entry`).toBe(false);
      expect(name in internal, `${name} on ./internal`).toBe(true);
    }
  });
});
