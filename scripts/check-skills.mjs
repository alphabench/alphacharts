#!/usr/bin/env node
// The skill checker: `node scripts/check-skills.mjs [--strict] [--sizes] [--skills <dir>]`.
//
// A skill is documentation that has to stay true, so every claim a machine can test is tested here with the
// real compile() and the real engine: the manifest, the files, the frontmatter, the links, the names a skill
// mentions (in code and in prose), every script example (compiled, then run on seeded bars), every example
// marked invalid (it must fail with the diagnostic it names), the numbers of every recipe (against a plain-JS
// fixture), the generated references (not stale), and with --strict that nothing public is left uncovered.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generated } from "./gen-skill-reference.mjs";
import { CHARTS_ROOT, distProblems, extractDiagnostics, loadBuiltins, loadEngine, matchTemplates, runWithOutside, seededBars, templateRegex } from "./lib/skills-engine.mjs";
import { REGISTRY_END, REGISTRY_START, renderRegistry } from "./lib/skills-reference.mjs";

export const SECTIONS = ["When to use this skill", "Domain overview", "API reference", "Standard workflow", "Examples", "Composition", "Constraints and correctness", "Common mistakes", "Validation", "Related skills"];
export const STATUSES = ["draft", "stable"];
export const FRONTMATTER_KEYS = ["name", "description", "version", "api_version", "depends_on", "status"];
export const MANIFEST_KEYS = ["name", "domain", "title", "path", "description", "load_when", "depends_on", "api_version", "status", "assets", "checks"];
export const NAME_PREFIX = "alphacharts-";
/** Estimated tokens a SKILL.md may cost one model round trip. `core` is loaded by nearly every request. */
export const TOKEN_BUDGET = { core: 1800, default: 7000 };
const LANG = "alphacharts";
const SCRIPT_EXT = ".acs";
const NAMESPACES = ["ta", "math", "input", "color", "plot", "shape", "location", "hline", "str"];
/** Call sites in the language's source that pass a message on instead of writing one. */
const PASSTHROUGH = [/^lexer\.ts:\d+: error\(RESERVED\[text\]!\)$/, /^check\.ts:\d+: error\(msg\)$/, /^runner\.ts:\d+: (ScriptError\(e\.message\)|error\(toError\(m\.error\)\)|error\(err\)|fail\(new ScriptError\()/, /^sandbox\.ts:\d+: ScriptError\(r\.diagnostics/];

const FENCE = /^(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/;
const LINK = /(?<!!)\[[^\]\n]*\]\(([^)\s]+)\)/g;
const MARKER = /^<!--\s*skill:\s*(invalid|expect|file)\s*:?\s*([\s\S]*?)\s*-->$/;

class Report {
  errors = [];
  notes = [];
  stats = {};
  err(where, msg) {
    this.errors.push(`${where}: ${msg}`);
  }
}

// --------------------------------------------------------------------- parsing

export function parseFrontmatter(text) {
  const lines = text.split("\n");
  if (!lines.length || lines[0].trim() !== "---") throw new Error("file must start with a '---' frontmatter block");
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") { end = i; break; }
  if (end < 0) throw new Error("frontmatter is not closed by '---'");
  const out = {};
  let i = 1;
  while (i < end) {
    const raw = lines[i];
    if (!raw.trim()) { i++; continue; }
    const m = /^([a-z_]+):\s*(.*)$/.exec(raw);
    if (!m || raw[0] === " ") throw new Error(`line ${i + 1}: unsupported frontmatter line ${JSON.stringify(raw)}`);
    const key = m[1], rest = m[2].trim();
    i++;
    if (key in out) throw new Error(`line ${i}: duplicate key ${JSON.stringify(key)}`);
    if (rest === ">" || rest === "|") {
      const parts = [];
      while (i < end && (lines[i].startsWith(" ") || !lines[i].trim())) parts.push(lines[i++].trim());
      out[key] = parts.filter(Boolean).join(" ");
    } else if (rest === "") {
      const items = [];
      while (i < end && lines[i].trimStart().startsWith("- ")) items.push(lines[i++].trimStart().slice(2).trim());
      out[key] = items;
    } else if (rest === "[]") out[key] = [];
    else out[key] = rest;
  }
  return { fields: out, bodyFrom: end + 2 };
}

/** Fenced blocks: line of the first code line, language, code and the markers on the lines above the fence. */
export function codeBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE.exec(lines[i]);
    if (!m) { i++; continue; }
    const fence = m[1], lang = m[2].toLowerCase();
    const markers = [];
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (!t) continue;
      const mk = MARKER.exec(t);
      if (!mk) break;
      markers.push({ kind: mk[1], arg: mk[2] });
    }
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(fence)) j++;
    blocks.push({ line: i + 2, lang, code: lines.slice(i + 1, j).join("\n"), markers });
    i = j + 1;
  }
  return blocks;
}

/** [line number, line] outside fenced blocks. */
export function prose(text) {
  const out = [];
  let fence = null;
  text.split("\n").forEach((line, k) => {
    const m = FENCE.exec(line);
    if (fence === null && m) fence = m[1];
    else if (fence !== null && line.startsWith(fence)) fence = null;
    else if (fence === null) out.push([k + 1, line]);
  });
  return out;
}

function findCycle(graph) {
  const state = {}, stack = [];
  const visit = (n) => {
    state[n] = 1;
    stack.push(n);
    for (const d of graph[n] ?? []) {
      if (state[d] === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (d in graph && state[d] === undefined) { const c = visit(d); if (c) return c; }
    }
    stack.pop();
    state[n] = 2;
    return null;
  };
  for (const n of Object.keys(graph)) if (state[n] === undefined) { const c = visit(n); if (c) return c; }
  return null;
}

function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

// --------------------------------------------------------------------- names

/** All names a script can write with a dot, from the language's own tables. */
function nameTables(builtins, studies) {
  const funcs = new Map([...builtins.SIGS].map(([k, v]) => [k, v]));
  const dotted = new Set([...funcs.keys(), ...Object.keys(builtins.MEMBER_CONSTS), "ta.tr"].filter((k) => k.includes(".")));
  const bare = new Set([...Object.keys(builtins.BUILTIN_SERIES), "na", "nz", "true", "false"]);
  for (const k of funcs.keys()) if (!k.includes(".")) bare.add(k);
  return { funcs, dotted, bare, studyIds: new Set(studies.map((s) => s.id)) };
}

const DOTTED = new RegExp(`\\b(${NAMESPACES.join("|")})\\.([A-Za-z_][A-Za-z0-9_]*)?(\\*)?`, "g");
const TICK = /`([^`\n]+)`/g;

function checkDotted(rep, where, text, tables) {
  for (const m of text.matchAll(DOTTED)) {
    const ns = m[1], name = m[2] ?? "", star = m[3] === "*";
    const full = `${ns}.${name}`;
    if (star) {
      if (![...tables.dotted].some((d) => d.startsWith(full))) rep.err(where, `${full}* matches no name in the language`);
    } else if (!name) {
      // "color." or a bare namespace followed by a dot in running prose
    } else if (!tables.dotted.has(full)) {
      rep.err(where, `${full} does not exist in the language${nearest(full, tables.dotted)}`);
    }
  }
}
function nearest(full, set) {
  const tail = full.split(".")[1];
  const near = [...set].filter((d) => d.split(".")[1] === tail || d.endsWith(tail) || (tail.length > 3 && d.includes(tail.slice(0, 4)))).slice(0, 3);
  return near.length ? ` (did you mean ${near.join(", ")}?)` : "";
}

/** Split call arguments at top-level commas. */
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = "", q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A call written in a ticked span of prose is a signature: its names must be the function's parameters, in order. */
function checkSignatureSpan(rep, where, span, tables, extra) {
  const m = /(?:^|[^A-Za-z0-9_.])((?:ta|math|input|color)\.[a-z_0-9]+|nz|na|plot|hline|fill|plotshape|indicator|barcolor|bgcolor|outside)\(/.exec(span);
  if (!m) return;
  const name = m[1];
  const sig = tables.funcs.get(name);
  if (!sig) return; // an unknown dotted name is reported by checkDotted
  let depth = 0, end = -1;
  const start = m.index + m[0].length;
  for (let i = start - 1; i < span.length; i++) {
    if (span[i] === "(") depth++;
    if (span[i] === ")" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return;
  const args = splitArgs(span.slice(start, end));
  const names = sig.params.map((p) => p.name);
  args.forEach((a, k) => {
    if (a === "..." || a === "") return;
    const nm = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(a);
    if (nm) {
      if (!names.includes(nm[1])) rep.err(where, `\`${name}\` has no parameter "${nm[1]}" (parameters: ${names.join(", ") || "none"})`);
      return;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(a) && !tables.bare.has(a) && !extra.has(a)) {
      if (!names.includes(a)) rep.err(where, `\`${name}(...)\`: "${a}" is not a parameter of ${name} (parameters: ${names.join(", ") || "none"})`);
      else if (names[k] !== a) rep.err(where, `\`${name}(...)\`: parameter "${a}" is at position ${names.indexOf(a) + 1}, not ${k + 1}`);
    }
  });
}

/** `x` of `ta.y`: x must be a parameter or an output of ta.y. */
function checkParamPhrases(rep, where, line, tables, studyByFn) {
  for (const m of line.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)` (?:of|in) `(ta\.[a-z_0-9]+)(?:\(\))?`/g)) {
    const sig = tables.funcs.get(m[2]);
    if (!sig) continue;
    const outs = studyByFn.get(m[2])?.columns ?? [];
    if (!sig.params.some((p) => p.name === m[1]) && !outs.includes(m[1])) rep.err(where, `\`${m[1]}\` is not a parameter or output of ${m[2]} (parameters: ${sig.params.map((p) => p.name).join(", ") || "none"}; outputs: ${outs.join(", ") || "one series"})`);
  }
}

/** Prose joined into paragraphs (a ticked span may wrap over lines): [first line number, text]. */
function paragraphs(text) {
  const out = [];
  let cur = null;
  for (const [n, line] of prose(text)) {
    if (!line.trim()) { cur = null; continue; }
    if (cur && !/^\s*([-*]|\d+\.|\||#)/.test(line)) cur[1] += ` ${line.trim()}`;
    else out.push((cur = [n, line.trim()]));
  }
  return out;
}

function checkProse(rep, where0, text, bodyFrom, tables, studyByFn, mentioned) {
  for (const [n, para] of paragraphs(text)) {
    if (n < bodyFrom) continue;
    const where = `${where0}:${n}`;
    for (const t of para.matchAll(TICK)) {
      checkDotted(rep, where, t[1], tables);
      checkSignatureSpan(rep, where, t[1], tables, new Set());
      for (const w of t[1].match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) mentioned.add(w.replace(/\.$/, ""));
    }
    checkParamPhrases(rep, where, para, tables, studyByFn);
  }
}

// --------------------------------------------------------------------- running scripts

function limitsWith(engine, arg) {
  if (!arg) return engine.limits;
  return { ...engine.limits, ...JSON.parse(arg) };
}

/** Compile and run on the seeded bars. Returns { ok, compiled, columns, messages } where messages are every diagnostic or thrown error. */
function attempt(engine, source, { inputs = {}, limits, bars }) {
  let compiled;
  try {
    compiled = engine.compile(source, limits ?? engine.limits);
  } catch (e) {
    return { ok: false, messages: [String(e?.message ?? e)], phase: "compile" };
  }
  if (!compiled.ok) return { ok: false, messages: compiled.diagnostics.map((d) => d.message), diagnostics: compiled.diagnostics, phase: "compile" };
  try {
    // a script that reads outside series, or bars per year (it needs finished days), runs on many days of bars with every series it reads generated here
    if (compiled.plan.dependencies.length > 0 || /\bbars_per_year\b/.test(source)) {
      const o = runWithOutside(engine, compiled, inputs);
      return { ok: true, compiled, columns: o.columns, messages: [], bars: o.bars, ctx: o.ctx };
    }
    const columns = engine.runStudy(compiled.study, inputs, bars);
    return { ok: true, compiled, columns, messages: [], bars };
  } catch (e) {
    return { ok: false, compiled, messages: [String(e?.message ?? e)], phase: "run" };
  }
}

function columnOf(compiled, columns, title) {
  const plot = compiled.study.plots.find((p) => p.title === title && "col" in p);
  if (!plot) return null;
  return columns[compiled.study.columns.indexOf(plot.col)] ?? null;
}

const same = (a, b, tol) => (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function checkExpect(rep, at, compiled, columns, spec) {
  let want;
  try {
    want = JSON.parse(spec);
  } catch (e) {
    rep.err(at, `expect marker is not JSON: ${e.message}`);
    return;
  }
  for (const [title, rule] of Object.entries(want)) {
    const col = columnOf(compiled, columns, title);
    if (!col) { rep.err(at, `expect names plot "${title}", which the script does not draw`); continue; }
    const val = (v) => (v === "na" ? Number.NaN : v);
    if ("all" in rule) {
      const w = val(rule.all);
      const bad = [...col].findIndex((x) => !same(x, w, 1e-9));
      if (bad >= 0) rep.err(at, `plot "${title}" should be ${rule.all} on every bar; bar ${bad} is ${col[bad]}`);
    }
    for (const [i, v] of Object.entries(rule.at ?? {})) {
      if (!same(col[+i], val(v), 1e-9)) rep.err(at, `plot "${title}" at bar ${i}: expected ${v}, got ${col[+i]}`);
    }
    if ("firstValid" in rule) {
      const f = [...col].findIndex((x) => !Number.isNaN(x));
      if (f !== rule.firstValid) rep.err(at, `plot "${title}": first value at bar ${f}, expected ${rule.firstValid}`);
    }
  }
}

async function checkFixture(rep, at, file, compiled, columns, bars, strict, ctx) {
  let mod;
  try {
    const st = statSync(file);
    mod = await import(`${pathToFileURL(file).href}?v=${st.mtimeMs}-${st.size}`);
  } catch (e) {
    rep.err(at, `fixture does not load: ${e.message}`);
    return 0;
  }
  if (typeof mod.expected !== "function") { rep.err(at, "fixture must export a function `expected(bars, inputs)`"); return 0; }
  let want;
  try {
    want = mod.expected(bars, mod.inputs ?? {}, ctx);
  } catch (e) {
    rep.err(at, `fixture failed: ${e.message}`);
    return 0;
  }
  const tol = mod.tolerance ?? 1e-9;
  let checked = 0;
  for (const [title, arr] of Object.entries(want)) {
    const col = columnOf(compiled, columns, title);
    if (!col) { rep.err(at, `fixture names plot "${title}", which the script does not draw`); continue; }
    if (arr.length !== col.length) { rep.err(at, `fixture "${title}" has ${arr.length} values for ${col.length} bars`); continue; }
    const bad = arr.findIndex((v, i) => !same(col[i], v, tol));
    if (bad >= 0) rep.err(at, `plot "${title}" differs from the fixture at bar ${bad}: script ${col[bad]}, fixture ${arr[bad]}`);
    else checked++;
  }
  if (strict || true) {
    for (const p of compiled.study.plots) if ("col" in p && !(p.title in want)) rep.err(at, `the script draws plot "${p.title}" and the fixture does not check it`);
  }
  return checked;
}

// --------------------------------------------------------------------- the reference smoke test

const SOURCE_SERIES = new Set(["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "hlcc4"]);

/** A call to every callable `ta.*` built from its generated signature: by position and by name, run on the bars. */
function smokeScripts(sig, outputs) {
  const lit = (p) => {
    const i = p.input;
    if (p.kind === "series") return i ? String(i.default) : p.name === "x" || p.name === "a" || p.name === "source" ? "close" : "open";
    if (p.kind === "string") return JSON.stringify(i ? i.default : p.oneOf?.[0] ?? "");
    if (p.kind === "bool") return String(i ? i.default : true);
    const lo = p.min ?? 0;
    const v = i ? i.default : Math.max(lo, p.kind === "int" ? 10 : 2);
    return String(v);
  };
  const positional = sig.params.map((p) => lit(p));
  const named = sig.params.map((p) => `${p.name}=${lit(p)}`);
  const mk = (args) => {
    const call = `${sig.name}(${args.join(", ")})`;
    if (outputs.length > 1) return `[${outputs.map((_, k) => `o${k}`).join(", ")}] = ${call}\n${outputs.map((_, k) => `plot(o${k}, "o${k}")`).join("\n")}\n`;
    return `plot(${call}, "out")\n`;
  };
  // `series` parameters that follow a literal cannot be given by position only when the study has no earlier required one; both forms are valid
  return [mk(positional), mk(named)];
}

async function smokeReference(rep, engine, builtins, facts, bars) {
  const studyByFn = new Map(engine.studies.filter((s) => s.family !== "math").map((s) => [`ta.${s.id.replace(/-/g, "_")}`, s]));
  let ok = 0;
  for (const name of facts.callable) {
    const sig = builtins.SIGS.get(name);
    const def = sig.study ?? studyByFn.get(name);
    const outputs = sig.ret.elems ? sig.ret.elems : [0];
    for (const [k, src] of smokeScripts(sig, outputs).entries()) {
      const r = attempt(engine, src, { bars });
      if (!r.ok) rep.err(`reference:${name}`, `${k === 0 ? "positional" : "named"} call from the generated signature fails: ${r.messages.join("; ")}`);
      else if (k === 1) ok++;
    }
    void def;
  }
  return ok;
}

// --------------------------------------------------------------------- the check

export async function validate(root, { strict = false, chartsRoot = CHARTS_ROOT } = {}) {
  const rep = new Report();
  const mpath = join(root, "manifest.json");
  if (!existsSync(mpath)) { rep.err(mpath, "manifest.json is missing"); return rep; }
  let manifest, skills;
  try {
    manifest = JSON.parse(readFileSync(mpath, "utf8"));
    skills = manifest.skills;
    if (!Array.isArray(skills)) throw new Error("`skills` is not a list");
  } catch (e) {
    rep.err("manifest.json", `not a manifest: ${e.message}`);
    return rep;
  }

  for (const p of distProblems(chartsRoot)) rep.err("engine", p);
  const engine = await loadEngine(chartsRoot);
  const builtins = await loadBuiltins(chartsRoot);
  const tables = nameTables(builtins, engine.studies);
  const studyByFn = new Map(engine.studies.filter((s) => s.family !== "math").map((s) => [`ta.${s.id.replace(/-/g, "_")}`, s]));
  const bars = seededBars();
  const gen = await generated(root, chartsRoot);
  const generatedPaths = new Set([...gen.files.keys()].filter((k) => k.includes("/reference/")));
  const extracted = extractDiagnostics(chartsRoot);
  for (const u of extracted.unresolved) if (!PASSTHROUGH.some((re) => re.test(u))) rep.err("diagnostics", `the language source has a message the checker cannot read: ${u}`);
  const templates = extracted.diagnostics.map((d) => d.template);

  // -- the extractor itself must read every message the language's own corpus expects
  const corpusFile = join(chartsRoot, "packages/script/test/corpus-invalid.json");
  if (existsSync(corpusFile)) {
    let misses = 0;
    for (const [, msgs] of JSON.parse(readFileSync(corpusFile, "utf8"))) {
      for (const full of msgs) {
        const msg = full.replace(/^\d+:\d+ /, "");
        if (!matchTemplates(msg, templates).length) { rep.err("diagnostics", `the corpus expects a message no template matches: ${JSON.stringify(msg)}`); misses++; }
      }
    }
    rep.stats.corpusMisses = misses;
  }

  // -- manifest schema
  const names = new Map();
  const wantApi = `${String(engine.scriptVersion).split(".")[0]}.x`;
  for (const s of skills) {
    const label = `manifest.json[${s.name ?? "?"}]`;
    if (JSON.stringify([...Object.keys(s)].sort()) !== JSON.stringify([...MANIFEST_KEYS].sort())) { rep.err(label, `keys must be exactly ${JSON.stringify([...MANIFEST_KEYS].sort())}, got ${JSON.stringify(Object.keys(s).sort())}`); continue; }
    if (names.has(s.name)) rep.err(label, "duplicate name");
    names.set(s.name, s);
    if (s.name !== `${NAME_PREFIX}${s.domain}`) rep.err(label, `name must be ${NAME_PREFIX}${s.domain}`);
    if (s.path !== `${s.domain}/SKILL.md`) rep.err(label, `path must be ${s.domain}/SKILL.md`);
    if (!STATUSES.includes(s.status)) rep.err(label, `status must be one of ${STATUSES.join(", ")}`);
    if (!/^\d+\.x$/.test(s.api_version)) rep.err(label, "api_version must look like '0.x'");
    else if (s.api_version !== wantApi) rep.err(label, `api_version ${s.api_version} does not match the @alphacharts/script package (${engine.scriptVersion}, so ${wantApi})`);
    for (const k of ["load_when", "depends_on", "assets", "checks"]) if (!Array.isArray(s[k]) || !s[k].every((x) => typeof x === "string")) rep.err(label, `${k} must be a list of strings`);
    if (!s.load_when?.length) rep.err(label, "load_when must name at least one situation");
  }
  if (manifest.package !== "alphacharts") rep.err("manifest.json", 'package must be "alphacharts"');
  if (manifest.language_sha256 !== gen.sha) rep.err("manifest.json", `language_sha256 is out of date: the builtins, studies or diagnostics changed. Review the skills, then run pnpm gen:skills`);

  // -- files <-> manifest
  const onDisk = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(root, d.name, "SKILL.md"))).map((d) => d.name);
  for (const d of onDisk) if (![...names.values()].some((s) => s.domain === d)) rep.err(`${d}/SKILL.md`, "exists but is not in manifest.json");
  for (const s of names.values()) {
    const dir = join(root, s.domain);
    if (!existsSync(join(root, s.path))) { rep.err(s.path, "listed in manifest.json but missing"); continue; }
    const listed = new Set([...s.assets, ...s.checks]);
    for (const a of s.assets) if (s.checks.includes(a)) rep.err(`manifest.json[${s.name}]`, `${a} is both an asset and a check file`);
    for (const f of listed) if (!existsSync(join(dir, f))) rep.err(`manifest.json[${s.name}]`, `${f} is listed but missing`);
    const present = walkFiles(dir).map((p) => relative(dir, p).split(sep).join("/")).filter((p) => p !== "SKILL.md" && !p.endsWith(".DS_Store"));
    for (const f of present) if (!listed.has(f)) rep.err(`${s.domain}/${f}`, "exists but is not in the manifest's assets or checks");
    for (const [path, text] of gen.files) {
      if (path.startsWith(`${s.domain}/reference/`) && !s.assets.includes(path.slice(s.domain.length + 1))) rep.err(`manifest.json[${s.name}]`, `generated ${path} must be listed in assets`);
      void text;
    }
  }

  // -- generated files up to date
  for (const [rel, text] of gen.files) {
    if (rel === "manifest.json") continue;
    const p = join(root, rel);
    if (!existsSync(p)) rep.err(rel, "generated file is missing; run pnpm gen:skills");
    else if (readFileSync(p, "utf8") !== text) rep.err(rel, rel === "INDEX.md" ? "registry is out of date with manifest.json; run pnpm gen:skills" : "the reference is stale against the registry/builtins; run pnpm gen:skills");
  }

  // -- the skills
  const counters = { validBlocks: 0, embedded: 0, blocks: 0, ran: 0, invalid: 0, invalidProved: 0, scripts: 0, fixtures: 0, expects: 0 };
  const proved = new Set(); // templates an invalid example produced
  const mentioned = new Set(); // names in hand-written text (code identifiers and ticked prose)
  const rowTemplates = new Map(); // template -> { where, host }
  const handText = new Map(); // domain -> text, for coverage
  const sizes = [];

  const handleBlock = (at, b, ctx) => {
    if (b.lang !== LANG) {
      if (b.markers.length) rep.err(at, `a skill marker sits above a block that is not \`${LANG}\``);
      if (b.lang !== "json") {
        checkDotted(rep, at, b.code, tables);
        if (ctx.domain !== "troubleshooting") for (const w of b.code.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) mentioned.add(w);
      }
      return null;
    }
    const fileMarker = b.markers.find((m) => m.kind === "file");
    if (fileMarker) {
      // the block is a copy of a script file, kept in step by pnpm gen:skills; the file itself is compiled, run and checked
      if (!existsSync(join(root, ctx.domain, fileMarker.arg))) rep.err(at, `file marker names ${fileMarker.arg}, which does not exist`);
      counters.embedded++;
      return null;
    }
    counters.blocks++;
    const inv = b.markers.find((m) => m.kind === "invalid");
    const exp = b.markers.find((m) => m.kind === "expect");
    if (inv) {
      counters.invalid++;
      const [msg, ...rest] = inv.arg.split(" ;; ");
      if (!msg) { rep.err(at, "an invalid marker must name the diagnostic: <!-- skill: invalid: <exact message> -->"); return null; }
      let limits;
      try {
        const lim = rest.find((r) => r.startsWith("limits="));
        limits = limitsWith(engine, lim ? lim.slice(7) : "");
      } catch (e) {
        rep.err(at, `limits are not JSON: ${e.message}`);
        return null;
      }
      const r = attempt(engine, b.code, { bars, limits });
      if (r.ok) rep.err(at, "example is marked invalid but compiled and ran without error");
      else if (!r.messages.includes(msg)) rep.err(at, `example fails, but not with the diagnostic it names.\n    named:  ${msg}\n    actual: ${r.messages.slice(0, 3).join(" | ")}`);
      else {
        counters.invalidProved++;
        const t = matchTemplates(msg, templates)[0];
        if (t) proved.add(t);
        else rep.err(at, `the diagnostic matches no template in the language source: ${msg}`);
      }
      return null;
    }
    const r = attempt(engine, b.code, { bars });
    if (!r.ok) {
      rep.err(at, `example does not ${r.phase === "compile" ? "compile" : "run"}: ${r.messages.slice(0, 4).join(" | ")}`);
      return null;
    }
    counters.ran++;
    counters.validBlocks++;
    if (exp) { counters.expects++; checkExpect(rep, at, r.compiled, r.columns, exp.arg); }
    void ctx;
    return r;
  };

  const scanText = async (rel, text, { fm = null, generatedFile = false, domain }) => {
    const { bodyFrom } = fm ?? { bodyFrom: 1 };
    for (const b of codeBlocks(text)) handleBlock(`${rel}:${b.line}`, b, { domain });
    if (generatedFile) return;
    const m0 = new Set();
    checkProse(rep, rel, text, bodyFrom, tables, studyByFn, m0);
    if (domain !== "troubleshooting") for (const w of m0) mentioned.add(w); // the catalogue quotes names; it does not teach them
    for (const [n, line] of prose(text)) {
      const row = /^- `([^`]+)`(.*)$/.exec(line);
      if (row && domain === "troubleshooting") {
        const prev = rowTemplates.get(row[1]);
        if (prev) rep.err(`${rel}:${n}`, `diagnostic row repeated (first at ${prev.where})`);
        else rowTemplates.set(row[1], { where: `${rel}:${n}`, host: /\[host\]/.test(row[2]) });
      }
    }
  };

  for (const s of names.values()) {
    const file = join(root, s.path);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    sizes.push({ name: s.name, domain: s.domain, tokens: Math.ceil(text.length / 4), assets: s.assets.filter((a) => existsSync(join(root, s.domain, a))).map((a) => ({ path: a, tokens: Math.ceil(statSync(join(root, s.domain, a)).size / 4) })) });
    let fm;
    try {
      fm = parseFrontmatter(text);
    } catch (e) {
      rep.err(s.path, e.message);
      continue;
    }
    if (JSON.stringify([...Object.keys(fm.fields)].sort()) !== JSON.stringify([...FRONTMATTER_KEYS].sort())) { rep.err(s.path, `frontmatter keys must be exactly ${JSON.stringify(FRONTMATTER_KEYS)}, got ${JSON.stringify(Object.keys(fm.fields))}`); continue; }
    for (const k of ["name", "description", "api_version", "depends_on", "status"]) {
      if (JSON.stringify(fm.fields[k]) !== JSON.stringify(s[k])) rep.err(s.path, `frontmatter ${k} ${JSON.stringify(fm.fields[k])} differs from manifest ${JSON.stringify(s[k])}`);
    }
    if (!/^\d+(\.\d+)*$/.test(fm.fields.version)) rep.err(s.path, `frontmatter version ${JSON.stringify(fm.fields.version)} is not a number like 1.0`);
    const found = prose(text).filter(([, l]) => l.startsWith("## ")).map(([, l]) => l.slice(3).trim());
    const want = SECTIONS.map((t, i) => `${i + 1}. ${t}`);
    if (JSON.stringify(found) !== JSON.stringify(want)) rep.err(s.path, `the ten sections must be, in order: ${want.join("; ")} (found: ${found.join("; ") || "none"})`);
    const budget = TOKEN_BUDGET[s.domain] ?? TOKEN_BUDGET.default;
    if (strict && Math.ceil(text.length / 4) > budget) rep.err(s.path, `about ${Math.ceil(text.length / 4)} tokens; the budget for this skill is ${budget}`);
    if (s.status === "draft") continue;
    handText.set(s.domain, text);
    await scanText(s.path, text, { fm, domain: s.domain });
    checkLinks(rep, root, join(root, s.path));

    // assets and checks of this skill
    for (const a of [...s.assets, ...s.checks]) {
      const p = join(root, s.domain, a);
      if (!existsSync(p)) continue;
      const rel = `${s.domain}/${a}`;
      if (a.endsWith(".md")) {
        const t = readFileSync(p, "utf8");
        await scanText(rel, t, { domain: s.domain, generatedFile: generatedPaths.has(rel) });
        checkLinks(rep, root, p);
      } else if (a.endsWith(SCRIPT_EXT)) {
        counters.scripts++;
        const code = readFileSync(p, "utf8");
        const fixtureRel = a.slice(0, -SCRIPT_EXT.length) + ".expected.mjs";
        const r = attempt(engine, code, { bars, inputs: await fixtureInputs(join(root, s.domain, fixtureRel)) });
        if (!r.ok) { rep.err(rel, `script does not ${r.phase === "compile" ? "compile" : "run"}: ${r.messages.slice(0, 4).join(" | ")}`); continue; }
        counters.ran++;
        for (const w of code.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) mentioned.add(w);
        checkDotted(rep, rel, code, tables);
        if (!s.checks.includes(fixtureRel)) { rep.err(rel, `a script needs a companion fixture ${fixtureRel} listed in checks`); continue; }
        counters.fixtures += (await checkFixture(rep, rel, join(root, s.domain, fixtureRel), r.compiled, r.columns, r.bars, strict, r.ctx)) > 0 ? 1 : 0;
      } else if (a.endsWith(".expected.mjs")) {
        const script = a.slice(0, -".expected.mjs".length) + SCRIPT_EXT;
        if (!s.assets.includes(script) && !s.checks.includes(script)) rep.err(rel, "fixture has no script of the same name in assets or checks");
      } else if (!a.endsWith(".json") && !a.endsWith(".mjs")) rep.err(rel, "unknown file type (assets are .md, .acs; checks are .md, .expected.mjs)");
    }
  }
  // -- links in INDEX
  if (existsSync(join(root, "INDEX.md"))) checkLinks(rep, root, join(root, "INDEX.md"));
  else rep.err("INDEX.md", "missing");
  const itext = existsSync(join(root, "INDEX.md")) ? readFileSync(join(root, "INDEX.md"), "utf8") : "";
  if (itext && (!itext.includes(REGISTRY_START) || !itext.includes(REGISTRY_END))) rep.err("INDEX.md", `needs the ${REGISTRY_START} ... ${REGISTRY_END} markers around the registry`);
  void renderRegistry;

  // -- dependencies
  const graph = Object.fromEntries([...names.values()].map((s) => [s.name, s.depends_on ?? []]));
  for (const [n, deps] of Object.entries(graph)) {
    for (const d of deps) {
      if (d === n) rep.err(`manifest.json[${n}]`, "depends on itself");
      else if (!names.has(d)) rep.err(`manifest.json[${n}]`, `depends_on ${JSON.stringify(d)} is not a skill`);
    }
  }
  const cyc = findCycle(Object.fromEntries(Object.entries(graph).map(([n, g]) => [n, g.filter((d) => d !== n)])));
  if (cyc) rep.err("manifest.json", `dependency cycle: ${cyc.join(" -> ")}`);

  // -- the generated signatures, called for real
  rep.stats.smoke = await smokeReference(rep, engine, builtins, gen.facts, bars);
  for (const n of gen.facts.unwritable) {
    const r = attempt(engine, `plot(${n}())\n`, { bars });
    if (r.ok) rep.err(`reference:${n}`, "the reference says this name cannot be written, but it compiles");
  }
  rep.stats.callable = gen.facts.callable.length;

  // -- diagnostics rows: no row for a message that no longer exists
  for (const [t, v] of rowTemplates) if (!templates.includes(t)) rep.err(v.where, `row for a diagnostic the language no longer emits: ${t}`);

  // -- coverage
  const drafts = [...names.values()].filter((s) => s.status === "draft").map((s) => s.name);
  const covered = { studies: 0, builtins: 0, builtinsTotal: 0, rows: 0, proofs: 0, hosts: 0 };
  const studiesWords = new Set();
  for (const [, para] of paragraphs(handText.get("studies") ?? "")) for (const t of para.matchAll(TICK)) for (const w of t[1].match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []) studiesWords.add(w);
  const missingStudies = [...gen.facts.callable, ...gen.facts.unwritable].filter((n) => !studiesWords.has(n));
  const missingMath = gen.facts.mathIds.filter((id) => !studiesWords.has(id));
  covered.studies = gen.facts.callable.length + gen.facts.unwritable.length - missingStudies.length + gen.facts.mathIds.length - missingMath.length;
  covered.studiesTotal = gen.facts.callable.length + gen.facts.unwritable.length + gen.facts.mathIds.length;

  const builtinNames = [...new Set([...builtins.SIGS.keys()].filter((k) => !gen.facts.callable.includes(k) || gen.facts.kernelOnly.includes(k)), ...[])];
  const allBuiltins = [...new Set([...builtinNames, ...Object.keys(builtins.BUILTIN_SERIES), ...Object.keys(builtins.MEMBER_CONSTS), "ta.tr", "na"])].filter((n) => !(builtins.SIGS.get(n)?.op === "study"));
  const missingBuiltins = allBuiltins.filter((n) => !mentioned.has(n));
  covered.builtinsTotal = allBuiltins.length;
  covered.builtins = allBuiltins.length - missingBuiltins.length;

  const missingRows = [], missingProof = [];
  for (const t of templates) {
    const row = rowTemplates.get(t);
    if (!row) { missingRows.push(t); continue; }
    covered.rows++;
    if (proved.has(t)) covered.proofs++;
    else if (row.host) covered.hosts++;
    else missingProof.push(t);
  }
  rep.stats = { ...rep.stats, ...counters, covered, templates: templates.length };

  if (strict) {
    for (const n of drafts) rep.err(`manifest.json[${n}]`, "is still a draft");
    for (const n of missingStudies) rep.err("coverage", `study ${n} is not named in the studies skill`);
    for (const id of missingMath) rep.err("coverage", `math study \`${id}\` is not named in the studies skill`);
    for (const n of missingBuiltins) rep.err("coverage", `builtin ${n} is not taught by any skill (name it in a skill's prose or an example)`);
    for (const t of missingRows) rep.err("coverage", `diagnostic has no row in the troubleshooting skill: ${t}`);
    for (const t of missingProof) rep.err("coverage", `diagnostic has no invalid example that produces it (or mark its row [host]): ${t}`);
    if (!names.has(`${NAME_PREFIX}core`)) rep.err("coverage", "there is no core skill");
  } else if (drafts.length) rep.notes.push(`${drafts.length} of ${names.size} skills are drafts (their examples are not run; --strict forbids them)`);
  rep.sizes = sizes;
  return rep;
}

async function fixtureInputs(file) {
  if (!existsSync(file)) return {};
  try {
    const st = statSync(file);
    const mod = await import(`${pathToFileURL(file).href}?v=${st.mtimeMs}-${st.size}`);
    return mod.inputs ?? {};
  } catch {
    return {};
  }
}

function checkLinks(rep, root, file) {
  for (const [n, line] of prose(readFileSync(file, "utf8"))) {
    for (const m of line.matchAll(LINK)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/.test(target) || target.startsWith("#")) continue;
      const path = resolve(dirname(file), target.split("#")[0]);
      const where = `${relative(root, file)}:${n}`;
      if (!(path + sep).startsWith(resolve(root) + sep)) rep.err(where, `link ${JSON.stringify(target)} leaves the skills directory (it would break in the image)`);
      else if (!existsSync(path)) rep.err(where, `link ${JSON.stringify(target)} does not resolve`);
    }
  }
}

export function formatReport(rep, strict) {
  const out = [];
  for (const e of rep.errors) out.push(`error: ${e}`);
  for (const n of rep.notes) out.push(`note: ${n}`);
  const s = rep.stats, c = s.covered;
  if (c) {
    const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
    out.push(
      "coverage:",
      `  valid examples compiled and run: ${s.ran} of ${s.blocks + s.scripts - s.invalid} (${s.validBlocks} in SKILL.md and assets, ${s.scripts} script files; ${s.embedded} more are copies of script files)`,
      `  invalid examples failing with the diagnostic they name: ${s.invalidProved} of ${s.invalid}`,
      `  script files checked against a plain-JS fixture: ${s.fixtures} of ${s.scripts} (${pct(s.fixtures, s.scripts)})`,
      `  numeric expect markers:          ${s.expects}`,
      `  callable ta.* called from the generated signature, by position and by name: ${s.smoke} of ${s.callable}`,
      `  studies named in the studies skill: ${c.studies} of ${c.studiesTotal} (${pct(c.studies, c.studiesTotal)})`,
      `  builtins taught:                 ${c.builtins} of ${c.builtinsTotal} (${pct(c.builtins, c.builtinsTotal)})`,
      `  diagnostics with a row:          ${c.rows} of ${s.templates} (${pct(c.rows, s.templates)}); proven by an example: ${c.proofs}; marked [host] (not reachable from a script): ${c.hosts}`,
    );
  }
  out.push(`skills check${strict ? " --strict" : ""}: ${rep.errors.length} error(s)`);
  return out.join("\n");
}

export function formatSizes(rep) {
  const out = ["tokens (characters / 4):"];
  let total = 0;
  for (const z of rep.sizes ?? []) {
    const assets = z.assets.reduce((a, b) => a + b.tokens, 0);
    total += z.tokens;
    out.push(`  ${z.domain.padEnd(18)} SKILL.md ${String(z.tokens).padStart(5)}   assets ${String(assets).padStart(6)} (${z.assets.length} files${z.assets.length ? ", largest " + Math.max(...z.assets.map((a) => a.tokens)) : ""})`);
  }
  out.push(`  all SKILL.md: ${total}`);
  return out.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const i = argv.indexOf("--skills");
  const root = resolve(i >= 0 ? argv[i + 1] : join(CHARTS_ROOT, "skills"));
  const rep = await validate(root, { strict });
  console.log(formatReport(rep, strict));
  if (argv.includes("--sizes")) console.log(formatSizes(rep));
  process.exit(rep.errors.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
