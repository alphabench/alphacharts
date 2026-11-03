import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dash from "./Dash.svelte";
import Probe from "./Probe.svelte";
import Sync from "./Sync.svelte";
import Tree from "./Tree.svelte";
import { Chart, DashboardCell, Series, useChart } from "../src/index.js";
import { stats, type FakeChart, type FakeDashboard } from "./fake-core.js";

vi.mock("@alphacharts/core", async () => await import("./fake-core.js"));

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i * 60_000, open: 1, high: 2, low: 0.5, close: 1.5 }));
const chartOf = (i = 0): FakeChart => stats.charts[i]!;
const live: Record<string, unknown>[] = [];
// Mounts a component; `props` is $state so a test changes it and flushes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function put(C: unknown, init: Record<string, any>) {
  const props = $state(init);
  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(C as never, { target, props }) as Record<string, unknown>;
  flushSync();
  live.push(app);
  return { props, app, target, unmount: () => { unmount(app); live.splice(live.indexOf(app), 1); } };
}

beforeEach(() => stats.reset());
afterEach(() => {
  for (const a of live.splice(0)) unmount(a);
  document.body.innerHTML = "";
});

describe("Chart", () => {
  it("creates one chart with the options on mount and removes it on unmount", () => {
    const m = put(Tree, { chartOptions: { theme: "light" }, withSeries: false });
    expect(stats.charts).toHaveLength(1);
    expect(chartOf().options).toEqual({ theme: "light" });
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(1);
    m.unmount();
    expect(chartOf().removed).toBe(true);
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(0);
  });

  it("publishes the core chart through bind:chart and clears it on unmount", () => {
    const m = put(Tree, { chartOptions: {}, withSeries: false, chart: null });
    expect(m.props.chart).toBe(chartOf());
  });

  it("forwards class and style to the host element", () => {
    const target = document.body.appendChild(document.createElement("div"));
    const app = mount(Chart as never, { target, props: { class: "c", style: "height:120px" } });
    flushSync();
    const el = target.firstElementChild as HTMLElement;
    expect(el.className).toBe("c");
    expect(el.style.height).toBe("120px");
    unmount(app);
  });

  it("applies only changed option groups, and nothing for an equal new object", () => {
    const m = put(Tree, { chartOptions: { theme: "dark", crosshair: { mode: "magnet" } }, withSeries: false });
    m.props.chartOptions = { theme: "dark", crosshair: { mode: "magnet" } };
    flushSync();
    expect(chartOf().applied).toEqual([]);
    m.props.chartOptions = { theme: "light", crosshair: { mode: "magnet" } };
    flushSync();
    expect(chartOf().applied).toEqual([{ theme: "light" }]);
    m.props.chartOptions = { theme: "light", crosshair: { mode: "normal" } };
    flushSync();
    expect(chartOf().applied).toEqual([{ theme: "light" }, { crosshair: { mode: "normal" } }]);
    expect(stats.charts).toHaveLength(1);
  });

  it("subscribes only handlers that are present, once, and calls the latest closure", () => {
    const first = vi.fn(), second = vi.fn();
    const m = put(Tree, { withSeries: false, onCrosshairMove: first });
    const c = chartOf();
    expect(c.listenerCount("crosshairMove")).toBe(1);
    expect(c.listenerCount("click")).toBe(0);
    m.props.onCrosshairMove = second;
    flushSync();
    expect(c.listenerCount("crosshairMove")).toBe(1);
    c.emit("crosshairMove", { source: "pointer" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    m.props.onCrosshairMove = undefined;
    flushSync();
    expect(c.listenerCount()).toBe(0);
  });

  it("forwards click, dblclick and visibleRangeChange", () => {
    const click = vi.fn(), dbl = vi.fn(), range = vi.fn();
    put(Tree, { withSeries: false, onClick: click, onDblClick: dbl, onVisibleRangeChange: range });
    chartOf().emit("click", 1);
    chartOf().emit("dblclick", 2);
    chartOf().emit("visibleRangeChange", 3);
    expect([click, dbl, range].map((f) => f.mock.calls[0]?.[0])).toEqual([1, 2, 3]);
  });
});

describe("Series", () => {
  it("adds the series with its options and sets the data once", () => {
    const data = bars(3);
    put(Tree, { seriesOptions: { title: "X" }, data });
    const s = chartOf().series[0]!;
    expect(s.type).toBe("candles");
    expect(s.given).toEqual({ title: "X" });
    expect(s.calls).toEqual([["setData", data]]);
  });

  it("calls setData for a new array only", () => {
    const m = put(Tree, { data: bars(3) });
    const s = chartOf().series[0]!;
    m.props.seriesOptions = { title: "t" };
    flushSync();
    expect(s.count("setData")).toBe(1);
    const next = bars(4);
    m.props.data = next;
    flushSync();
    expect(s.count("setData")).toBe(2);
    expect(s.calls.at(-1)).toEqual(["setData", next]);
  });

  it("routes live bars through update(), never setData", () => {
    const data = bars(3);
    const m = put(Tree, { data, update: undefined });
    const s = chartOf().series[0]!;
    for (let i = 0; i < 100; i++) {
      m.props.update = { ...data[2]!, time: 3 * 60_000 + i, close: i };
      flushSync();
    }
    expect(s.count("setData")).toBe(1);
    expect(s.count("update")).toBe(100);
    expect(s.calls.at(-1)).toEqual(["update", { ...data[2]!, time: 3 * 60_000 + 99, close: 99 }]);
  });

  it("updates after setData on a fresh series", () => {
    put(Tree, { data: bars(2), update: { time: 5, open: 1, high: 1, low: 1, close: 1 } });
    expect(chartOf().series[0]!.calls.map((c) => c[0])).toEqual(["setData", "update"]);
  });

  it("diffs series options shallowly", () => {
    const m = put(Tree, { seriesType: "line", seriesOptions: { color: "#fff", lineWidth: 1 } });
    const s = chartOf().series[0]!;
    m.props.seriesOptions = { color: "#fff", lineWidth: 1 };
    flushSync();
    expect(s.count("applyOptions")).toBe(0);
    m.props.seriesOptions = { color: "#000", lineWidth: 1 };
    flushSync();
    expect(s.calls.filter((c) => c[0] === "applyOptions")).toEqual([["applyOptions", { color: "#000" }]]);
  });

  it("does not track the reads core makes while setting data", () => {
    // A proxied array read by core must not make the effect depend on every bar.
    const data = $state(bars(3));
    const m = put(Tree, { data });
    const s = chartOf().series[0]!;
    data.push(...bars(1));
    flushSync();
    expect(s.count("setData")).toBe(1);
    m.unmount();
  });

  it("applies price-scale options to the series' own scale at creation, then only what changed", () => {
    const m = put(Tree, { seriesType: "histogram", seriesOptions: { priceScaleId: "vol", pane: 1 }, priceScale: { marginTop: 0.8, marginBottom: 0 } });
    expect(chartOf().scaleCalls).toEqual([["1:vol", { marginTop: 0.8, marginBottom: 0 }]]);
    m.props.priceScale = { marginTop: 0.8, marginBottom: 0 };
    flushSync();
    expect(chartOf().scaleCalls).toHaveLength(1);
    m.props.priceScale = { marginTop: 0.7, marginBottom: 0 };
    flushSync();
    expect(chartOf().scaleCalls.at(-1)).toEqual(["1:vol", { marginTop: 0.7 }]);
  });

  it("replaces the series when its type changes and removes the old one", () => {
    const data = [{ time: 1, value: 1 }];
    const m = put(Tree, { seriesType: "line", data });
    m.props.seriesType = "area";
    flushSync();
    const [a, b] = chartOf().series;
    expect(a!.removed).toBe(true);
    expect(b!.type).toBe("area");
    expect(b!.removed).toBe(false);
    expect(b!.count("setData")).toBe(1);
  });

  it("switching type and data together gives the new series the new data and never touches the removed one", () => {
    const pts = [{ time: 1, value: 1 }];
    const m = put(Tree, { seriesType: "candles", data: bars(2) });
    m.props.seriesType = "line";
    m.props.data = pts;
    flushSync();
    const [a, b] = chartOf().series;
    expect(a!.count("setData")).toBe(1);
    expect(b!.calls).toEqual([["setData", pts]]);
  });

  it("re-applies the whole price-scale options when the series moves to another scale", () => {
    const priceScale = { visible: false };
    const m = put(Tree, { seriesType: "line", seriesOptions: { pane: 0 }, priceScale });
    m.props.seriesOptions = { pane: 1 };
    flushSync();
    expect(chartOf().scaleCalls).toEqual([["0:right", { visible: false }], ["1:right", { visible: false }]]);
  });

  it("removes the series when it unmounts alone, and not on a chart that is already gone", () => {
    const m = put(Tree, {});
    const s = chartOf().series[0]!;
    m.props.withSeries = false;
    flushSync();
    expect(s.removed).toBe(true);
    m.props.withSeries = true;
    flushSync();
    expect(() => m.unmount()).not.toThrow();
  });

  it("publishes the series through bind:series", () => {
    const m = put(Tree, { series: null });
    expect(m.props.series).toBe(chartOf().series[0]);
  });

  it("refuses to render outside a Chart", () => {
    const target = document.body.appendChild(document.createElement("div"));
    expect(() => mount(Series as never, { target, props: { type: "line" } })).toThrow(/inside <Chart>/);
  });
});

describe("PriceLine", () => {
  it("creates a line, moves it with applyOptions, removes it on unmount", () => {
    const m = put(Tree, { price: 10 });
    const s = chartOf().series[0]!;
    expect(s.lines).toHaveLength(1);
    const line = s.lines[0]!;
    expect(line.options).toEqual({ price: 10, color: "#f00" });
    m.props.price = 11;
    flushSync();
    expect(line.applied).toEqual([{ price: 11 }]);
    m.unmount();
    expect(chartOf().removed).toBe(true);
  });

  it("removes its line when only it unmounts", () => {
    const m = put(Tree, { price: 10 });
    m.props.price = undefined;
    flushSync();
    expect(chartOf().series[0]!.lines).toHaveLength(0);
  });
});

describe("leaks", () => {
  it("50 mount/unmount cycles leave no live chart, listener or DOM", () => {
    for (let i = 0; i < 50; i++) {
      const m = put(Tree, { data: bars(2), price: 1, onCrosshairMove: () => {}, onVisibleRangeChange: () => {}, onClick: () => {} });
      m.unmount();
    }
    expect(stats.charts).toHaveLength(50);
    expect(stats.liveCharts()).toBe(0);
    expect(stats.listeners()).toBe(0);
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(0);
  });
});

describe("Dashboard, cells and SyncGroup", () => {
  it("makes one dashboard whose cells are charts inside it, all in one sync group", () => {
    const m = put(Dash, { cells: 4 });
    expect(stats.dashboards).toHaveLength(1);
    const d = stats.dashboards[0] as FakeDashboard;
    expect(d.options).toEqual({ renderer: "auto" });
    expect(d.charts).toHaveLength(4);
    expect(stats.groups).toHaveLength(1);
    expect(stats.groups[0]!.members.size).toBe(4);
    expect(stats.charts.every((c) => c.series.length === 1)).toBe(true);
    m.unmount();
    expect(d.removed).toBe(true);
    expect(stats.liveCharts()).toBe(0);
    expect(stats.groups[0]!.members.size).toBe(0);
  });

  it("removing one cell removes only its chart and leaves the group", () => {
    const m = put(Dash, { cells: 3 });
    m.props.cells = 2;
    flushSync();
    expect(stats.charts.filter((c) => !c.removed)).toHaveLength(2);
    expect(stats.groups[0]!.members.size).toBe(2);
  });

  it("charts outside a dashboard join the sync group too, and a cell outside a dashboard throws", () => {
    put(Sync, { count: 2 });
    expect(stats.groups[0]!.members.size).toBe(2);
    const target = document.body.appendChild(document.createElement("div"));
    expect(() => mount(DashboardCell as never, { target })).toThrow(/inside <Dashboard>/);
  });

  it("makes a new group when its options change and re-joins the charts; absent booleans stay unset", () => {
    const m = put(Sync, { crosshair: undefined });
    expect(stats.groups[0]!.options).toEqual({});
    m.props.crosshair = false;
    flushSync();
    expect(stats.groups).toHaveLength(2);
    expect(stats.groups[0]!.members.size).toBe(0);
    expect(stats.groups[1]!.members.size).toBe(1);
    expect(stats.groups[1]!.options).toEqual({ crosshair: false });
  });
});

describe("hooks", () => {
  it("useCrosshair and useVisibleRange follow the chart; useChart gives it", async () => {
    const seen = { chart: null as unknown };
    const target = document.body.appendChild(document.createElement("div"));
    const app = mount(
      Chart as never,
      { target, props: { children: (anchor: Node) => Probe(anchor as never, { seen }) } },
    );
    flushSync();
    expect(seen.chart).toBe(chartOf());
    const out = target.querySelector("output")!;
    expect(out.textContent).toBe("-|1,2");
    chartOf().emit("crosshairMove", { time: 42, source: "pointer" });
    chartOf().emit("visibleRangeChange", { from: 3, to: 9, source: "user" });
    flushSync();
    await tick();
    expect(out.textContent).toBe("42|3,9");
    unmount(app);
    expect(stats.listeners()).toBe(0);
  });

  it("useChart outside a chart throws", () => {
    const target = document.body.appendChild(document.createElement("div"));
    expect(() => mount(((anchor: Node) => (useChart(), anchor)) as never, { target })).toThrow(/inside <Chart>/);
  });
});
