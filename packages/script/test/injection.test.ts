// Codegen injection: the output is closures built from the syntax tree. Identifiers
// and strings from a script can only ever be data (titles, keys, option lists);
// nothing in compile or run may reach eval / Function / a dynamic import.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudyEngine } from "@alphacharts/indicators";
import { compile } from "../src/index.js";
import { INVALID, VALID } from "./corpus.js";
import { DATA, ok } from "./support.js";

const g = globalThis as unknown as { eval: unknown; Function: unknown };
let realEval: unknown, realFunction: unknown, calls: string[];

beforeEach(() => {
  realEval = g.eval; realFunction = g.Function; calls = [];
  g.eval = (s: string) => { calls.push(`eval:${s}`); throw new Error("eval called"); };
  g.Function = function (...a: unknown[]) { calls.push(`Function:${a.join(",")}`); throw new Error("Function called"); };
});
afterEach(() => { g.eval = realEval; g.Function = realFunction; });

describe("no dynamic code generation", () => {
  it("compiling and running the whole corpus never calls eval or Function", () => {
    for (const s of [...INVALID, ...VALID]) {
      const r = compile(s);
      if (r.ok) { const e = new StudyEngine(r.study); e.load(DATA); }
    }
    expect(calls).toEqual([]);
  });
});

const PAYLOADS = [
  '"); globalThis.pwned = 1; ("',
  "'); globalThis.pwned = 1; ('",
  "</script><script>globalThis.pwned=1</script>",
  "${globalThis.pwned = 1}",
  "`${globalThis.pwned = 1}`",
  "\\\\\"); globalThis.pwned = 1; //",
  "\n}); globalThis.pwned = 1; (function(){",
  "__proto__",
  "constructor",
  "a b",
];

describe("strings and titles are data", () => {
  for (const p of PAYLOADS) {
    it(JSON.stringify(p), () => {
      const lit = JSON.stringify(p).replace(/\\u2028/g, " ");
      // titles, plot names, options and string comparisons all carry the payload
      const src = `m = input.string(${lit}, "T", options=[${lit}, "other"])\nplot(m == ${lit} ? close : open, ${lit})\nhline(1, ${lit})`;
      const r = compile(src);
      if (!r.ok) {
        // a payload the lexer cannot decode is refused, not run
        expect(r.diagnostics.length).toBeGreaterThan(0);
        return;
      }
      const e = new StudyEngine(r.study);
      e.load(DATA);
      expect(e.column(0)[5]).toBe(DATA.close[5]);
      expect(r.study.plots[0]!.title).toBe(p);
      expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined();
      expect(calls).toEqual([]);
    });
  }
  it("plot keys derived from titles are plain slugs", () => {
    const r = ok(`plot(close, "a\\"); alert(1); (\\"")`);
    expect(r.study.columns[0]).toMatch(/^[a-z0-9-]+$/);
    expect(r.study.plots[0]!.key).toBe(r.study.columns[0]);
  });
});

describe("identifiers cannot carry code", () => {
  for (const name of ["a;b", "a-b", "a b", "a.b.c", "a$b", "aа", "x​", "a`b", "a'b", "a\"b", "a(b", "a{b}", "é"]) {
    it(JSON.stringify(name), () => {
      const r = compile(`${name} = 1\nplot(close)`);
      expect(r.ok).toBe(false);
    });
  }
  it("a variable named like a JavaScript keyword or global is just a name", () => {
    for (const n of ["let", "var2", "function_", "toString", "valueOf", "hasOwnProperty", "length", "name", "Object", "Array", "process", "require", "module", "globalThis", "undefined_", "NaN", "Infinity", "arguments", "async", "await", "yield", "delete", "typeof", "void_"]) {
      const r = compile(`${n} = close * 2\nplot(${n})`);
      expect(r.ok, n).toBe(true);
      if (r.ok) {
        const e = new StudyEngine(r.study);
        e.load(DATA);
        expect(e.column(0)[3]).toBe(DATA.close[3]! * 2);
      }
    }
    expect(calls).toEqual([]);
  });
  it("names shadowing Map/Object internals do not leak table entries", () => {
    for (const n of ["toString", "constructor_", "hasOwnProperty", "valueOf"]) {
      const r = compile(`plot(${n})`);
      expect(r.ok).toBe(false);
    }
    expect(compile("plot(ta.toString)").ok).toBe(false);
    expect(compile("plot(math.hasOwnProperty(1))").ok).toBe(false);
    expect(compile("x = color.toString\nplot(close)").ok).toBe(false);
  });
  it("a hostile input value cannot change what runs", () => {
    const r = ok('m = input.string("a", options=["a", "b"])\nplot(m == "a" ? 1 : 2)');
    expect(() => new StudyEngine(r.study, { m: '"; globalThis.pwned = 1; "' })).toThrow(/is not one of/);
    expect(() => new StudyEngine(r.study, { __proto__: 1 } as never)).not.toThrow();
  });
});
