import { describe, expect, it } from "vitest";
import { completionsFor, createScriptEditorAdapter, declaredNames } from "../src/editor/index.js";

describe("editor helpers", () => {
  it("finds declared names", () => {
    expect(declaredNames("len = input.int(14)\nvar float s = 0.0\nfor i = 1 to 3\n    t = 1\n[a, b] = ta.macd(close, 12, 26, 9)\nx == 1\n").sort()).toEqual(["a", "b", "i", "len", "s", "t"]);
  });
  it("completes ta.*, math.*, inputs and declared names", () => {
    const labels = (w: string, text = "") => completionsFor(text, w).map((c) => c.label);
    expect(labels("ta.sm")).toContain("ta.sma");
    expect(labels("ta.rs")).toContain("ta.rsi");
    expect(labels("math.ma")).toEqual(expect.arrayContaining(["math.max"]));
    expect(labels("input.")).toEqual(expect.arrayContaining(["input.int", "input.color", "input.source", "input.string", "input.bool", "input.float"]));
    expect(labels("le", "length_x = 1")).toContain("length_x");
    expect(labels("clo")).toContain("close");
  });
  it("exposes the adapter factory", () => {
    expect(typeof createScriptEditorAdapter().mount).toBe("function");
  });
});
