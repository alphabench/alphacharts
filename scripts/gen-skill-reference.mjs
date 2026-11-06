#!/usr/bin/env node
// Writes the generated parts of charts/skills: the per-study reference (by family), the builtins reference,
// the manifest's language fingerprint and INDEX.md. `--check` writes nothing and exits 1 when any of them is stale.
//
//   node scripts/gen-skill-reference.mjs            # rewrite
//   node scripts/gen-skill-reference.mjs --check    # fail when stale

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARTS_ROOT, distProblems, loadBuiltins, loadEngine, loadReservedWords } from "./lib/skills-engine.mjs";
import { languageSha256, REGISTRY_END, REGISTRY_START, renderReference, renderRegistry, syncFileBlocks } from "./lib/skills-reference.mjs";

/** What would be generated for `skillsDir`: path -> text. Used by the checker too. */
export async function generated(skillsDir, root = CHARTS_ROOT) {
  const engine = await loadEngine(root);
  const builtins = await loadBuiltins(root);
  const ref = renderReference({ studies: engine.studies, builtins, words: await loadReservedWords(root) });
  const out = new Map(ref.files);
  const manifestPath = join(skillsDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sha = languageSha256(ref, root);
  const next = { ...manifest, language_sha256: sha };
  out.set("manifest.json", JSON.stringify(next, null, 2) + "\n");
  for (const sk of manifest.skills) {
    const f = join(skillsDir, sk.path);
    if (existsSync(f)) out.set(sk.path, syncFileBlocks(readFileSync(f, "utf8"), (rel) => readFileSync(join(skillsDir, sk.domain, rel), "utf8")));
  }
  const idx = join(skillsDir, "INDEX.md");
  const text = readFileSync(idx, "utf8");
  const a = text.indexOf(REGISTRY_START), b = text.indexOf(REGISTRY_END);
  if (a < 0 || b < 0) throw new Error("INDEX.md needs the registry markers");
  out.set("INDEX.md", text.slice(0, a + REGISTRY_START.length) + "\n\n" + renderRegistry(manifest.skills) + "\n" + text.slice(b));
  return { files: out, facts: ref.facts, sha };
}

async function main() {
  const check = process.argv.includes("--check");
  const skillsDir = resolve(CHARTS_ROOT, "skills");
  const problems = distProblems();
  if (problems.length) {
    for (const p of problems) console.error(`error: ${p}`);
    process.exit(1);
  }
  const { files } = await generated(skillsDir);
  const stale = [];
  for (const [rel, text] of files) {
    const p = join(skillsDir, rel);
    const have = existsSync(p) ? readFileSync(p, "utf8") : null;
    if (have === text) continue;
    stale.push(rel);
    if (!check) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
  }
  if (check) {
    for (const s of stale) console.error(`error: ${s} is stale; run pnpm gen:skills`);
    console.log(`gen-skill-reference --check: ${stale.length} stale of ${files.size} generated file(s)`);
    process.exit(stale.length ? 1 : 0);
  }
  console.log(`gen-skill-reference: wrote ${stale.length} of ${files.size} file(s)${stale.length ? ": " + stale.join(", ") : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
