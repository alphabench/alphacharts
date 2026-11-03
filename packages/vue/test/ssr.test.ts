// @vitest-environment node
// Server render with the REAL core (no mock): importing the wrappers and
// rendering must not touch window or document. This file runs in plain node,
// where both are undefined, so any access would throw a ReferenceError.

import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { AcChart, AcDashboard, AcDashboardCell, AcPriceLine, AcSeries, AcSyncGroup, useChart } from "../src/index.js";

const ssr = (render: () => ReturnType<typeof h>) => renderToString(createSSRApp({ render }));

describe("server render", () => {
  it("has no DOM in this environment", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders an empty sized container for a chart tree", async () => {
    const html = await ssr(() =>
      h(AcSyncGroup, null, () => h(AcChart, { class: "c", style: { height: "100px" }, options: { theme: "dark" } }, () => h(AcSeries as never, { type: "candles", data: [] }, () => h(AcPriceLine, { price: 1 })))),
    );
    // Vue brackets slot fragments with comments for hydration; the host div is empty of any canvas.
    expect(html).toContain('<div class="c" style="height:100px;">');
    expect(html).not.toMatch(/canvas/);
    expect(html.replace(/<!--.*?-->/g, "")).toBe('<div class="c" style="height:100px;"></div>');
  });

  it("renders a dashboard with cells as empty containers", async () => {
    const html = await ssr(() => h(AcDashboard, { class: "d" }, () => [h(AcDashboardCell, { class: "a" }), h(AcDashboardCell, { class: "b" })]));
    expect(html).toBe('<div class="d"><div class="a"></div><div class="b"></div></div>');
  });

  it("composables see a null chart on the server", async () => {
    let seen: unknown = "unset";
    const Probe = { setup: () => ((seen = useChart().value), () => null) };
    await ssr(() => h(AcChart, null, () => h(Probe)));
    expect(seen).toBeNull();
  });
});
