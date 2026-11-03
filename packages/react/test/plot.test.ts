import { act, cleanup, render } from "@testing-library/react";
import { createElement as h, createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Plot, PlotSync } from "../src/plot/index.js";
import { FakeGroup, plots, type FakePlot } from "./fake-plot.js";

vi.mock("@alphacharts/plot", async () => await import("./fake-plot.js"));

const spec = (n = 1) => ({ marks: [{ type: "line", x: [1, 2], y: [n, 2] }] }) as never;

beforeEach(() => plots.reset());
afterEach(() => cleanup());

describe("Plot", () => {
  it("creates one plot with the spec on mount and disposes it on unmount", () => {
    const s = spec();
    const { unmount, container } = render(h(Plot, { spec: s, className: "p", style: { height: 120 } }));
    expect(plots.all).toHaveLength(1);
    expect(plots.all[0]!.spec).toBe(s);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("p");
    expect(el.style.height).toBe("120px");
    unmount();
    expect(plots.live()).toBe(0);
  });

  it("exposes the plot through the ref", () => {
    const ref = createRef<unknown>();
    render(h(Plot, { spec: spec(), ref: ref as never }));
    expect(ref.current).toBe(plots.all[0]);
  });

  it("updates only when a top-level spec entry changed", () => {
    const base = spec();
    const { rerender } = render(h(Plot, { spec: base }));
    rerender(h(Plot, { spec: { ...(base as object) } as never }));
    expect(plots.all[0]!.updates).toHaveLength(0);
    const next = spec(5);
    rerender(h(Plot, { spec: next }));
    expect(plots.all[0]!.updates).toEqual([next]);
  });

  it("survives StrictMode's double mount without leaking a plot", () => {
    render(h(StrictMode, null, h(Plot, { spec: spec() })));
    expect(plots.live()).toBe(1);
  });

  it("subscribes only present handlers, reads the latest closure, and unsubscribes on unmount", () => {
    const a = vi.fn(), b = vi.fn();
    const { rerender, unmount } = render(h(Plot, { spec: spec(), onCrosshair: a }));
    const p = plots.all[0] as FakePlot;
    expect(p.handlers.get("crosshair")?.size).toBe(1);
    expect(p.handlers.get("brush")).toBeUndefined();
    rerender(h(Plot, { spec: spec(), onCrosshair: b }));
    expect(p.handlers.get("crosshair")?.size).toBe(1);
    act(() => p.emit("crosshair", { key: { num: 3 } }));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ key: { num: 3 } });
    unmount();
    expect(plots.listeners()).toBe(0);
  });

  it("joins the nearest <PlotSync> and leaves it on unmount; an explicit group wins", () => {
    const { unmount } = render(h(PlotSync, null, h(Plot, { spec: spec() }), h(Plot, { spec: spec() })));
    expect(plots.groups).toHaveLength(1);
    expect(plots.groups[0]!.members).toHaveLength(2);
    unmount();
    expect(plots.groups[0]!.members).toHaveLength(0);
    const mine = new FakeGroup();
    render(h(PlotSync, null, h(Plot, { spec: spec(), sync: mine as never })));
    expect(mine.members).toHaveLength(1);
  });
});
