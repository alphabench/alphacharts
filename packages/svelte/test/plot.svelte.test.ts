import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlotBox from "./PlotBox.svelte";
import PlotTree from "./PlotTree.svelte";
import { Plot } from "../src/plot/index.js";
import { FakeGroup, plots, type FakePlot } from "./fake-plot.js";

vi.mock("@alphacharts/plot", async () => await import("./fake-plot.js"));

const spec = (n = 1) => ({ marks: [{ type: "line", x: [1, 2], y: [n, 2] }] }) as never;
const live: Record<string, unknown>[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function put(C: unknown, init: Record<string, any>) {
  const props = $state.raw(init);
  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(C as never, { target, props }) as Record<string, unknown>;
  flushSync();
  live.push(app);
  return { app, unmount: () => { unmount(app); live.splice(live.indexOf(app), 1); } };
}

beforeEach(() => plots.reset());
afterEach(() => {
  for (const a of live.splice(0)) unmount(a);
  document.body.innerHTML = "";
});

describe("Plot", () => {
  it("creates one plot on mount and disposes it on unmount", () => {
    const s = spec();
    const m = put(PlotBox, { initial: s });
    expect(plots.all).toHaveLength(1);
    expect(plots.all[0]!.spec).toBe(s);
    expect(document.querySelector("div.p")).not.toBeNull();
    m.unmount();
    expect(plots.live()).toBe(0);
  });

  it("updates only when a top-level spec entry changed", () => {
    const base = spec();
    const m = put(PlotBox, { initial: base });
    const box = m.app as unknown as { set(s: unknown): void };
    box.set({ ...(base as object) });
    flushSync();
    expect(plots.all[0]!.updates).toHaveLength(0);
    const next = spec(5);
    box.set(next);
    flushSync();
    expect(plots.all[0]!.updates).toEqual([next]);
  });

  it("subscribes only present handlers and unsubscribes on unmount", () => {
    const a = vi.fn();
    const m = put(Plot, { spec: spec(), onCrosshair: a });
    const p = plots.all[0] as FakePlot;
    expect(p.handlers.get("brush")).toBeUndefined();
    p.emit("crosshair", { key: null });
    expect(a).toHaveBeenCalledTimes(1);
    m.unmount();
    expect(plots.listeners()).toBe(0);
  });

  it("joins the nearest <PlotSync>; an explicit group wins", () => {
    const mine = new FakeGroup();
    const m = put(PlotTree, { spec: spec(), group: mine });
    const own = plots.groups.find((g) => g !== mine)!;
    expect(own.members).toHaveLength(1);
    expect(mine.members).toHaveLength(1);
    m.unmount();
    expect(own.members).toHaveLength(0);
    expect(mine.members).toHaveLength(0);
  });
});
