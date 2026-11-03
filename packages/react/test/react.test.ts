import { act, cleanup, render } from "@testing-library/react";
import { createElement as h, createRef, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chart, Dashboard, DashboardCell, PriceLine, Series, SyncGroup, useChart, useCrosshair, useVisibleRange } from "../src/index.js";
import { stats, type FakeChart, type FakeDashboard } from "./fake-core.js";

vi.mock("@alphacharts/core", async () => await import("./fake-core.js"));

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i * 60_000, open: 1, high: 2, low: 0.5, close: 1.5 }));
const chartOf = (i = 0): FakeChart => stats.charts[i]!;

beforeEach(() => stats.reset());
afterEach(() => cleanup());

describe("Chart", () => {
  it("creates one chart with the options on mount and removes it on unmount", () => {
    const { unmount, container } = render(h(Chart, { options: { theme: "light" } }));
    expect(stats.charts).toHaveLength(1);
    expect(chartOf().options).toEqual({ theme: "light" });
    expect(container.querySelectorAll(".fake-chart")).toHaveLength(1);
    unmount();
    expect(chartOf().removed).toBe(true);
    expect(container.querySelectorAll(".fake-chart")).toHaveLength(0);
  });

  it("exposes the core chart through the ref once mounted", () => {
    const ref = createRef<unknown>();
    render(h(Chart, { ref: ref as never }));
    expect(ref.current).toBe(chartOf());
  });

  it("forwards className and style to the host element", () => {
    const { container } = render(h(Chart, { className: "c", style: { height: 120 } }));
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toBe("c");
    expect(el.style.height).toBe("120px");
  });

  it("applies only changed option groups, and nothing for an equal inline literal", () => {
    const { rerender } = render(h(Chart, { options: { theme: "dark", crosshair: { mode: "magnet" } } }));
    rerender(h(Chart, { options: { theme: "dark", crosshair: { mode: "magnet" } } }));
    expect(chartOf().applied).toEqual([]);
    rerender(h(Chart, { options: { theme: "light", crosshair: { mode: "magnet" } } }));
    expect(chartOf().applied).toEqual([{ theme: "light" }]);
    rerender(h(Chart, { options: { theme: "light", crosshair: { mode: "normal" } } }));
    expect(chartOf().applied).toEqual([{ theme: "light" }, { crosshair: { mode: "normal" } }]);
    expect(stats.charts).toHaveLength(1);
  });

  it("subscribes only handlers that are present, once, and calls the latest closure", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(h(Chart, { onCrosshairMove: first }));
    const c = chartOf();
    expect(c.listenerCount("crosshairMove")).toBe(1);
    expect(c.listenerCount("click")).toBe(0);
    rerender(h(Chart, { onCrosshairMove: second }));
    expect(c.listenerCount("crosshairMove")).toBe(1);
    c.emit("crosshairMove", { source: "pointer" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    rerender(h(Chart, {}));
    expect(c.listenerCount()).toBe(0);
  });

  it("forwards click, dblclick and visibleRangeChange", () => {
    const click = vi.fn(), dbl = vi.fn(), range = vi.fn();
    render(h(Chart, { onClick: click, onDblClick: dbl, onVisibleRangeChange: range }));
    chartOf().emit("click", 1);
    chartOf().emit("dblclick", 2);
    chartOf().emit("visibleRangeChange", 3);
    expect([click, dbl, range].map((f) => f.mock.calls[0]?.[0])).toEqual([1, 2, 3]);
  });
});

describe("Series", () => {
  const withSeries = (p: Record<string, unknown>, ...kids: ReactNode[]) => h(Chart, {}, h(Series as never, p, ...kids));

  it("adds the series with its options and sets the data once", () => {
    const data = bars(3);
    render(withSeries({ type: "candles", options: { title: "X" }, data }));
    const s = chartOf().series[0]!;
    expect(s.type).toBe("candles");
    expect(s.given).toEqual({ title: "X" });
    expect(s.calls).toEqual([["setData", data]]);
  });

  it("does not call setData again for the same array, and calls it for a new one", () => {
    const data = bars(3);
    const { rerender } = render(withSeries({ type: "candles", data }));
    rerender(withSeries({ type: "candles", data }));
    const s = chartOf().series[0]!;
    expect(s.count("setData")).toBe(1);
    const next = bars(4);
    rerender(withSeries({ type: "candles", data: next }));
    expect(s.count("setData")).toBe(2);
    expect(s.calls[1]).toEqual(["setData", next]);
  });

  it("routes live bars through update(), never setData", () => {
    const data = bars(3);
    const { rerender } = render(withSeries({ type: "candles", data, update: undefined }));
    const s = chartOf().series[0]!;
    for (let i = 0; i < 100; i++) rerender(withSeries({ type: "candles", data, update: { ...data[2]!, time: 3 * 60_000 + i, close: i } }));
    expect(s.count("setData")).toBe(1);
    expect(s.count("update")).toBe(100);
    expect(s.calls.at(-1)).toEqual(["update", { ...data[2]!, time: 3 * 60_000 + 99, close: 99 }]);
  });

  it("updates after setData on a fresh series", () => {
    const bar = { time: 5, open: 1, high: 1, low: 1, close: 1 };
    render(withSeries({ type: "candles", data: bars(2), update: bar }));
    expect(chartOf().series[0]!.calls.map((c) => c[0])).toEqual(["setData", "update"]);
  });

  it("diffs series options shallowly", () => {
    const { rerender } = render(withSeries({ type: "line", options: { color: "#fff", lineWidth: 1 } }));
    const s = chartOf().series[0]!;
    rerender(withSeries({ type: "line", options: { color: "#fff", lineWidth: 1 } }));
    expect(s.count("applyOptions")).toBe(0);
    rerender(withSeries({ type: "line", options: { color: "#000", lineWidth: 1 } }));
    expect(s.calls.filter((c) => c[0] === "applyOptions")).toEqual([["applyOptions", { color: "#000" }]]);
  });

  it("applies price-scale options to the series' own scale at creation, then only what changed", () => {
    const { rerender } = render(withSeries({ type: "histogram", options: { priceScaleId: "vol", pane: 1 }, priceScale: { marginTop: 0.8, marginBottom: 0 } }));
    expect(chartOf().scaleCalls).toEqual([["1:vol", { marginTop: 0.8, marginBottom: 0 }]]);
    rerender(withSeries({ type: "histogram", options: { priceScaleId: "vol", pane: 1 }, priceScale: { marginTop: 0.8, marginBottom: 0 } }));
    expect(chartOf().scaleCalls).toHaveLength(1);
    rerender(withSeries({ type: "histogram", options: { priceScaleId: "vol", pane: 1 }, priceScale: { marginTop: 0.7, marginBottom: 0 } }));
    expect(chartOf().scaleCalls.at(-1)).toEqual(["1:vol", { marginTop: 0.7 }]);
  });

  it("replaces the series when its type changes and removes the old one", () => {
    const { rerender } = render(withSeries({ type: "line", data: [{ time: 1, value: 1 }] }));
    rerender(withSeries({ type: "area", data: [{ time: 1, value: 1 }] }));
    const [a, b] = chartOf().series;
    expect(a!.removed).toBe(true);
    expect(b!.type).toBe("area");
    expect(b!.removed).toBe(false);
    expect(b!.count("setData")).toBe(1);
  });

  it("switching type and data in one render gives the new series the new data and never touches the removed one", () => {
    const pts = [{ time: 1, value: 1 }];
    const { rerender } = render(withSeries({ type: "candles", data: bars(2) }));
    rerender(withSeries({ type: "line", data: pts }));
    const [a, b] = chartOf().series;
    expect(a!.count("setData")).toBe(1);
    expect(b!.calls).toEqual([["setData", pts]]);
  });

  it("re-applies the whole price-scale options when the series moves to another scale", () => {
    const priceScale = { visible: false };
    const { rerender } = render(withSeries({ type: "line", options: { pane: 0 }, priceScale }));
    rerender(withSeries({ type: "line", options: { pane: 1 }, priceScale }));
    expect(chartOf().scaleCalls).toEqual([["0:right", { visible: false }], ["1:right", { visible: false }]]);
  });

  it("removes the series when it unmounts alone, and not on a chart that is already gone", () => {
    const { rerender, unmount } = render(withSeries({ type: "line" }));
    const s = chartOf().series[0]!;
    rerender(h(Chart, {}));
    expect(s.removed).toBe(true);
    rerender(withSeries({ type: "line" }));
    expect(() => unmount()).not.toThrow();
  });

  it("exposes the series through the ref", () => {
    const ref = createRef<unknown>();
    render(h(Chart, {}, h(Series as never, { type: "line", ref })));
    expect(ref.current).toBe(chartOf().series[0]);
  });

  it("refuses to render outside a Chart", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(h(Series as never, { type: "line" }))).toThrow(/inside <Chart>/);
    err.mockRestore();
  });
});

describe("PriceLine", () => {
  const withLine = (price: number, color = "#f00") => h(Chart, {}, h(Series as never, { type: "candles" }, h(PriceLine, { price, color })));

  it("creates a line, moves it with applyOptions, removes it on unmount", () => {
    const { rerender, unmount } = render(withLine(10));
    const s = chartOf().series[0]!;
    expect(s.lines).toHaveLength(1);
    const line = s.lines[0]!;
    expect(line.options).toEqual({ price: 10, color: "#f00" });
    rerender(withLine(11));
    expect(line.applied).toEqual([{ price: 11 }]);
    rerender(withLine(11));
    expect(line.applied).toHaveLength(1);
    unmount();
    expect(chartOf().removed).toBe(true);
  });

  it("removes its line when only it unmounts", () => {
    const { rerender } = render(withLine(10));
    rerender(h(Chart, {}, h(Series as never, { type: "candles" })));
    expect(chartOf().series[0]!.lines).toHaveLength(0);
  });
});

describe("StrictMode (double mount)", () => {
  it("ends with exactly one live chart, series and listener set; the first is removed", () => {
    const seen = vi.fn();
    const ui = h(StrictMode, null, h(Chart, { onCrosshairMove: seen }, h(Series as never, { type: "candles", data: bars(2) }, h(PriceLine, { price: 1 }))));
    const { unmount } = render(ui);
    expect(stats.liveCharts()).toBe(1);
    const live = stats.charts.filter((c) => !c.removed);
    expect(live[0]!.listenerCount("crosshairMove")).toBe(1);
    const liveSeries = live[0]!.series.filter((s) => !s.removed);
    expect(liveSeries).toHaveLength(1);
    expect(liveSeries[0]!.count("setData")).toBeGreaterThanOrEqual(1);
    expect(liveSeries[0]!.lines).toHaveLength(1);
    unmount();
    expect(stats.liveCharts()).toBe(0);
    expect(stats.listeners()).toBe(0);
  });
});

describe("leaks", () => {
  it("50 mount/unmount cycles leave no live chart, listener, series or DOM", () => {
    for (let i = 0; i < 50; i++) {
      const { unmount } = render(
        h(StrictMode, null, h(Chart, { onCrosshairMove: () => {}, onVisibleRangeChange: () => {}, onClick: () => {} }, h(Series as never, { type: "candles", data: bars(2) }, h(PriceLine, { price: 1 })))),
      );
      unmount();
    }
    expect(stats.charts.length).toBe(100); // StrictMode makes two per mount
    expect(stats.liveCharts()).toBe(0);
    expect(stats.listeners()).toBe(0);
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(0);
  });
});

describe("Dashboard, cells and SyncGroup", () => {
  const dash = (cells: number) =>
    h(Dashboard, { options: { renderer: "auto" } }, h(SyncGroup, {}, ...Array.from({ length: cells }, (_, i) => h(DashboardCell, { key: i, options: { theme: "dark" } }, h(Series as never, { type: "line" })))));

  it("makes one dashboard whose cells are charts inside it, all in one sync group", () => {
    const { unmount } = render(dash(4));
    expect(stats.dashboards).toHaveLength(1);
    const d = stats.dashboards[0] as FakeDashboard;
    expect(d.options).toEqual({ renderer: "auto" });
    expect(d.charts).toHaveLength(4);
    expect(stats.groups).toHaveLength(1);
    expect(stats.groups[0]!.members.size).toBe(4);
    expect(stats.charts.every((c) => c.series.length === 1)).toBe(true);
    unmount();
    expect(d.removed).toBe(true);
    expect(stats.liveCharts()).toBe(0);
    expect(stats.groups[0]!.members.size).toBe(0);
  });

  it("removing one cell removes only its chart and leaves the group", () => {
    const { rerender } = render(dash(3));
    rerender(dash(2));
    expect(stats.charts.filter((c) => !c.removed)).toHaveLength(2);
    expect(stats.groups[0]!.members.size).toBe(2);
  });

  it("charts outside a dashboard join the SyncGroup too, and a cell outside a Dashboard throws", () => {
    render(h(SyncGroup, {}, h(Chart, {}), h(Chart, {})));
    expect(stats.groups[0]!.members.size).toBe(2);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(h(DashboardCell, {}))).toThrow(/inside <Dashboard>/);
    err.mockRestore();
  });

  it("StrictMode leaves four live cells and one live dashboard", () => {
    const { unmount } = render(h(StrictMode, null, dash(4)));
    expect(stats.charts.filter((c) => !c.removed)).toHaveLength(4);
    expect(stats.dashboards.filter((d) => !d.removed)).toHaveLength(1);
    unmount();
    expect(stats.liveCharts()).toBe(0);
  });

  it("makes a new group when its options change and re-joins the charts", () => {
    const { rerender } = render(h(SyncGroup, { crosshair: true }, h(Chart, {})));
    rerender(h(SyncGroup, { crosshair: false }, h(Chart, {})));
    expect(stats.groups).toHaveLength(2);
    expect(stats.groups[0]!.members.size).toBe(0);
    expect(stats.groups[1]!.members.size).toBe(1);
    expect(stats.groups[1]!.options).toEqual({ crosshair: false });
  });
});

describe("hooks", () => {
  it("useCrosshair and useVisibleRange follow the chart; useChart gives it", () => {
    let chart: unknown;
    const Probe = () => {
      chart = useChart();
      const x = useCrosshair();
      const r = useVisibleRange();
      return h("output", null, `${x?.time ?? "-"}|${r ? `${r.from},${r.to}` : "-"}`);
    };
    const { container, unmount } = render(h(Chart, {}, h(Probe)));
    expect(chart).toBe(chartOf());
    expect(container.querySelector("output")!.textContent).toBe("-|1,2");
    act(() => chartOf().emit("crosshairMove", { time: 42, source: "pointer" }));
    act(() => chartOf().emit("visibleRangeChange", { from: 3, to: 9, source: "user" }));
    expect(container.querySelector("output")!.textContent).toBe("42|3,9");
    unmount();
    expect(stats.listeners()).toBe(0);
  });

  it("useChart outside a chart throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(h(() => (useChart(), null)))).toThrow(/inside <Chart>/);
    err.mockRestore();
  });
});
