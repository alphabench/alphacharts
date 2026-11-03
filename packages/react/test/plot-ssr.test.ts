// @vitest-environment node
// Server render with the REAL plot (no mock): importing and rendering must not touch window or document.

import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Plot, PlotSync } from "../src/plot/index.js";

describe("server render", () => {
  it("renders an empty sized container", () => {
    expect(typeof document).toBe("undefined");
    const html = renderToString(h(PlotSync, null, h(Plot, { className: "p", style: { height: 100 }, spec: { marks: [{ type: "line", x: [1], y: [1] }] } })));
    expect(html).toBe('<div class="p" style="height:100px"></div>');
  });
});
