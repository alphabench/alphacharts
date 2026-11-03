import { describe, expect, it } from "vitest";
import { CHART_MESSAGES, defaultMessages, type ChartMessageKey } from "../src/chart/messages.js";

describe("chart messages", () => {
  it("English defaults reproduce the strings the chart always said", () => {
    expect(defaultMessages("chart.ariaLabel")).toBe("Price chart");
    expect(defaultMessages("chart.readout.ohlc", { name: "X", open: "1", high: "2", low: "0.5", close: "1.5" })).toBe("X open 1 high 2 low 0.5 close 1.5");
    expect(defaultMessages("chart.readout.value", { name: "RSI", value: "55.10" })).toBe("RSI 55.10");
    expect(defaultMessages("chart.table.caption", { label: "Price chart", name: "SYNTH" })).toBe("Price chart: SYNTH, visible bars, newest first");
    expect(defaultMessages("chart.countdown.days", { n: 3 })).toBe("3d");
  });
  it("fails loudly on an unknown key or a missing value", () => {
    expect(() => defaultMessages("chart.nope" as ChartMessageKey)).toThrow(/unknown chart message key/);
    expect(() => defaultMessages("chart.readout.value", { name: "x" })).toThrow(/needs a value for "value"/);
  });
  it("every key is namespaced", () => {
    for (const k of Object.keys(CHART_MESSAGES)) expect(k.startsWith("chart.")).toBe(true);
  });
});
