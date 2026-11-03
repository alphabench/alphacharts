import { describe, expect, it } from "vitest";
import { formatNodes, MessageSyntaxError, parseMessage, placeholders } from "../src/icu.js";

const fmt = (src: string, values: Record<string, string | number> = {}, locale = "en") =>
  formatNodes(parseMessage(src), values, { locale, number: (n) => new Intl.NumberFormat(locale, { numberingSystem: "latn", maximumFractionDigits: 20 }).format(n) }, src);

describe("ICU subset", () => {
  it("interpolates strings and numbers", () => {
    expect(fmt("Hi {name}, {n}", { name: "A", n: 1234.5 })).toBe("Hi A, 1,234.5");
    expect(fmt("{n, number}", { n: 1234567 })).toBe("1,234,567");
  });
  it("plural: exact, category, #", () => {
    const m = "{count, plural, =0 {no bars} one {# bar} other {# bars}}";
    expect(fmt(m, { count: 0 })).toBe("no bars");
    expect(fmt(m, { count: 1 })).toBe("1 bar");
    expect(fmt(m, { count: 1500 })).toBe("1,500 bars");
  });
  it("plural offset applies to # and the category, not to =N", () => {
    const m = "{n, plural, offset:1 =0 {nobody} =1 {just you} one {you and # other} other {you and # others}}";
    expect(fmt(m, { n: 0 })).toBe("nobody");
    expect(fmt(m, { n: 1 })).toBe("just you");
    expect(fmt(m, { n: 2 })).toBe("you and 1 other");
    expect(fmt(m, { n: 5 })).toBe("you and 4 others");
  });
  it("selectordinal", () => {
    const m = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect([1, 2, 3, 4, 11, 22].map((n) => fmt(m, { n }))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
  });
  it("select with nesting", () => {
    const m = "{kind, select, bar {{count, plural, one {# bar} other {# bars}}} other {items}}";
    expect(fmt(m, { kind: "bar", count: 2 })).toBe("2 bars");
    expect(fmt(m, { kind: "x", count: 2 })).toBe("items");
  });
  it("Arabic plural categories come from Intl", () => {
    const m = "{n, plural, zero {z} one {o} two {t} few {f} many {m} other {x}}";
    expect([0, 1, 2, 3, 11, 100].map((n) => fmt(m, { n }, "ar"))).toEqual(["z", "o", "t", "f", "m", "x"]);
  });
  it("quoting", () => {
    expect(fmt("It''s '{'literal'}'")).toBe("It's {literal}");
    expect(fmt("don't {x}", { x: "1" })).toBe("don't 1");
    expect(fmt("{n, plural, other {'#' is # }}", { n: 3 })).toBe("# is 3 ");
  });
  it("rejects malformed messages with the offset", () => {
    for (const bad of ["{", "{a", "{a,}", "{a, plural, one {x}}", "{a, select, b {x}}", "{a, foo, other {x}}", "}", "{a, plural, odd {x} other {y}}", "{a, number, 0.0}", "{a, plural, other {x} other {y}}"]) {
      expect(() => parseMessage(bad), bad).toThrow(MessageSyntaxError);
    }
  });
  it("a missing or wrong-typed value throws", () => {
    expect(() => fmt("{x}")).toThrow(/needs a value for "x"/);
    expect(() => fmt("{n, plural, other {#}}", { n: "3" })).toThrow(/finite number/);
    expect(() => fmt("{n, plural, other {#}}", { n: NaN })).toThrow(/finite number/);
  });
  it("lists placeholders", () => {
    const p = placeholders(parseMessage("{a} {n, plural, one {# {b}} other {#}} {k, select, x {1} other {2}}"));
    expect([...p.keys()].sort()).toEqual(["a", "b", "k", "n"]);
    expect(p.get("k")).toBe("select:other|x");
  });
});
