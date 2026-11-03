// Server render with the REAL core (no mock): importing the wrappers and
// rendering must not touch window or document. The "ssr" project runs this
// file in plain node, where both are undefined, so any access would throw.

import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import Dash from "./Dash.svelte";
import Tree from "./Tree.svelte";
import Sync from "./Sync.svelte";
import Probe from "./Probe.svelte";
import { Chart } from "../src/index.js";

// Svelte brackets output with hydration comments; the markup between is what matters.
const markup = (body: string) => body.replace(/<!--.*?-->/g, "");

describe("server render", () => {
  it("has no DOM in this environment", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders an empty container for a chart tree", () => {
    const { body } = render(Tree, { props: { chartOptions: { theme: "dark" }, data: [], price: 1 } });
    expect(markup(body)).toBe("<div></div>");
  });

  it("forwards class and style on the server too", () => {
    const { body } = render(Chart, { props: { class: "c", style: "height:100px" } });
    expect(markup(body)).toBe('<div class="c" style="height:100px"></div>');
  });

  it("renders a dashboard with cells as empty containers", () => {
    const { body } = render(Dash, { props: { cells: 2 } });
    expect(markup(body)).toBe("<div><div></div><div></div></div>");
  });

  it("renders sync groups of charts", () => {
    expect(markup(render(Sync, { props: { count: 2 } }).body)).toBe("<div></div><div></div>");
  });

  it("hooks see a null chart on the server", () => {
    const seen = { chart: "unset" as unknown };
    const { body } = render(Chart, { props: { children: ((payload: unknown) => Probe(payload as never, { seen })) as never } });
    expect(body).toContain("<output>-|-</output>");
    expect(seen.chart).toBe("unset"); // effects do not run on the server
  });
});
