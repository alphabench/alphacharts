// The language's built-in names: series, namespaces, constants, and the
// signatures of every callable. Lowering lives in codegen.ts; the checker uses
// only this table.

import { ALL_STUDIES } from "@alphacharts/indicators/all";
import type { InputDef, StudyDef } from "@alphacharts/indicators";
import type { Ty } from "./ast.js";

export const FLOAT_S: Ty = { b: "float", q: "series" };
export const INT_S: Ty = { b: "int", q: "series" };
export const BOOL_S: Ty = { b: "bool", q: "series" };
export const t = (b: Ty["b"], q: Ty["q"] = "const"): Ty => ({ b, q });
export const tuple = (elems: Ty[]): Ty => ({ b: "tuple", q: "series", elems });

/** Tables indexed by names from a script have no prototype: "__proto__" and "constructor" are not entries. */
function nullProto<T extends object>(o: T): T {
  return Object.assign(Object.create(null) as T, o);
}

export const NAMESPACES: ReadonlySet<string> = new Set(["ta", "math", "color", "input", "plot", "shape", "location", "hline", "str"]);

/** Series available everywhere. `needs` is what the study must be given. */
export const BUILTIN_SERIES: Readonly<Record<string, { ty: Ty; needs: "value" | "ohlc" | "ohlcv" }>> = nullProto({
  close: { ty: FLOAT_S, needs: "value" },
  open: { ty: FLOAT_S, needs: "ohlc" },
  high: { ty: FLOAT_S, needs: "ohlc" },
  low: { ty: FLOAT_S, needs: "ohlc" },
  hl2: { ty: FLOAT_S, needs: "ohlc" },
  hlc3: { ty: FLOAT_S, needs: "ohlc" },
  ohlc4: { ty: FLOAT_S, needs: "ohlc" },
  hlcc4: { ty: FLOAT_S, needs: "ohlc" },
  volume: { ty: FLOAT_S, needs: "ohlcv" },
  time: { ty: FLOAT_S, needs: "value" },
  bar_index: { ty: INT_S, needs: "value" },
});

export const COLORS: Readonly<Record<string, string>> = {
  aqua: "#00bcd4", black: "#000000", blue: "#2962ff", fuchsia: "#e040fb", gray: "#787b86", green: "#4caf50", lime: "#00e676",
  maroon: "#880e4f", navy: "#311b92", olive: "#808000", orange: "#ff9800", purple: "#9c27b0", red: "#f23645", silver: "#b2b5be",
  teal: "#089981", white: "#ffffff", yellow: "#fdd835",
};

/** Constants reachable as `namespace.name`. */
export const MEMBER_CONSTS: Readonly<Record<string, { ty: Ty; value: number | string }>> = nullProto({
  "math.pi": { ty: t("float"), value: Math.PI },
  "math.e": { ty: t("float"), value: Math.E },
  ...Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [`color.${k}`, { ty: t("color"), value: v }])),
  "plot.style_line": { ty: t("string"), value: "line" },
  "plot.style_histogram": { ty: t("string"), value: "histogram" },
  "plot.style_area": { ty: t("string"), value: "area" },
  "hline.style_solid": { ty: t("string"), value: "solid" },
  "hline.style_dashed": { ty: t("string"), value: "dashed" },
  "hline.style_dotted": { ty: t("string"), value: "dotted" },
  "shape.circle": { ty: t("string"), value: "circle" },
  "shape.square": { ty: t("string"), value: "square" },
  "shape.diamond": { ty: t("string"), value: "diamond" },
  "shape.triangleup": { ty: t("string"), value: "triangleUp" },
  "shape.triangledown": { ty: t("string"), value: "triangleDown" },
  "shape.arrowup": { ty: t("string"), value: "arrowUp" },
  "shape.arrowdown": { ty: t("string"), value: "arrowDown" },
  "shape.xcross": { ty: t("string"), value: "cross" },
  "shape.cross": { ty: t("string"), value: "cross" },
  "location.abovebar": { ty: t("string"), value: "above" },
  "location.belowbar": { ty: t("string"), value: "below" },
  "location.absolute": { ty: t("string"), value: "value" },
});
const enumOf = (ns: string): string[] => Object.keys(MEMBER_CONSTS).filter((k) => k.startsWith(`${ns}.`)).map((k) => MEMBER_CONSTS[k]!.value as string);
export const ENUMS = {
  plotStyle: enumOf("plot"),
  lineStyle: enumOf("hline"),
  shape: enumOf("shape"),
  location: enumOf("location"),
};

// ---- signatures -----------------------------------------------------------------

/**
 * series: a numeric (or bool) series, any qualifier. num/int/bool/string/color: simple values (const or input).
 * `enum`: one of a set, written as the namespace constant. strlist: an array literal of string literals.
 */
export type PKind = "series" | "num" | "int" | "bool" | "string" | "color" | "enum" | "strlist" | "plot" | "any";

export interface Param {
  name: string;
  kind: PKind;
  opt?: boolean;
  /** For "enum". */
  oneOf?: readonly string[];
  /** For "int"/"num": bounds checked when the argument is a literal; checked again at build otherwise. */
  min?: number;
  max?: number;
  /** For generic study inputs: the input this parameter feeds. */
  input?: InputDef;
}

export interface Sig {
  /** Fully qualified name: "ta.sma", "nz". */
  name: string;
  params: Param[];
  ret: Ty;
  /** What the study must be given for this call to work. */
  needs?: "value" | "ohlc" | "ohlcv";
  /** Kind of lowering. */
  op: "scalar" | "kernel" | "study" | "special";
  /** Scalar math: elementwise. */
  fn?: (...a: number[]) => number;
  /** Generic study: the definition and the order of its non-source inputs. */
  study?: StudyDef;
}

const S = (name: string): Param => ({ name, kind: "series" });
const SO = (name: string): Param => ({ name, kind: "series", opt: true });
const N = (name: string, o: Partial<Param> = {}): Param => ({ name, kind: "num", ...o });
const I = (name: string, o: Partial<Param> = {}): Param => ({ name, kind: "int", ...o });
const LEN: Param = I("length", { min: 1, max: 5000 });

export const SIGS: Map<string, Sig> = new Map();
const add = (name: string, params: Param[], ret: Ty, op: Sig["op"], extra: Partial<Sig> = {}) => SIGS.set(name, { name, params, ret, op, ...extra });
const num = (x: number) => (Number.isFinite(x) ? x : Number.NaN);

// math.*: elementwise; a non-finite result is na (never an Infinity on a chart)
const m1 = (name: string, f: (x: number) => number) => add(`math.${name}`, [S("x")], FLOAT_S, "scalar", { fn: (x) => num(f(x)) });
for (const [k, f] of Object.entries({ abs: Math.abs, sqrt: Math.sqrt, log: Math.log, log10: Math.log10, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, ceil: Math.ceil, floor: Math.floor, trunc: Math.trunc, sign: Math.sign, round: Math.round, toradians: (x: number) => (x * Math.PI) / 180, todegrees: (x: number) => (x * 180) / Math.PI })) m1(k, f);
add("math.pow", [S("base"), S("exponent")], FLOAT_S, "scalar", { fn: (a, b) => num(a ** b) });
add("math.max", [S("a"), S("b")], FLOAT_S, "scalar", { fn: (a, b) => (a !== a || b !== b ? Number.NaN : a > b ? a : b) });
add("math.min", [S("a"), S("b")], FLOAT_S, "scalar", { fn: (a, b) => (a !== a || b !== b ? Number.NaN : a < b ? a : b) });
add("math.avg", [S("a"), S("b")], FLOAT_S, "scalar", { fn: (a, b) => (a + b) / 2 });
add("nz", [S("x"), { name: "replacement", kind: "series", opt: true }], FLOAT_S, "special");
add("na", [S("x")], BOOL_S, "special");
add("math.sum", [S("source"), LEN], FLOAT_S, "kernel");

// ta.* kernels on the graph
for (const k of ["sma", "ema", "wma", "rma", "highest", "lowest", "stdev", "variance", "sum"]) add(`ta.${k}`, [S("source"), LEN], FLOAT_S, "kernel");
// bars since the extreme: a whole number (or na until the window is full), so it types int and can be an offset or an int variable's value
for (const k of ["highestbars", "lowestbars"]) add(`ta.${k}`, [S("source"), LEN], INT_S, "kernel");
// a line through one point is undefined: the least length is 2
add("ta.linreg", [S("source"), I("length", { min: 2, max: 5000 })], FLOAT_S, "kernel");
add("ta.atr", [LEN], FLOAT_S, "kernel", { needs: "ohlc" });
add("ta.change", [S("source"), I("length", { opt: true, min: 1, max: 5000 })], FLOAT_S, "special");
for (const k of ["crossover", "crossunder", "cross"]) add(`ta.${k}`, [S("a"), S("b")], BOOL_S, "special");
add("ta.bb", [S("source"), I("length", { min: 1, max: 5000 }), N("mult", { min: 0, max: 100 })], tuple([FLOAT_S, FLOAT_S, FLOAT_S]), "special");

export const TA_TR: Ty = FLOAT_S;

// every other built-in study as ta.<id>(source?, ...inputs)
function studyParam(i: InputDef): Param {
  switch (i.type) {
    case "int": return { name: i.key, kind: "int", opt: true, ...(i.min !== undefined && { min: i.min }), ...(i.max !== undefined && { max: i.max }), input: i };
    case "float": return { name: i.key, kind: "num", opt: true, ...(i.min !== undefined && { min: i.min }), ...(i.max !== undefined && { max: i.max }), input: i };
    case "bool": return { name: i.key, kind: "bool", opt: true, input: i };
    case "source": return { name: i.key, kind: "series", opt: true, input: i };
    case "select": return { name: i.key, kind: "string", opt: true, input: i, ...(i.options && { oneOf: i.options }) };
  }
}
export const studyFnName = (id: string): string => `ta.${id.replace(/-/g, "_")}`;
for (const def of ALL_STUDIES) {
  if (def.family === "math") continue;
  const name = studyFnName(def.id);
  if (SIGS.has(name)) continue;
  // The `source` input, when there is one, is the first parameter; the others follow in the study's order.
  const params = [...def.inputs.filter((i) => i.key === "source"), ...def.inputs.filter((i) => i.key !== "source")].map(studyParam);
  const ret = def.columns.length === 1 ? FLOAT_S : tuple(def.columns.map(() => FLOAT_S));
  add(name, params, ret, "study", { study: def, needs: def.needs });
}

// ---- plotting and declarations ---------------------------------------------------------

add("indicator", [{ name: "title", kind: "string" }, { name: "shorttitle", kind: "string", opt: true }, { name: "overlay", kind: "bool", opt: true }], t("void"), "special");
add("plot", [S("series"), { name: "title", kind: "string", opt: true }, { name: "color", kind: "color", opt: true }, I("linewidth", { opt: true, min: 1, max: 8 }), { name: "style", kind: "enum", oneOf: ENUMS.plotStyle, opt: true }, I("offset", { opt: true, min: -5000, max: 5000 }), { name: "color_down", kind: "color", opt: true }], t("plot"), "special");
add("hline", [N("price"), { name: "title", kind: "string", opt: true }, { name: "color", kind: "color", opt: true }, { name: "linestyle", kind: "enum", oneOf: ENUMS.lineStyle, opt: true }], t("void"), "special");
add("fill", [{ name: "plot1", kind: "plot" }, { name: "plot2", kind: "plot" }, { name: "color", kind: "color", opt: true }, { name: "title", kind: "string", opt: true }], t("void"), "special");
add("plotshape", [{ name: "series", kind: "any" }, { name: "title", kind: "string", opt: true }, { name: "style", kind: "enum", oneOf: ENUMS.shape, opt: true }, { name: "location", kind: "enum", oneOf: ENUMS.location, opt: true }, { name: "color", kind: "color", opt: true }, I("offset", { opt: true, min: -5000, max: 5000 })], t("void"), "special");
add("color.new", [{ name: "color", kind: "color" }, N("transp", { min: 0, max: 100 })], t("color"), "special");

// inputs: `name = input.x(defval, title, ...)` — the whole right-hand side of a top-level declaration
add("input.int", [I("defval"), { name: "title", kind: "string", opt: true }, I("minval", { opt: true }), I("maxval", { opt: true }), I("step", { opt: true })], t("int", "input"), "special");
add("input.float", [N("defval"), { name: "title", kind: "string", opt: true }, N("minval", { opt: true }), N("maxval", { opt: true }), N("step", { opt: true })], t("float", "input"), "special");
add("input.bool", [{ name: "defval", kind: "bool" }, { name: "title", kind: "string", opt: true }], t("bool", "input"), "special");
add("input.string", [{ name: "defval", kind: "string" }, { name: "title", kind: "string", opt: true }, { name: "options", kind: "strlist" }], t("string", "input"), "special");
add("input.source", [{ name: "defval", kind: "any" }, { name: "title", kind: "string", opt: true }], FLOAT_S, "special");
add("input.color", [{ name: "defval", kind: "color" }, { name: "title", kind: "string", opt: true }], t("color", "input"), "special");

/** Names the editor can offer: every callable, every constant, the series and the keywords. */
export function completionNames(): { label: string; kind: "function" | "constant" | "variable" | "keyword" | "namespace"; detail?: string }[] {
  const out: { label: string; kind: "function" | "constant" | "variable" | "keyword" | "namespace"; detail?: string }[] = [];
  for (const s of SIGS.values()) out.push({ label: s.name, kind: "function", detail: `(${s.params.map((p) => (p.opt ? `${p.name}?` : p.name)).join(", ")})` });
  for (const k of Object.keys(MEMBER_CONSTS)) out.push({ label: k, kind: "constant" });
  for (const k of Object.keys(BUILTIN_SERIES)) out.push({ label: k, kind: "variable" });
  out.push({ label: "ta.tr", kind: "variable" }, { label: "na", kind: "constant" });
  for (const k of NAMESPACES) out.push({ label: k, kind: "namespace" });
  return out;
}
