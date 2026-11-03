// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("importing the package on a server", () => {
  it("does not need a DOM (no HTMLElement subclass at module top)", async () => {
    expect(typeof HTMLElement).toBe("undefined");
    const m = await import("../src/index.js");
    expect(typeof m.createChartApp).toBe("function");
    expect(typeof m.defineChartApp).toBe("function");
  });
});
