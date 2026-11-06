// What the skill tools share: the built engine (compile, run, the study registry), the language's own
// tables (builtins.ts, read from source), every diagnostic the compiler can emit (read from source),
// and the seeded bars every example runs on. Nothing here is written by hand about the language.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const CHARTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = (root, name) => join(root, "packages", name);

// ---- the built engine --------------------------------------------------------------------

function newestFile(dir, ext) {
  let newest = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (ext.some((x) => e.name.endsWith(x))) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/** Problems that make the built packages untrustworthy as a stand-in for the source (empty when fine). */
export function distProblems(root = CHARTS_ROOT) {
  const out = [];
  for (const name of ["script", "indicators"]) {
    const dist = join(pkg(root, name), "dist", "index.js");
    if (!existsSync(dist)) {
      out.push(`packages/${name}/dist is missing: run pnpm build`);
      continue;
    }
    const built = statSync(dist).mtimeMs;
    const src = newestFile(join(pkg(root, name), "src"), [".ts"]);
    if (src > built + 1000) out.push(`packages/${name}/dist is older than packages/${name}/src: run pnpm build`);
  }
  return out;
}

let engineCache = null;
export async function loadEngine(root = CHARTS_ROOT) {
  if (engineCache?.root === root) return engineCache;
  const script = await import(pathToFileURL(join(pkg(root, "script"), "dist", "index.js")).href);
  const ind = await import(pathToFileURL(join(pkg(root, "indicators"), "dist", "index.js")).href);
  const all = await import(pathToFileURL(join(pkg(root, "indicators"), "dist", "all.js")).href);
  all.registerAllStudies();
  const scriptPkg = JSON.parse(readFileSync(join(pkg(root, "script"), "package.json"), "utf8"));
  engineCache = {
    root,
    compile: script.compile,
    ScriptError: script.ScriptError,
    limits: script.DEFAULT_LIMITS,
    runStudy: ind.runStudy,
    StudyEngine: ind.StudyEngine,
    feedsOf: script.feedsOf,
    alignFor: script.alignFor,
    parseTimeframe: script.parseTimeframe,
    studies: ind.listStudies(),
    sourceNames: ind.SOURCE_NAMES,
    scriptVersion: scriptPkg.version,
  };
  return engineCache;
}

// ---- the language's tables, from source ------------------------------------------------------

/** The sources are TypeScript and the build bundles and renames them, so a table is transpiled here and loaded as written. */
async function loadSourceModule(root, file) {
  const js = ts.transpileModule(readFileSync(join(pkg(root, "script"), "src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('"@alphacharts/indicators/all"', JSON.stringify(pathToFileURL(join(pkg(root, "indicators"), "dist", "all.js")).href));
  const dir = mkdtempSync(join(tmpdir(), "ac-src-"));
  try {
    const f = join(dir, file.replace(/\.ts$/, ".mjs"));
    writeFileSync(f, js);
    return await import(pathToFileURL(f).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export const loadBuiltins = (root = CHARTS_ROOT) => loadSourceModule(root, "builtins.ts");
/** Words the lexer reserves: a `ta.<id>` whose id is one of them cannot be written. */
export async function loadReservedWords(root = CHARTS_ROOT) {
  const lx = await loadSourceModule(root, "lexer.ts");
  return new Set([...lx.KEYWORDS, ...Object.keys(lx.RESERVED)]);
}

// ---- every diagnostic the compiler and the runtime can emit ----------------------------------------

const shapeOf = (template) => template.replace(/\{[^{}]*\}/g, "{}");
const SITES = new Set(["err", "error", "warn", "fail", "ScriptError"]);
const FILES = ["lexer.ts", "parser.ts", "check.ts", "codegen.ts", "compile.ts", "diag.ts", "run.ts", "runner.ts", "sandbox.ts", "limits.ts", "feeds.ts"];

/**
 * Every message template in the language's source: the first argument of err/error/warn/fail/new ScriptError,
 * the `message` of a literal diagnostic, and the RESERVED table. `${x}` becomes `{x}` for a plain name and `{...}` otherwise.
 * Returns [{ template, file, line }] (unique by template) and the call sites it could not read.
 */
export function extractDiagnostics(root = CHARTS_ROOT) {
  const found = new Map();
  const unresolved = [];
  for (const name of FILES) {
    const file = join(pkg(root, "script"), "src", name);
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    // two messages that differ only in the name of a placeholder are one diagnostic
    const add = (template, node) => {
      const shape = shapeOf(template);
      if (!found.has(shape)) found.set(shape, { template, file: `packages/script/src/${name}`, line: lineOf(node) });
    };
    // `const x = <template>` bindings visible from a node, to inline `${where}`
    const consts = (node) => {
      const m = new Map();
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isBlock(p) || ts.isSourceFile(p)) for (const s of p.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && !m.has(d.name.text)) m.set(d.name.text, d.initializer);
      }
      return m;
    };
    const variants = (e, scope, depth = 0) => {
      // the possible texts of an expression; null when it is not a message
      if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) return variants(e.expression, scope, depth);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
      if (ts.isTemplateExpression(e)) {
        let outs = [e.head.text];
        for (const sp of e.templateSpans) {
          let opts;
          const x = sp.expression;
          const bound = ts.isIdentifier(x) ? scope.get(x.text) : undefined;
          if (bound && depth < 3 && (ts.isTemplateExpression(bound) || ts.isStringLiteral(bound))) opts = variants(bound, scope, depth + 1);
          else if (ts.isConditionalExpression(x) && variants(x, scope, depth + 1)?.every((v) => typeof v === "string") && isLiteralConditional(x)) opts = variants(x, scope, depth + 1);
          else {
            const t = x.getText(sf);
            opts = [/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t) ? `{${t}}` : "{...}"];
          }
          outs = outs.flatMap((o) => opts.map((p) => o + p + sp.literal.text));
        }
        return outs;
      }
      if (ts.isConditionalExpression(e)) {
        const a = variants(e.whenTrue, scope, depth), b = variants(e.whenFalse, scope, depth);
        return a && b ? [...a, ...b] : null;
      }
      return null;
    };
    const isLiteralConditional = (c) => [c.whenTrue, c.whenFalse].every((x) => ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) || (ts.isConditionalExpression(x) && isLiteralConditional(x)));
    const visit = (n) => {
      let callee = null, args = null;
      if (ts.isCallExpression(n)) {
        callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : null;
        args = n.arguments;
      } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
        callee = n.expression.text;
        args = n.arguments ?? [];
      }
      if (callee && SITES.has(callee) && args.length > 0 && !(ts.isNewExpression(n) && callee !== "ScriptError")) {
        const v = variants(args[0], consts(n));
        if (v) for (const t of v) add(t, n);
        else if (!(ts.isIdentifier(args[0]) && args[0].text === "message")) unresolved.push(`${name}:${lineOf(n)}: ${callee}(${args[0].getText(sf)})`);
      }
      // { message: "..." } literal diagnostics
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "message") {
        const v = variants(n.initializer, consts(n));
        if (v) for (const t of v) add(t, n);
      }
      // RESERVED: Object.fromEntries(Object.entries({ while: "...", ... }) ...)
      if (name === "lexer.ts" && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "RESERVED") {
        const walk = (x) => {
          if (ts.isObjectLiteralExpression(x)) for (const p of x.properties) if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) add(p.initializer.text, p);
          if (ts.isArrayLiteralExpression(x)) for (const el of x.elements) if (ts.isArrayLiteralExpression(el) && el.elements[1] && ts.isStringLiteral(el.elements[1])) add(el.elements[1].text, el);
          ts.forEachChild(x, walk);
        };
        walk(n.initializer);
      }
      // diag.ts rewrites the message of the (max+1)th error
      if (name === "diag.ts" && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === "message") {
        const v = variants(n.right, consts(n));
        if (v) for (const t of v) add(t, n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { diagnostics: [...found.values()], unresolved };
}

/** A regular expression that matches the messages a template produces. A placeholder may be empty unless it ends the template. */
export function templateRegex(template) {
  const parts = template.split(/\{[^{}]*\}/);
  const esc = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let re = "";
  esc.forEach((p, k) => {
    re += p;
    if (k < esc.length - 1) re += k === esc.length - 2 && esc[k + 1] === "" ? "[\\s\\S]+?" : "[\\s\\S]*?";
  });
  return new RegExp(`^${re}$`);
}
/** Literal characters in a template: the tie-break when a message matches several. */
export const specificity = (template) => template.replace(/\{[^{}]*\}/g, "").length;

/** The templates a message matches, most specific first. */
export function matchTemplates(message, templates) {
  return templates.filter((t) => templateRegex(t).test(message)).sort((a, b) => specificity(b) - specificity(a));
}

// ---- seeded bars ---------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic OHLCV: a random walk with intrabar ranges, 1-minute stamps in UTC milliseconds, positive integer volume. */
export function seededBars(n = 300, seed = 20260101) {
  const rnd = mulberry32(seed);
  const time = new Float64Array(n), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  let c = 1000;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = Math.round(o * (1 + (rnd() - 0.5) * 0.02) * 100) / 100;
    time[i] = 1767225600000 + i * 60000;
    open[i] = o;
    close[i] = c;
    high[i] = Math.round(Math.max(o, c) * (1 + rnd() * 0.004) * 100) / 100;
    low[i] = Math.round(Math.min(o, c) * (1 - rnd() * 0.004) * 100) / 100;
    volume[i] = 1000 + Math.floor(rnd() * 9000);
  }
  return { time, open, high, low, close, volume };
}

// ---- seeded outside series ---------------------------------------------------------------------------------
//
// A script that reads `outside(...)` is run on bars that span many days (a daily or weekly series needs days to
// close), with every series it reads generated here from its own symbol and timeframe. The reference join below is a
// plain loop over all bars, written from the rules in the skills and sharing no code with the engine's.

export const SESSIONS = { days: 40, perDay: 25, intervalMs: 15 * 60000, start: Date.UTC(2026, 0, 5, 3, 45) };
const DAY = 86400000;

const hashText = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

function walk(times, rnd, start, drop) {
  const keep = times.filter(() => drop === 0 || rnd() >= drop);
  const n = keep.length;
  const time = Float64Array.from(keep), open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n), volume = new Float64Array(n);
  let c = start;
  for (let i = 0; i < n; i++) {
    const o = c;
    c = Math.round(o * (1 + (rnd() - 0.5) * 0.03) * 100) / 100;
    open[i] = o;
    close[i] = c;
    high[i] = Math.round(Math.max(o, c) * (1 + rnd() * 0.01) * 100) / 100;
    low[i] = Math.round(Math.min(o, c) * (1 - rnd() * 0.01) * 100) / 100;
    volume[i] = 500 + Math.floor(rnd() * 5000);
  }
  return { time, open, high, low, close, volume };
}

/** The chart's bars for a script that reads outside series: 40 days of 25 bars of 15 minutes, the last bar of a day 9 hours before the next day's first. */
export function seededSessions() {
  const { days, perDay, intervalMs, start } = SESSIONS;
  const times = [];
  for (let d = 0; d < days; d++) for (let k = 0; k < perDay; k++) times.push(start + d * DAY + k * intervalMs);
  return { ...walk(times, mulberry32(20260102), 1000, 0), intervalMs };
}

/**
 * The bars of one outside series for the chart `main`: the same instrument's other timeframe (symbol null) or another
 * instrument (a seed from its text). Same timeframe: the chart's own times with about one bar in a hundred missing.
 * Longer: bars of that length on the clock from before the chart's first bar to past its last.
 */
export function seededOutside(symbol, timeframe, main) {
  const tf = timeframe === null ? main.intervalMs : parseTf(timeframe);
  const rnd = mulberry32(hashText(`${symbol ?? ""}\u0001${timeframe ?? ""}`));
  const first = main.time[0], last = main.time[main.time.length - 1];
  let times;
  if (tf === main.intervalMs) times = Array.from(main.time);
  else {
    times = [];
    // day/week bars start at midnight UTC (Monday for a week), shorter ones at the chart's first bar
    const origin = tf >= DAY ? Math.floor(first / DAY) * DAY - (tf >= 7 * DAY ? ((new Date(first).getUTCDay() + 6) % 7) * DAY : 0) : first;
    for (let t = origin - tf; t <= last + tf; t += tf) times.push(t);
  }
  return { ...walk(times, rnd, 50 + (hashText(symbol ?? "") % 200), tf === main.intervalMs && symbol !== null ? 0.01 : 0), tfMs: tf };
}

function parseTf(tf) {
  const m = /^([1-9][0-9]{0,2})([mhdw])$/.exec(tf);
  return Number(m[1]) * { m: 60000, h: 3600000, d: DAY, w: 7 * DAY }[m[2]];
}

/**
 * The join, by the rules the skills state, as a loop over every bar. Same length: the outside bar with exactly the
 * chart bar's time, else na. Longer: among the outside bars that have finished by the chart bar's time (open + length
 * <= that time) the one that opened last, else na.
 */
export function referenceJoin(feed, field, main) {
  return joinValues(feed, feed[field], main);
}

/** The same join for any values given on the outside series' own bars (something computed on them). */
export function joinValues(feed, values, main) {
  const out = [];
  for (let i = 0; i < main.time.length; i++) {
    const t = main.time[i];
    let best = -1;
    for (let j = 0; j < feed.time.length; j++) {
      if (feed.tfMs === main.intervalMs) {
        if (feed.time[j] === t) best = j;
      } else if (feed.time[j] + feed.tfMs <= t && (best < 0 || feed.time[j] > feed.time[best])) best = j;
    }
    out.push(best < 0 ? Number.NaN : values[best]);
  }
  return out;
}

/**
 * Run a compiled script that reads outside series on the seeded sessions. Returns the columns, and the context a
 * fixture receives: `outside(symbol, field, timeframe)` is the joined series by the reference join above.
 */
export function runWithOutside(engine, compiled, inputs) {
  const main = seededSessions();
  const feeds = new Map();
  for (const f of engine.feedsOf(compiled.plan.dependencies)) feeds.set(f.key, { ref: f, bars: seededOutside(f.symbol, f.timeframe, main) });
  const e = new engine.StudyEngine(compiled.study, inputs);
  for (const [key, { ref, bars }] of feeds) {
    const { align, spanMs } = engine.alignFor(ref.timeframe, main.intervalMs);
    e.setFeed(key, bars, { align, spanMs });
  }
  e.load(main);
  const ctx = {
    intervalMs: main.intervalMs,
    outside: (symbol = null, field = "close", timeframe = null) => referenceJoin(seededOutside(symbol, timeframe, main), field, main),
    /** The outside series' own bars: time, open, high, low, close, volume, tfMs. */
    feed: (symbol = null, timeframe = null) => seededOutside(symbol, timeframe, main),
    /** Values computed on an outside series' own bars (from `feed`), read on the chart's bars by the same join. */
    join: (feed, values) => joinValues(feed, values, main),
  };
  return { columns: e.outputs.map((c, k) => e.column(k).slice()), bars: main, ctx };
}
