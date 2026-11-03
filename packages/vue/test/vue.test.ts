import { mount } from "@vue/test-utils";
import { defineComponent, h, isProxy, nextTick, reactive, ref, shallowRef, type Component, type VNode } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcChart as RealChart, AcDashboard as RealDashboard, AcDashboardCell as RealCell, AcPriceLine as RealLine, AcSeries as RealSeries, AcSyncGroup as RealSync, useChart, useCrosshair, useVisibleRange } from "../src/index.js";
import { FakeSeries, stats, type FakeChart, type FakeDashboard } from "./fake-core.js";

vi.mock("@alphacharts/core", async () => await import("./fake-core.js"));

const bars = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i * 60_000, open: 1, high: 2, low: 0.5, close: 1.5 }));
const chartOf = (i = 0): FakeChart => stats.charts[i]!;
// Loosely typed so a test can pass the odd shape (a string theme, an undefined handler) a user's template might.
const AcChart = RealChart as Component, AcDashboard = RealDashboard as Component, AcDashboardCell = RealCell as Component;
const AcPriceLine = RealLine as Component, AcSyncGroup = RealSync as Component, Series = RealSeries as unknown as Component;
const mounted: ReturnType<typeof mount>[] = [];
const mountTree = (render: () => VNode) => {
  const w = mount(defineComponent({ render }), { attachTo: document.body });
  mounted.push(w);
  return w;
};

beforeEach(() => stats.reset());
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("AcChart", () => {
  it("creates one chart with the options on mount and removes it on unmount", () => {
    const w = mountTree(() => h(AcChart, { options: { theme: "light" } }));
    expect(stats.charts).toHaveLength(1);
    expect(chartOf().options).toEqual({ theme: "light" });
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(1);
    w.unmount();
    expect(chartOf().removed).toBe(true);
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(0);
  });

  it("exposes the core chart through a template ref and falls class/style through to the host", () => {
    const r = ref<{ chart: unknown } | null>(null);
    const w = mountTree(() => h(AcChart, { ref: r, class: "c", style: { height: "120px" } }));
    expect(r.value!.chart).toBe(chartOf());
    expect(w.element.className).toBe("c");
    expect((w.element as HTMLElement).style.height).toBe("120px");
  });

  it("applies only changed option groups, and nothing for an equal new object", async () => {
    const options = shallowRef<Record<string, unknown>>({ theme: "dark", crosshair: { mode: "magnet" } });
    mountTree(() => h(AcChart, { options: options.value }));
    options.value = { theme: "dark", crosshair: { mode: "magnet" } };
    await nextTick();
    expect(chartOf().applied).toEqual([]);
    options.value = { theme: "light", crosshair: { mode: "magnet" } };
    await nextTick();
    expect(chartOf().applied).toEqual([{ theme: "light" }]);
    options.value = { theme: "light", crosshair: { mode: "normal" } };
    await nextTick();
    expect(chartOf().applied).toEqual([{ theme: "light" }, { crosshair: { mode: "normal" } }]);
    expect(stats.charts).toHaveLength(1);
  });

  it("sees in-place changes of a reactive options object, one group deep, and passes core plain objects", async () => {
    const options = reactive({ theme: "dark", crosshair: { mode: "magnet" } });
    mountTree(() => h(AcChart, { options }));
    options.crosshair.mode = "normal";
    await nextTick();
    expect(chartOf().applied).toEqual([{ crosshair: { mode: "normal" } }]);
    expect(isProxy(chartOf().applied[0]!.crosshair)).toBe(false);
    expect(isProxy(chartOf().options.crosshair)).toBe(false);
  });

  it("subscribes only handlers that are present, once, and calls the latest closure", async () => {
    const first = vi.fn(), second = vi.fn();
    const handler = shallowRef<((e: unknown) => void) | undefined>(first);
    mountTree(() => h(AcChart, { onCrosshairMove: handler.value }));
    const c = chartOf();
    expect(c.listenerCount("crosshairMove")).toBe(1);
    expect(c.listenerCount("click")).toBe(0);
    handler.value = second;
    await nextTick();
    expect(c.listenerCount("crosshairMove")).toBe(1);
    c.emit("crosshairMove", { source: "pointer" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    handler.value = undefined;
    await nextTick();
    expect(c.listenerCount()).toBe(0);
  });

  it("forwards click, dblclick and visibleRangeChange", () => {
    const click = vi.fn(), dbl = vi.fn(), range = vi.fn();
    mountTree(() => h(AcChart, { onClick: click, onDblclick: dbl, onVisibleRangeChange: range }));
    chartOf().emit("click", 1);
    chartOf().emit("dblclick", 2);
    chartOf().emit("visibleRangeChange", 3);
    expect([click, dbl, range].map((f) => f.mock.calls[0]?.[0])).toEqual([1, 2, 3]);
  });

  it("removes and re-creates the chart cleanly under v-if toggling (double mount)", async () => {
    const show = ref(true);
    mountTree(() => h("div", show.value ? [h(AcChart, { onClick: () => {} }, () => h(Series, { type: "candles", data: bars(2) }))] : []));
    show.value = false;
    await nextTick();
    show.value = true;
    await nextTick();
    expect(stats.charts).toHaveLength(2);
    expect(stats.charts.map((c) => c.removed)).toEqual([true, false]);
    expect(chartOf(1).listenerCount("click")).toBe(1);
    expect(chartOf(1).series).toHaveLength(1);
  });
});

describe("AcSeries", () => {
  const tree = (p: () => Record<string, unknown>, kids?: () => VNode) => () => h(AcChart, null, () => h(Series, p(), kids));

  it("adds the series with its options and sets the data once", () => {
    const data = bars(3);
    mountTree(tree(() => ({ type: "candles", options: { title: "X" }, data })));
    const s = chartOf().series[0]!;
    expect(s.type).toBe("candles");
    expect(s.given).toEqual({ title: "X" });
    expect(s.calls).toEqual([["setData", data]]);
  });

  it("calls setData for a new array only, and unwraps a reactive one", async () => {
    const data = shallowRef(bars(3));
    mountTree(tree(() => ({ type: "candles", data: data.value, options: { title: "t" } })));
    await nextTick();
    const s = chartOf().series[0]!;
    expect(s.count("setData")).toBe(1);
    data.value = bars(4);
    await nextTick();
    expect(s.count("setData")).toBe(2);
    const deep = reactive(bars(2));
    data.value = deep as never;
    await nextTick();
    expect(isProxy(s.calls.at(-1)![1])).toBe(false);
  });

  it("routes live bars through update(), never setData", async () => {
    const data = bars(3);
    const bar = shallowRef<unknown>(undefined);
    mountTree(tree(() => ({ type: "candles", data, update: bar.value })));
    const s = chartOf().series[0]!;
    for (let i = 0; i < 100; i++) {
      bar.value = { ...data[2]!, time: 3 * 60_000 + i, close: i };
      await nextTick();
    }
    expect(s.count("setData")).toBe(1);
    expect(s.count("update")).toBe(100);
    expect(s.calls.at(-1)).toEqual(["update", { ...data[2]!, time: 3 * 60_000 + 99, close: 99 }]);
  });

  it("updates after setData on a fresh series", () => {
    mountTree(tree(() => ({ type: "candles", data: bars(2), update: { time: 5, open: 1, high: 1, low: 1, close: 1 } })));
    expect(chartOf().series[0]!.calls.map((c) => c[0])).toEqual(["setData", "update"]);
  });

  it("diffs series options shallowly", async () => {
    const options = shallowRef({ color: "#fff", lineWidth: 1 });
    mountTree(tree(() => ({ type: "line", options: options.value })));
    const s = chartOf().series[0]!;
    options.value = { color: "#fff", lineWidth: 1 };
    await nextTick();
    expect(s.count("applyOptions")).toBe(0);
    options.value = { color: "#000", lineWidth: 1 };
    await nextTick();
    expect(s.calls.filter((c) => c[0] === "applyOptions")).toEqual([["applyOptions", { color: "#000" }]]);
  });

  it("applies price-scale options to the series' own scale at creation, then only what changed", async () => {
    const priceScale = shallowRef({ marginTop: 0.8, marginBottom: 0 });
    mountTree(tree(() => ({ type: "histogram", options: { priceScaleId: "vol", pane: 1 }, priceScale: priceScale.value })));
    expect(chartOf().scaleCalls).toEqual([["1:vol", { marginTop: 0.8, marginBottom: 0 }]]);
    priceScale.value = { marginTop: 0.8, marginBottom: 0 };
    await nextTick();
    expect(chartOf().scaleCalls).toHaveLength(1);
    priceScale.value = { marginTop: 0.7, marginBottom: 0 };
    await nextTick();
    expect(chartOf().scaleCalls.at(-1)).toEqual(["1:vol", { marginTop: 0.7 }]);
  });

  it("replaces the series when its type changes and removes the old one", async () => {
    const type = ref("line");
    const data = [{ time: 1, value: 1 }];
    mountTree(tree(() => ({ type: type.value, data })));
    type.value = "area";
    await nextTick();
    const [a, b] = chartOf().series;
    expect(a!.removed).toBe(true);
    expect(b!.type).toBe("area");
    expect(b!.removed).toBe(false);
    expect(b!.count("setData")).toBe(1);
  });

  it("switching type and data in one render gives the new series the new data and never touches the removed one", async () => {
    const pts = [{ time: 1, value: 1 }];
    const state = shallowRef<{ type: string; data: unknown }>({ type: "candles", data: bars(2) });
    mountTree(tree(() => state.value));
    state.value = { type: "line", data: pts };
    await nextTick();
    const [a, b] = chartOf().series;
    expect(a!.count("setData")).toBe(1);
    expect(a!.removed).toBe(true);
    expect(b!.calls).toEqual([["setData", pts]]);
  });

  it("removes a series whose first setData throws, when it later unmounts", async () => {
    const show = ref(false);
    const errors: unknown[] = [];
    const w = mount(defineComponent({ render: () => h(AcChart, null, () => (show.value ? h(Series, { type: "line", data: [] }) : [])) }), {
      attachTo: document.body,
      global: { config: { errorHandler: (e: unknown) => void errors.push(e) } },
    });
    mounted.push(w);
    const orig = FakeSeries.prototype.setData;
    FakeSeries.prototype.setData = () => {
      throw new Error("refused");
    };
    show.value = true;
    await nextTick();
    FakeSeries.prototype.setData = orig;
    expect(errors.length).toBeGreaterThan(0);
    expect(chartOf().series).toHaveLength(1);
    show.value = false;
    await nextTick();
    expect(chartOf().series[0]!.removed).toBe(true);
  });

  it("re-applies the whole price-scale options when the series moves to another scale", async () => {
    const pane = ref(0);
    const priceScale = { visible: false };
    mountTree(tree(() => ({ type: "line", options: { pane: pane.value }, priceScale })));
    pane.value = 1;
    await nextTick();
    expect(chartOf().scaleCalls).toEqual([["0:right", { visible: false }], ["1:right", { visible: false }]]);
  });

  it("removes the series when it unmounts alone, and not on a chart that is already gone", async () => {
    const show = ref(true);
    const w = mountTree(() => h(AcChart, null, () => (show.value ? h(Series, { type: "line" }) : [])));
    const s = chartOf().series[0]!;
    show.value = false;
    await nextTick();
    expect(s.removed).toBe(true);
    show.value = true;
    await nextTick();
    expect(() => w.unmount()).not.toThrow();
    mounted.length = 0;
  });

  it("refuses to render outside a chart", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => mount(Series, { props: { type: "line" } } as never)).toThrow(/inside <AcChart>/);
    warn.mockRestore();
  });
});

describe("AcPriceLine", () => {
  it("creates a line, moves it with applyOptions, removes it on unmount", async () => {
    const price = ref(10);
    const w = mountTree(() => h(AcChart, null, () => h(Series, { type: "candles" }, () => h(AcPriceLine, { price: price.value, color: "#f00" }))));
    const s = chartOf().series[0]!;
    expect(s.lines).toHaveLength(1);
    const line = s.lines[0]!;
    expect(line.options).toEqual({ price: 10, color: "#f00" });
    price.value = 11;
    await nextTick();
    expect(line.applied).toEqual([{ price: 11 }]);
    w.unmount();
    mounted.length = 0;
    expect(chartOf().removed).toBe(true);
  });

  it("removes its line when only it unmounts", async () => {
    const show = ref(true);
    mountTree(() => h(AcChart, null, () => h(Series, { type: "candles" }, () => (show.value ? h(AcPriceLine, { price: 1 }) : []))));
    show.value = false;
    await nextTick();
    expect(chartOf().series[0]!.lines).toHaveLength(0);
  });
});

describe("leaks", () => {
  it("50 mount/unmount cycles leave no live chart, listener or DOM", () => {
    for (let i = 0; i < 50; i++) {
      const w = mount(
        defineComponent({ render: () => h(AcChart, { onCrosshairMove: () => {}, onVisibleRangeChange: () => {}, onClick: () => {} }, () => h(Series, { type: "candles", data: bars(2) }, () => h(AcPriceLine, { price: 1 }))) }),
        { attachTo: document.body },
      );
      w.unmount();
    }
    expect(stats.charts).toHaveLength(50);
    expect(stats.liveCharts()).toBe(0);
    expect(stats.listeners()).toBe(0);
    expect(document.querySelectorAll(".fake-chart")).toHaveLength(0);
  });
});

describe("AcDashboard, cells and AcSyncGroup", () => {
  const cells = (n: () => number) => () =>
    h(AcDashboard, { options: { renderer: "auto" } }, () =>
      h(AcSyncGroup, null, () => Array.from({ length: n() }, (_, i) => h(AcDashboardCell, { key: i, options: { theme: "dark" } }, () => h(Series, { type: "line" })))),
    );

  it("makes one dashboard whose cells are charts inside it, all in one sync group", () => {
    const w = mountTree(cells(() => 4));
    expect(stats.dashboards).toHaveLength(1);
    const d = stats.dashboards[0] as FakeDashboard;
    expect(d.options).toEqual({ renderer: "auto" });
    expect(d.charts).toHaveLength(4);
    expect(stats.groups).toHaveLength(1);
    expect(stats.groups[0]!.members.size).toBe(4);
    expect(stats.charts.every((c) => c.series.length === 1)).toBe(true);
    w.unmount();
    mounted.length = 0;
    expect(d.removed).toBe(true);
    expect(stats.liveCharts()).toBe(0);
    expect(stats.groups[0]!.members.size).toBe(0);
  });

  it("removing one cell removes only its chart and leaves the group", async () => {
    const n = ref(3);
    mountTree(cells(() => n.value));
    n.value = 2;
    await nextTick();
    expect(stats.charts.filter((c) => !c.removed)).toHaveLength(2);
    expect(stats.groups[0]!.members.size).toBe(2);
  });

  it("charts outside a dashboard join the sync group too, and a cell outside a dashboard throws", () => {
    mountTree(() => h(AcSyncGroup, null, () => [h(AcChart), h(AcChart)]));
    expect(stats.groups[0]!.members.size).toBe(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => mount(AcDashboardCell)).toThrow(/inside <AcDashboard>/);
    warn.mockRestore();
  });

  it("makes a new group when its options change and re-joins the charts; absent booleans stay unset", async () => {
    const crosshair = ref<boolean | undefined>(undefined);
    mountTree(() => h(AcSyncGroup, { crosshair: crosshair.value }, () => h(AcChart)));
    expect(stats.groups[0]!.options).toEqual({});
    crosshair.value = false;
    await nextTick();
    expect(stats.groups).toHaveLength(2);
    expect(stats.groups[0]!.members.size).toBe(0);
    expect(stats.groups[1]!.members.size).toBe(1);
    expect(stats.groups[1]!.options).toEqual({ crosshair: false });
  });
});

describe("composables", () => {
  it("useCrosshair and useVisibleRange follow the chart; useChart gives it", async () => {
    let chart: unknown;
    const Probe = defineComponent({
      setup() {
        const c = useChart();
        const x = useCrosshair();
        const r = useVisibleRange();
        return () => ((chart = c.value), h("output", `${x.value?.time ?? "-"}|${r.value ? `${r.value.from},${r.value.to}` : "-"}`));
      },
    });
    const w = mountTree(() => h(AcChart, null, () => h(Probe)));
    await nextTick();
    expect(chart).toBe(chartOf());
    expect(w.find("output").text()).toBe("-|1,2");
    chartOf().emit("crosshairMove", { time: 42, source: "pointer" });
    chartOf().emit("visibleRangeChange", { from: 3, to: 9, source: "user" });
    await nextTick();
    expect(w.find("output").text()).toBe("42|3,9");
    w.unmount();
    mounted.length = 0;
    expect(stats.listeners()).toBe(0);
  });

  it("useChart outside a chart throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => mount(defineComponent({ setup: () => (useChart(), () => null) }))).toThrow(/inside <AcChart>/);
    warn.mockRestore();
  });
});
