import { describe, expect, it } from "vitest";
import { checkCustomOptions, migrate } from "../src/chart/layout.js";

const base = { version: 1, options: {}, panes: [], series: [], view: { spacing: 6, rightOffset: 0 }, plugins: {} };

describe("custom options in a layout", () => {
  it("a layout saved without a timeLabel needs none", () => {
    expect(() => checkCustomOptions(migrate(base), {})).not.toThrow();
  });
  it("a layout that marks a timeLabel is refused without one, naming what to pass", () => {
    const st = migrate({ ...base, customOptions: ["timeLabel"] });
    expect(() => checkCustomOptions(st, {})).toThrow(/custom timeLabel.*restoreState\(\{ timeLabel \}\)/);
    expect(() => checkCustomOptions(st, { timeLabel: "no" })).toThrow(/custom timeLabel/);
  });
  it("and accepted with one", () => {
    expect(() => checkCustomOptions(migrate({ ...base, customOptions: ["timeLabel"] }), { timeLabel: () => "x" })).not.toThrow();
  });
});
