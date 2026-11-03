// Grammar corpus: every invalid program is refused with exactly these diagnostics
// (line:column message), every valid one compiles and runs to the end of the data.

import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";
import expected from "./corpus-invalid.json";
import { INVALID, VALID } from "./corpus.js";
import { run } from "./support.js";

describe("invalid programs", () => {
  it("the expectations cover exactly the corpus", () => {
    expect((expected as [string, string[]][]).map((e) => e[0])).toEqual(INVALID);
    expect(INVALID.length).toBeGreaterThanOrEqual(100);
  });
  for (const [src, diags] of expected as [string, string[]][]) {
    it(JSON.stringify(src), () => {
      const r = compile(src);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`)).toEqual(diags);
      for (const d of r.diagnostics) {
        expect(d.severity).toBe("error");
        expect(d.to).toBeGreaterThanOrEqual(d.from);
        expect(d.endLine).toBeGreaterThanOrEqual(d.line);
      }
    });
  }
});

describe("valid programs", () => {
  it("there are at least 60", () => expect(VALID.length).toBeGreaterThanOrEqual(60));
  for (const src of VALID) {
    it(JSON.stringify(src), () => {
      const r = compile(src);
      if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join("\n"));
      const cols = run(src);
      expect(cols.length).toBe(r.study.columns.length);
    });
  }
});
