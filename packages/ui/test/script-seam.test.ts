import { describe, expect, it } from "vitest";
import { ChartApp } from "../src/engine/app.js";

describe("script panel seam", () => {
  it("refuses an editor without a runner (a Run button that cannot run)", () => {
    const editor = { mount: () => ({ setDiagnostics() {}, destroy() {} }) };
    expect(() => new ChartApp({} as HTMLElement, { scriptEditor: editor } as never)).toThrow(/scriptEditor needs scriptRunner/);
  });
});
