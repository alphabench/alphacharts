// @vitest-environment node
// Server render with the REAL plot (no mock): no window or document access.

import { renderToString } from "vue/server-renderer";
import { createSSRApp, h } from "vue";
import { describe, expect, it } from "vitest";
import { AcPlot, AcPlotSync } from "../src/plot/index.js";

describe("server render", () => {
  it("renders an empty container", async () => {
    expect(typeof document).toBe("undefined");
    const app = createSSRApp({ render: () => h(AcPlotSync, null, { default: () => h(AcPlot, { spec: { marks: [{ type: "line", x: [1], y: [1] }] }, class: "p" }) }) });
    expect(await renderToString(app)).toBe('<!--[--><div class="p"></div><!--]-->');
  });
});
