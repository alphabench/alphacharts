// The missing-key check. Every catalogue must have exactly English's keys,
// every message must parse, and its placeholders must be English's.
import { describe, expect, it } from "vitest";
import { CHART_MESSAGES } from "@alphacharts/core";
import { en } from "../src/locales/en.js";
import { hi } from "../src/locales/hi.js";
import { parseMessage, placeholders } from "../src/icu.js";

const CATALOGUES: Record<string, Record<string, string>> = { hi };
const enKeys = Object.keys(en).sort();

describe("English", () => {
  it("every message parses", () => {
    for (const [k, v] of Object.entries(en)) expect(() => parseMessage(v), k).not.toThrow();
  });
  it("matches the core's built-in chart messages exactly", () => {
    for (const [k, v] of Object.entries(CHART_MESSAGES)) expect((en as Record<string, string>)[k], k).toBe(v);
  });
  it("is large enough to be the whole UI shell's schema", () => {
    expect(enKeys.length).toBeGreaterThan(550);
  });
  it("has no empty message", () => {
    for (const [k, v] of Object.entries(en)) expect(v.length, k).toBeGreaterThan(0);
  });
});

for (const [locale, cat] of Object.entries(CATALOGUES)) {
  describe(`${locale} catalogue`, () => {
    it("has every English key", () => {
      expect(enKeys.filter((k) => !(k in cat)), "missing keys").toEqual([]);
    });
    it("has no key English lacks", () => {
      expect(Object.keys(cat).filter((k) => !(k in en)), "extra keys").toEqual([]);
    });
    it("every message parses and has English's placeholders", () => {
      const problems: string[] = [];
      for (const k of enKeys) {
        const src = cat[k];
        if (src === undefined) continue;
        let got: Map<string, string>;
        try {
          got = placeholders(parseMessage(src));
        } catch (e) {
          problems.push(`${k}: ${(e as Error).message}`);
          continue;
        }
        const want = placeholders(parseMessage((en as Record<string, string>)[k]!));
        // Compare names and select options; plural/number/arg all take a value of one name.
        const norm = (m: Map<string, string>) => [...m].map(([n, t]) => (t.startsWith("select:") ? `${n}=${t}` : n)).sort();
        if (JSON.stringify(norm(got)) !== JSON.stringify(norm(want))) problems.push(`${k}: placeholders ${JSON.stringify(norm(got))} != English ${JSON.stringify(norm(want))}`);
      }
      expect(problems).toEqual([]);
    });
    it("is translated, not copied: only technical terms match English", () => {
      const same = enKeys.filter((k) => cat[k] === (en as Record<string, string>)[k]);
      // Acronyms, symbols and pure-format messages that read the same everywhere.
      const technical = /^[A-Za-z0-9 %{}.:,()/+-]{0,32}$/;
      expect(same.filter((k) => !technical.test(cat[k]!)), "untranslated").toEqual([]);
    });
  });
}

describe("the checker itself", () => {
  it("catches a different placeholder", () => {
    const a = placeholders(parseMessage("{name} open {open}"));
    const b = placeholders(parseMessage("{name} खुला {opn}"));
    expect([...a.keys()].sort()).not.toEqual([...b.keys()].sort());
  });
  it("catches a bad ICU message", () => {
    expect(() => parseMessage("{count, plural, one {# a}}")).toThrow(/other/);
  });
});
