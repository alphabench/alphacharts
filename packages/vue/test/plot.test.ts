import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { AcPlot, AcPlotSync } from "../src/plot/index.js";
import { FakeGroup, plots, type FakePlot } from "./fake-plot.js";

vi.mock("@alphacharts/plot", async () => await import("./fake-plot.js"));

const spec = (n = 1) => ({ marks: [{ type: "line", x: [1, 2], y: [n, 2] }] }) as never;
const live: { unmount(): void }[] = [];
const mountIt = (c: unknown, o: Record<string, unknown> = {}) => {
  const w = mount(c as never, { attachTo: document.body, ...o }) as unknown as { unmount(): void; vm: unknown; setProps(p: object): Promise<void> };
  live.push(w);
  return w;
};

beforeEach(() => plots.reset());
afterEach(() => live.splice(0).forEach((w) => w.unmount()));

describe("AcPlot", () => {
  it("creates one plot on mount and disposes it on unmount", async () => {
    const s = spec();
    const w = mountIt(AcPlot, { props: { spec: s } });
    expect(plots.all).toHaveLength(1);
    expect(plots.all[0]!.spec).toBe(s);
    expect((w.vm as unknown as { plot: unknown }).plot).toBe(plots.all[0]);
    w.unmount();
    live.length = 0;
    expect(plots.live()).toBe(0);
  });

  it("updates only when a top-level spec entry changed", async () => {
    const base = spec();
    const w = mountIt(AcPlot, { props: { spec: base } });
    await w.setProps({ spec: { ...(base as object) } as never });
    expect(plots.all[0]!.updates).toHaveLength(0);
    const next = spec(5);
    await w.setProps({ spec: next });
    expect(plots.all[0]!.updates).toEqual([next]);
  });

  it("subscribes only present handlers, and unsubscribes when one goes", async () => {
    const a = vi.fn();
    const w = mountIt(AcPlot, { props: { spec: spec(), onCrosshair: a } });
    const p = plots.all[0] as FakePlot;
    expect(p.handlers.get("brush")).toBeUndefined();
    p.emit("crosshair", { key: null });
    expect(a).toHaveBeenCalledTimes(1);
    await w.setProps({ onCrosshair: undefined });
    expect(plots.listeners()).toBe(0);
  });

  it("joins the nearest <AcPlotSync>; an explicit group wins", async () => {
    const App = defineComponent({ render: () => h(AcPlotSync, null, { default: () => [h(AcPlot, { spec: spec() }), h(AcPlot, { spec: spec() })] }) });
    const w = mountIt(App);
    expect(plots.groups).toHaveLength(1);
    expect(plots.groups[0]!.members).toHaveLength(2);
    w.unmount();
    live.length = 0;
    expect(plots.groups[0]!.members).toHaveLength(0);
    const mine = new FakeGroup();
    mountIt(AcPlot, { props: { spec: spec(), sync: mine } });
    await nextTick();
    expect(mine.members).toHaveLength(1);
  });
});
