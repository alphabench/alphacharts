// The skill checker, on the real skills and on copies broken on purpose: each test damages one thing in a temporary copy of charts/skills and
// requires the checker to fail for that reason.
//
//   pnpm test:skills

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SECTIONS, validate } from "./check-skills.mjs";
import { CHARTS_ROOT } from "./lib/skills-engine.mjs";
import { REGISTRY_END, REGISTRY_START, renderRegistry } from "./lib/skills-reference.mjs";

const REAL = resolve(CHARTS_ROOT, "skills");
const made = [];
afterEach(() => {
  while (made.length) rmSync(made.pop(), { recursive: true, force: true });
});

/** A writable copy of the skills directory. */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), "ac-skills-"));
  made.push(dir);
  const dst = join(dir, "skills");
  cpSync(REAL, dst, { recursive: true });
  return dst;
}
function edit(path, old, next) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(old)) throw new Error(`${JSON.stringify(old)} is not in ${path}`);
  writeFileSync(path, text.replace(old, next));
}
/** Change the manifest and keep INDEX.md in step, so a test breaks only the thing it means to. */
function editManifest(dir, fn) {
  const p = join(dir, "manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  fn(m.skills);
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  const idx = join(dir, "INDEX.md");
  const text = readFileSync(idx, "utf8");
  const a = text.indexOf(REGISTRY_START) + REGISTRY_START.length, b = text.indexOf(REGISTRY_END);
  writeFileSync(idx, text.slice(0, a) + "\n\n" + renderRegistry(m.skills) + "\n" + text.slice(b));
}
const skill = (m, domain) => m.find((s) => s.domain === domain);
const errs = async (dir, opts = { strict: true }) => (await validate(dir, opts)).errors;
const has = (errors, ...words) => errors.some((e) => words.every((w) => e.includes(w)));
/** The test fails with the checker's own output, so a wrong reason is readable. */
function expectError(errors, ...words) {
  expect(has(errors, ...words), `expected an error with ${JSON.stringify(words)}, got:\n${errors.slice(0, 8).join("\n")}`).toBe(true);
}
const T = { timeout: 60_000 };

// ------------------------------------------------------------------ the real skills

describe("the real skills", () => {
  it("pass strict", T, async () => {
    expect(await errs(REAL)).toEqual([]);
  });

  it("cover every study, builtin and diagnostic", T, async () => {
    const rep = await validate(REAL, { strict: true });
    const c = rep.stats.covered;
    expect(c.studies).toBe(c.studiesTotal);
    expect(c.builtins).toBe(c.builtinsTotal);
    expect(c.rows).toBe(rep.stats.templates);
    expect(c.proofs + c.hosts).toBe(c.rows);
    expect(rep.stats.fixtures).toBe(rep.stats.scripts);
  });
});

// ------------------------------------------------------------------ names

describe("names in code and prose", () => {
  it("a wrong study id in prose", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "`ta.rsi ta.stochrsi", "`ta.rsx ta.stochrsi");
    const e = await errs(d);
    expectError(e, "ta.rsx", "does not exist");
    expectError(e, "study ta.rsi is not named"); // and the real one is no longer covered
  });

  it("a wrong parameter name in code", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "length=len, multUp=2", "period=len, multUp=2");
    expectError(await errs(d), "studies/SKILL.md", "ta.bbands has no parameter \"period\"");
  });

  it("a wrong parameter name in a prose signature", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "`ta.macd(close, fast=8)`", "`ta.macd(close, quick=8)`");
    expectError(await errs(d), "has no parameter \"quick\"");
  });

  it("a prose signature with parameters in the wrong order", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "`ta.macd(close, fast=8)`", "`ta.macd(slow, fast)`");
    expectError(await errs(d), "parameter \"slow\" is at position 3, not 1");
  });

  it("an unknown symbol in prose", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "call `ta.<id>`.", "call `ta.<id>` or `ta.nosuch`.");
    expectError(await errs(d), "core/SKILL.md", "ta.nosuch does not exist");
  });

  it("a parameter that is not one of the study's, named in prose", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "call `ta.<id>`.", "call `ta.<id>`, with `period` of `ta.rsi`.");
    expectError(await errs(d), "`period` is not a parameter or output of ta.rsi");
  });

  it("a builtin no skill teaches", T, async () => {
    const d = tree();
    for (const f of ["script-language/SKILL.md", "plots-and-panes/SKILL.md"]) {
      const p = join(d, f);
      writeFileSync(p, readFileSync(p, "utf8").replaceAll("math.sinh", "math.sinx"));
    }
    const e = await errs(d);
    expectError(e, "math.sinx", "does not exist");
    expectError(e, "builtin math.sinh is not taught");
  });
});

// ------------------------------------------------------------------ examples

describe("script examples", () => {
  it("an example that does not compile", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "plot(ta.rsi(close, len), \"RSI\", color.purple)", "plot(ta.rsi(close, len, \"RSI\", color.purple)");
    expectError(await errs(d), "core/SKILL.md", "example does not compile");
  });

  it("an example that compiles but fails when run", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "plot(100 * (close / ta.sma(close, len) - 1), \"Distance\", color.blue)", "plot(close[bar_index - 5], \"Early\")\nplot(100 * (close / ta.sma(close, len) - 1), \"Distance\", color.blue)");
    expectError(await errs(d), "core/SKILL.md", "example does not run", "history offset");
  });

  it("an invalid example that compiles", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "plot(ta.rsi(close, period=14))", "plot(ta.rsi(close, length=14))");
    expectError(await errs(d), "studies/SKILL.md", "marked invalid but compiled and ran");
  });

  it("an invalid example with the wrong diagnostic", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "<!-- skill: invalid: ta.rsi has no parameter \"period\" (parameters: source, length) -->", "<!-- skill: invalid: ta.rsi has no parameter \"window\" -->");
    expectError(await errs(d), "studies/SKILL.md", "not with the diagnostic it names");
  });

  it("an invalid marker that names no diagnostic", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "<!-- skill: invalid: ta.rsi has no parameter \"period\" (parameters: source, length) -->", "<!-- skill: invalid: -->");
    expectError(await errs(d), "must name the diagnostic");
  });

  it("a numeric claim that is false", T, async () => {
    const d = tree();
    edit(join(d, "script-language/SKILL.md"), "{\"sum\": {\"all\": 15}}", "{\"sum\": {\"all\": 16}}");
    expectError(await errs(d), "script-language/SKILL.md", "plot \"sum\" should be 16");
  });

  it("a recipe whose value is wrong", T, async () => {
    const d = tree();
    // still compiles and runs, but divides by the wrong deviation
    edit(join(d, "quant-recipes/recipes/zscore-returns.acs"), "ta.stdev(ret, len)", "ta.stdev(ret, len + 1)");
    expectError(await errs(d), "recipes/zscore-returns.acs", "differs from the fixture");
  });

  it("a recipe whose fixture is wrong", T, async () => {
    const d = tree();
    edit(join(d, "quant-recipes/recipes/realised-vol.expected.mjs"), "* Math.sqrt(ppy[i]) * 100", "* Math.sqrt(ppy[i])");
    expectError(await errs(d), "recipes/realised-vol.acs", "differs from the fixture");
  });

  it("a recipe with no fixture", T, async () => {
    const d = tree();
    rmSync(join(d, "quant-recipes/recipes/kalman-filter.expected.mjs"));
    editManifest(d, (m) => (skill(m, "quant-recipes").checks = skill(m, "quant-recipes").checks.filter((c) => c !== "recipes/kalman-filter.expected.mjs")));
    expectError(await errs(d), "kalman-filter.acs", "needs a companion fixture");
  });

  it("a fixture that does not cover every plot", T, async () => {
    const d = tree();
    edit(join(d, "quant-recipes/recipes/cumulative-volume-delta.expected.mjs"), "return { CVD: total, \"Rolling delta\": rolling };", "return { CVD: total };");
    expectError(await errs(d), "does not check it");
  });

  // scripts that read outside series run on seeded second instruments, and their fixtures get the reference join
  it("an outside-series recipe whose value is wrong", T, async () => {
    const d = tree();
    edit(join(d, "outside-series/recipes/ratio-sma.acs"), "close / outside(\"IDX\")", "close / outside(\"AAA\")");
    expectError(await errs(d), "recipes/ratio-sma.acs", "differs from the fixture");
  });

  it("an outside-series recipe on the wrong side of the join rule", T, async () => {
    const d = tree();
    // a daily bar shown on its own day (the fixture follows the rule: only a finished day)
    edit(join(d, "outside-series/recipes/previous-day-levels.expected.mjs"), "\"Previous high\": level(\"high\")", "\"Previous high\": level(\"low\")");
    expectError(await errs(d), "recipes/previous-day-levels.acs", "differs from the fixture");
  });

  it("an indicator computed on the wrong bars", T, async () => {
    const d = tree();
    // the RSI of hourly bars read on the chart is not the RSI of the chart's own series
    edit(join(d, "outside-series/recipes/mtf-rsi.acs"), "ta.rsi(outside(timeframe = \"1h\"), len)", "ta.rsi(outside(timeframe = \"1h\") + 0 * close, len)");
    expectError(await errs(d), "recipes/mtf-rsi.acs", "differs from the fixture");
  });

  it("an embedded copy of a recipe that drifted", T, async () => {
    const d = tree();
    edit(join(d, "quant-recipes/SKILL.md"), "z = (ret - ta.sma(ret, len)) / ta.stdev(ret, len)", "z = (ret - ta.sma(ret, len)) / ta.stdev(ret, len + 1)");
    expectError(await errs(d), "quant-recipes/SKILL.md", "stale");
  });
});

// ------------------------------------------------------------------ coverage

describe("coverage", () => {
  it("an uncovered study", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "ta.rsi ta.stochrsi", "ta.stochrsi");
    expectError(await errs(d), "study ta.rsi is not named in the studies skill");
  });

  it("an uncovered study is only an error in strict mode", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "ta.rsi ta.stochrsi", "ta.stochrsi");
    expect(has(await errs(d, { strict: false }), "is not named")).toBe(false);
  });

  it("an uncovered math id", T, async () => {
    const d = tree();
    edit(join(d, "studies/SKILL.md"), "`acos asin", "`asin");
    expectError(await errs(d), "math study `acos` is not named");
  });

  it("an uncovered diagnostic", T, async () => {
    const d = tree();
    const p = join(d, "troubleshooting/catalogue/syntax.md");
    writeFileSync(p, readFileSync(p, "utf8").split("\n").filter((l) => !l.startsWith("- `unterminated string`")).join("\n"));
    expectError(await errs(d), "diagnostic has no row in the troubleshooting skill: unterminated string");
  });

  it("a diagnostic with a row but no example that produces it", T, async () => {
    const d = tree();
    const p = join(d, "troubleshooting/proofs.md");
    const text = readFileSync(p, "utf8");
    const at = text.indexOf("<!-- skill: invalid: unterminated string -->");
    const end = text.indexOf("```\n\n", at) + 5;
    expect(at).toBeGreaterThan(0);
    writeFileSync(p, text.slice(0, at) + text.slice(end));
    expectError(await errs(d), "no invalid example that produces it", "unterminated string");
  });

  it("a row for a diagnostic the language no longer emits", T, async () => {
    const d = tree();
    edit(join(d, "troubleshooting/catalogue/syntax.md"), "- `unterminated string`", "- `unterminated strings`");
    const e = await errs(d);
    expectError(e, "row for a diagnostic the language no longer emits");
    expectError(e, "diagnostic has no row in the troubleshooting skill: unterminated string");
  });
});

// ------------------------------------------------------------------ generated files

describe("generated files", () => {
  it("a stale reference", T, async () => {
    const d = tree();
    edit(join(d, "studies/reference/momentum.md"), "ta.rsi(source:series=close, length:int=14", "ta.rsi(source:series=close, length:int=21");
    expectError(await errs(d, { strict: false }), "studies/reference/momentum.md", "stale");
  });

  it("a missing reference", T, async () => {
    const d = tree();
    rmSync(join(d, "studies/reference/price.md"));
    expectError(await errs(d, { strict: false }), "studies/reference/price.md");
  });

  it("an INDEX out of date", T, async () => {
    const d = tree();
    edit(join(d, "INDEX.md"), "Load when:", "Load when (edited):");
    expectError(await errs(d), "INDEX.md", "out of date");
  });

  it("a language fingerprint that no longer matches", T, async () => {
    const d = tree();
    const p = join(d, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.language_sha256 = "0".repeat(64);
    writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
    expectError(await errs(d), "language_sha256 is out of date");
  });
});

// ------------------------------------------------------------------ manifest, frontmatter, links

describe("structure", () => {
  it("a manifest that disagrees with the frontmatter", T, async () => {
    const d = tree();
    editManifest(d, (m) => (skill(m, "core").description = "Something else entirely."));
    expectError(await errs(d), "core/SKILL.md", "frontmatter description", "differs from manifest");
  });

  it("an api_version that does not match the package", T, async () => {
    const d = tree();
    editManifest(d, (m) => (skill(m, "core").api_version = "1.x"));
    expectError(await errs(d), "api_version 1.x does not match the @alphacharts/script package");
  });

  it("a draft is refused in strict mode and only noted otherwise", T, async () => {
    const d = tree();
    editManifest(d, (m) => (skill(m, "plots-and-panes").status = "draft"));
    edit(join(d, "plots-and-panes/SKILL.md"), "status: stable", "status: draft");
    expectError(await errs(d), "is still a draft");
    const rep = await validate(d, { strict: false });
    expect(has(rep.errors, "is still a draft")).toBe(false);
    expect(rep.notes.join(" ")).toContain("drafts");
  });

  it("a broken link", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "[Troubleshooting](../troubleshooting/SKILL.md).", "[Troubleshooting](../troubleshooting/MISSING.md).");
    expectError(await errs(d), "core/SKILL.md", "does not resolve");
  });

  it("a link that leaves the skills directory", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "[Troubleshooting](../troubleshooting/SKILL.md).", "[Troubleshooting](../../README.md).");
    expectError(await errs(d), "core/SKILL.md", "leaves the skills directory");
  });

  it("a missing section", T, async () => {
    const d = tree();
    edit(join(d, "core/SKILL.md"), "## 8. Common mistakes\n", "");
    expectError(await errs(d), "core/SKILL.md", "the ten sections must be");
    expect(SECTIONS).toHaveLength(10);
  });

  it("a dependency on a skill that does not exist", T, async () => {
    const d = tree();
    editManifest(d, (m) => skill(m, "studies").depends_on.push("alphacharts-nope"));
    edit(join(d, "studies/SKILL.md"), "    - alphacharts-script-language\n", "    - alphacharts-script-language\n    - alphacharts-nope\n");
    expectError(await errs(d), "depends_on \"alphacharts-nope\" is not a skill");
  });

  it("a dependency cycle", T, async () => {
    const d = tree();
    editManifest(d, (m) => skill(m, "core").depends_on.push("alphacharts-studies"));
    edit(join(d, "core/SKILL.md"), "depends_on: []", "depends_on:\n    - alphacharts-studies");
    expectError(await errs(d), "dependency cycle");
  });

  it("a skill on disk that the manifest does not list", T, async () => {
    const d = tree();
    cpSync(join(d, "core"), join(d, "extra"), { recursive: true });
    expectError(await errs(d), "extra/SKILL.md", "not in manifest.json");
  });

  it("a file in a skill directory that the manifest does not list", T, async () => {
    const d = tree();
    writeFileSync(join(d, "studies/notes.md"), "# notes\n");
    expectError(await errs(d), "studies/notes.md", "not in the manifest's assets or checks");
  });

  it("a skill file the manifest lists but is missing", T, async () => {
    const d = tree();
    rmSync(join(d, "plots-and-panes/SKILL.md"));
    expectError(await errs(d), "plots-and-panes/SKILL.md", "missing");
    expect(existsSync(join(d, "plots-and-panes/SKILL.md"))).toBe(false);
  });
});
