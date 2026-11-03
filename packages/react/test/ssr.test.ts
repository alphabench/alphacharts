// @vitest-environment node
// Server render with the REAL core (no mock): importing the wrappers and
// rendering must not touch window or document. This file runs in plain node,
// where both are undefined, so any access would throw a ReferenceError.

import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chart, Dashboard, DashboardCell, PriceLine, Series, SyncGroup, useChart } from "../src/index.js";

describe("server render", () => {
  it("has no DOM in this environment", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders an empty sized container for a chart tree", () => {
    const html = renderToString(
      h(SyncGroup, {}, h(Chart, { className: "c", style: { height: 100 }, options: { theme: "dark" } }, h(Series as never, { type: "candles", data: [] }, h(PriceLine, { price: 1 })))),
    );
    expect(html).toBe('<div class="c" style="height:100px"></div>');
  });

  it("renders a dashboard with cells as empty containers", () => {
    const html = renderToString(h(Dashboard, { className: "d" }, h(DashboardCell, { className: "a" }), h(DashboardCell, { className: "b" })));
    expect(html).toBe('<div class="d"><div class="a"></div><div class="b"></div></div>');
  });

  it("hooks see a null chart on the server", () => {
    let seen: unknown = "unset";
    const Probe = () => ((seen = useChart()), null);
    renderToString(h(Chart, {}, h(Probe)));
    expect(seen).toBeNull();
  });
});
