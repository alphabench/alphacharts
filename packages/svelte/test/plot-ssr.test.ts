// Server render with the REAL plot (no mock): no window or document access.

import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { Plot } from "../src/plot/index.js";

const markup = (body: string) => body.replace(/<!--.*?-->/g, "");

describe("server render", () => {
  it("renders an empty container with class and style", () => {
    expect(typeof document).toBe("undefined");
    const { body } = render(Plot, { props: { spec: { marks: [{ type: "line", x: [1], y: [1] }] }, class: "p", style: "height:100px" } });
    expect(markup(body)).toBe('<div class="p" style="height:100px"></div>');
  });
});
