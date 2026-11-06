// Type checker: resolves names, types every expression (int/float/bool/string/color
// with the qualifiers const < input < series), checks calls against the signature
// table, and extracts the script's plan: its inputs, its plots and the program.
//
// Nothing is coerced silently: a number is never a condition, a bool is never a
// number, an int never silently narrows from a float, `na` needs a declared type.
//
// "State": a top-level variable declared with `var` or assigned with := (and what
// depends on it), block locals and loop counters change while one bar is being
// evaluated. Everything else is "pure": it is a function of the bars and the
// inputs, so it is computed as whole columns by the same kernels the built-in
// studies use. ta.* calls only take pure arguments.

import type { Arg, Assign, Call, Expr, For, If, Program, Stmt, Sym, Ty, VarDecl } from "./ast.js";
import type { Reporter, Span } from "./diag.js";
import { BOOL_S, BUILTIN_SERIES, ENUMS, FLOAT_S, INT_S, MEMBER_CONSTS, NAMESPACES, SIGS, t, TA_TR, type Param, type Sig } from "./builtins.js";
import { DEFAULT_LIMITS, MAX_HISTORY } from "./limits.js";
import { SOURCE_NAMES } from "@alphacharts/indicators";

export type ColorRef = { value: string } | { input: string };

export interface InputSpec {
  key: string;
  kind: "int" | "float" | "bool" | "string" | "source" | "color";
  label: string;
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  span: Span;
}

export interface PlotSpec {
  kind: "line" | "histogram" | "area" | "hline" | "fill" | "markers";
  key: string;
  title: string;
  color: ColorRef;
  colorDown?: string;
  width?: number;
  lineStyle?: string;
  offset?: number;
  /** Series plotted (line/histogram/area/markers) or the price of an hline. */
  expr?: Expr;
  /** fill: indexes into the plots. */
  a?: number;
  b?: number;
  shape?: string;
  position?: string;
  span: Span;
}

export interface Plan {
  title: string;
  overlay: boolean;
  inputs: InputSpec[];
  plots: PlotSpec[];
  body: Stmt[];
  needs: "value" | "ohlc" | "ohlcv";
  /** Frame size of the per-bar program. */
  slots: number;
  /** Top-level variables kept in columns by the per-bar program, in declaration order. */
  stateVars: Sym[];
}

const ERR: Ty = { b: "na", q: "const" };
const NEEDS_RANK = { value: 0, ohlc: 1, ohlcv: 2 } as const;
const QRANK = { const: 0, input: 1, series: 2 } as const;
const qmax = (...q: Ty["q"][]): Ty["q"] => q.reduce((a, b) => (QRANK[b] > QRANK[a] ? b : a), "const" as Ty["q"]);
const isNum = (x: Ty) => x.b === "int" || x.b === "float" || x.b === "na";
const simple = (x: Ty) => x.q !== "series";
const show = (x: Ty): string => (x === ERR ? "na" : x.b === "tuple" ? `a tuple of ${x.elems!.length} values (destructure it: [a, b] = ...)` : `${simple(x) && x.b !== "na" ? "" : x.b === "na" ? "" : "series "}${x.b}`);

class Scope {
  readonly names = new Map<string, Sym>();
  constructor(readonly parent: Scope | null) {}
  find(name: string): Sym | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const v = s.names.get(name);
      if (v) return v;
    }
    return undefined;
  }
}

function collectAssigned(body: Stmt[], out: Set<string>): void {
  for (const s of body) {
    if (s.k === "assign") out.add(s.name);
    else if (s.k === "if") { collectAssigned(s.then, out); if (s.else) collectAssigned(s.else, out); }
    else if (s.k === "for") collectAssigned(s.body, out);
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

class Checker {
  readonly plan: Plan = { title: "Script", overlay: false, inputs: [], plots: [], body: [], needs: "value", slots: 0, stateVars: [] };
  private scope = new Scope(null);
  private assigned = new Set<string>();
  private depth = 0;
  private sawIndicator = false;
  private readonly keys = new Set<string>();
  private loops = 0;

  constructor(private readonly rep: Reporter, private readonly limits = DEFAULT_LIMITS) {}

  private err(msg: string, span: Span): void { this.rep.error(msg, span); }

  private need(n: "value" | "ohlc" | "ohlcv"): void {
    if (NEEDS_RANK[n] > NEEDS_RANK[this.plan.needs]) this.plan.needs = n;
  }

  run(prog: Program): Plan {
    collectAssigned(prog.body, this.assigned);
    for (const s of prog.body) this.stmt(s, true);
    this.plan.body = prog.body;
    return this.plan;
  }

  // ---- statements -----------------------------------------------------------------

  private declare(name: string, sym: Sym, span: Span): void {
    if (this.scope.find(name)) { this.err(`"${name}" is already declared`, span); return; }
    if (Object.prototype.hasOwnProperty.call(BUILTIN_SERIES, name) || NAMESPACES.has(name) || name === "na" || name === "nz" || SIGS.has(name)) {
      this.err(`"${name}" is a built-in name and cannot be redeclared`, span);
      return;
    }
    sym.decl = span;
    this.scope.names.set(name, sym);
  }

  private slot(): number { return this.plan.slots++; }

  private stmt(s: Stmt, top: boolean): void {
    switch (s.k) {
      case "decl": return this.decl(s, top);
      case "tuple": return this.tupleDecl(s, top);
      case "assign": return this.assign(s);
      case "if": return this.ifStmt(s);
      case "for": return this.forStmt(s);
      case "expr": {
        const c = s.expr as Call;
        this.call(c, top ? "stmt" : "expr-block");
        return;
      }
    }
  }

  private decl(s: VarDecl, top: boolean): void {
    if (s.isVar && !top) this.err("'var' is only allowed at the top level of the script", s);
    // input.* is the whole right-hand side
    if (s.init.k === "call" && this.calleeName(s.init) !== null && this.calleeName(s.init)!.startsWith("input.")) {
      if (!top || s.isVar) { this.err("input.* may only declare a top-level variable", s.init); this.skipInputArgs(s.init); return; }
      this.inputDecl(s);
      return;
    }
    const isPlot = s.init.k === "call" && this.calleeName(s.init) === "plot";
    if (isPlot) {
      if (!top) { this.err("plot() is only allowed at the top level of the script", s.init); return; }
      if (s.isVar || s.type) this.err("a plot handle cannot be declared var or typed", s);
      this.call(s.init as Call, "decl");
      const sym: Sym = { name: s.name, kind: "plot", ty: t("plot"), key: String(this.plan.plots.length - 1) };
      this.declare(s.name, sym, s.nameSpan);
      s.sym = sym;
      return;
    }
    const ity = this.expr(s.init);
    let ty = ity;
    if (ity.b === "void") { this.err("this expression has no value", s.init); ty = ERR; }
    if (ity.b === "plot") { this.err("a plot handle can only come from plot()", s.init); ty = ERR; }
    if (ity.b === "tuple") { this.err(`this call returns ${ity.elems!.length} values; destructure them: [a, b, ...] = ...`, s.init); ty = ERR; }
    if (s.type) {
      const want = t(s.type as Ty["b"], "const");
      if (ty !== ERR && !this.assignable(want, ty)) {
        if (want.b === "int" && ty.b === "float") {
          const fix = ` (declare it float: float ${s.name} = 0.0, or var float ${s.name} = 0.0; there is no int() conversion)`
          this.err(`cannot assign ${show(ty)} to ${s.type} "${s.name}"${fix}`, s.init)
        } else this.err(`cannot assign ${show(ty)} to ${s.type} "${s.name}"`, s.init)
      }
      ty = { b: want.b, q: ty === ERR ? "series" : ty.q };
    } else if (ty.b === "na" && ty !== ERR) {
      this.err(`cannot infer the type of "${s.name}" from na; declare it, e.g. float ${s.name} = na`, s.init);
      ty = ERR;
    }
    const mutable = this.assigned.has(s.name);
    if (top) {
      const state = s.isVar || mutable || !!s.init.st;
      if (state) {
        const sym: Sym = { name: s.name, kind: "state", ty: { b: ty.b, q: "series" }, isVar: s.isVar, slot: this.slot() };
        this.declare(s.name, sym, s.nameSpan);
        s.sym = sym;
        this.plan.stateVars.push(sym);
      } else {
        const sym: Sym = { name: s.name, kind: simple(ty) ? "simple" : "pure", ty };
        this.declare(s.name, sym, s.nameSpan);
        s.sym = sym;
      }
    } else {
      const sym: Sym = { name: s.name, kind: "local", ty: { b: ty.b, q: "series" }, slot: this.slot() };
      this.declare(s.name, sym, s.nameSpan);
      s.sym = sym;
    }
  }

  private tupleDecl(s: import("./ast.js").TupleDecl, top: boolean): void {
    if (!top) { this.err("destructuring is only allowed at the top level of the script", s); return; }
    const ty = this.expr(s.init);
    s.syms = [];
    if (ty === ERR) { for (const n of s.names) this.declare(n.name, { name: n.name, kind: "pure", ty: FLOAT_S }, n.span); return; }
    if (ty.b !== "tuple") { this.err("only calls that return several values can be destructured", s.init); for (const n of s.names) this.declare(n.name, { name: n.name, kind: "pure", ty: FLOAT_S }, n.span); return; }
    if (ty.elems!.length !== s.names.length) this.err(`this call returns ${ty.elems!.length} values, ${s.names.length} names given`, s);
    s.names.forEach((n, i) => {
      if (this.assigned.has(n.name)) this.err(`"${n.name}" is destructured from a call and cannot be assigned with :=`, n.span);
      const sym: Sym = { name: n.name, kind: "pure", ty: ty.elems![i] ?? FLOAT_S };
      this.declare(n.name, sym, n.span);
      s.syms!.push(sym);
    });
  }

  private assign(s: Assign): void {
    const sym = this.scope.find(s.name);
    const vt = this.expr(s.value);
    if (!sym) { this.err(`"${s.name}" is not declared; declare it first with ${s.name} = ...`, s.nameSpan); return; }
    s.sym = sym;
    if (sym.kind !== "state" && sym.kind !== "local") {
      const why = sym.kind === "loop" ? "a loop counter" : sym.kind === "input" ? "an input" : sym.kind === "builtin" ? "a built-in series" : "not assignable here";
      this.err(`cannot assign to "${s.name}": it is ${why}`, s.nameSpan);
      return;
    }
    if (vt === ERR) return;
    let want = vt;
    if (s.op !== ":=") {
      if (!isNum(sym.ty) || !isNum(vt)) { this.err(`"${s.op}" needs numbers, got ${show(sym.ty)} and ${show(vt)}`, s); return; }
      want = { b: sym.ty.b === "int" && vt.b === "int" && s.op !== "/=" ? "int" : "float", q: "series" };
    }
    if (!this.assignable(sym.ty, want)) {
      if (sym.ty.b === "int" && want.b === "float") {
        const fix = ` (declare it float: float ${s.name} = 0.0, or var float ${s.name} = 0.0; there is no int() conversion)`
        this.err(`cannot assign ${show(want)} to ${sym.ty.b} "${s.name}"${fix}`, s.value)
      } else this.err(`cannot assign ${show(want)} to ${sym.ty.b} "${s.name}"`, s.value)
    }
  }

  private ifStmt(s: If): void {
    const ct = this.expr(s.cond);
    if (ct !== ERR && ct.b !== "bool") this.err(`the condition of if must be bool, got ${show(ct)}`, s.cond);
    this.block(s.then);
    if (s.else) this.block(s.else);
  }

  private block(body: Stmt[]): void {
    const saved = this.scope;
    this.scope = new Scope(saved);
    this.depth++;
    for (const b of body) this.stmt(b, false);
    this.depth--;
    this.scope = saved;
  }

  private forStmt(s: For): void {
    const a = this.expr(s.lo), b = this.expr(s.hi), c = s.by ? this.expr(s.by) : null;
    for (const [x, e] of [[a, s.lo], [b, s.hi], [c, s.by]] as const) {
      if (x && x !== ERR && x.b !== "int") this.err(`a loop bound must be an int, got ${show(x)}`, e!);
    }
    const lit = (e: Expr | null): number | undefined => (e === null ? 1 : e.k === "num" ? e.value : e.k === "un" && e.op === "-" && e.x.k === "num" ? -e.x.value : undefined);
    const lo = lit(s.lo), hi = lit(s.hi), by = lit(s.by);
    if (by === 0) this.err("the loop step cannot be 0", s.by!);
    if (lo !== undefined && hi !== undefined && by !== undefined && by !== 0) {
      const step = s.by ? Math.abs(by) : 1;
      const trips = Math.floor(Math.abs(hi - lo) / step) + 1;
      if (trips > this.limits.maxLoopIterations) this.err(`this loop runs ${trips} times; the limit is ${this.limits.maxLoopIterations} iterations per loop`, s);
    }
    this.loops++;
    const saved = this.scope;
    this.scope = new Scope(saved);
    const sym: Sym = { name: s.name, kind: "loop", ty: { b: "int", q: "series" }, slot: this.slot() };
    this.declare(s.name, sym, s.nameSpan);
    s.sym = sym;
    this.depth++;
    for (const b2 of s.body) this.stmt(b2, false);
    this.depth--;
    this.scope = saved;
  }

  // ---- expressions ----------------------------------------------------------------

  private assignable(to: Ty, from: Ty): boolean {
    if (from === ERR || to === ERR) return true;
    if (from.b === "na") return true;
    if (to.b === from.b) return true;
    return to.b === "float" && from.b === "int";
  }

  expr(e: Expr): Ty {
    const ty = this.expr_(e);
    e.ty = ty;
    return ty;
  }

  private expr_(e: Expr): Ty {
    switch (e.k) {
      case "num": return t(e.float || !Number.isInteger(e.value) ? "float" : "int");
      case "str": return t("string");
      case "bool": return t("bool");
      case "color": return t("color");
      case "arr": this.err("array values are only allowed as options=[...] of input.string", e); return ERR;
      case "id": return this.ident(e);
      case "mem": return this.member(e);
      case "un": return this.unary(e);
      case "bin": return this.binary(e);
      case "tern": return this.ternary(e);
      case "idx": return this.index(e);
      case "call": return this.call(e, "expr");
    }
  }

  private ident(e: Extract<Expr, { k: "id" }>): Ty {
    const sym = this.scope.find(e.name);
    if (sym) {
      e.sym = sym;
      if (sym.kind === "state" || sym.kind === "local" || sym.kind === "loop") e.st = true;
      return sym.ty;
    }
    const b = BUILTIN_SERIES[e.name];
    if (b) {
      this.need(b.needs);
      e.sym = { name: e.name, kind: "builtin", ty: b.ty, key: e.name };
      return b.ty;
    }
    if (e.name === "na") return t("na");
    if (NAMESPACES.has(e.name)) { this.err(`"${e.name}" is a namespace; use ${e.name}.<name>`, e); return ERR; }
    if (SIGS.has(e.name)) { this.err(`"${e.name}" is a function; call it: ${e.name}(...)`, e); return ERR; }
    this.err(`unknown name "${e.name}"`, e);
    return ERR;
  }

  private member(e: Extract<Expr, { k: "mem" }>): Ty {
    if (e.obj.k !== "id" || !NAMESPACES.has(e.obj.name) || this.scope.find(e.obj.name)) {
      this.err("only namespace names can be followed by '.'", e);
      return ERR;
    }
    const full = `${e.obj.name}.${e.name}`;
    const c = MEMBER_CONSTS[full];
    if (c) { e.cv = c.value; return c.ty; }
    if (full === "ta.tr") { this.need("ohlc"); return TA_TR; }
    if (SIGS.has(full)) { this.err(`"${full}" is a function; call it: ${full}(...)`, e); return ERR; }
    this.err(`unknown name "${full}"`, e.nameSpan);
    return ERR;
  }

  private unary(e: Extract<Expr, { k: "un" }>): Ty {
    const x = this.expr(e.x);
    e.st = e.x.st ?? false;
    if (x === ERR) return ERR;
    if (e.op === "not") {
      if (x.b !== "bool") { this.err(`"not" needs a bool, got ${show(x)}`, e); return ERR; }
      return x;
    }
    if (!isNum(x)) { this.err(`unary "${e.op}" needs a number, got ${show(x)}`, e); return ERR; }
    return x.b === "na" ? { b: "float", q: x.q } : x;
  }

  private binary(e: Extract<Expr, { k: "bin" }>): Ty {
    const a = this.expr(e.a), b = this.expr(e.b);
    e.st = !!(e.a.st || e.b.st);
    if (a === ERR || b === ERR) return ERR;
    const q = qmax(a.q, b.q);
    switch (e.op) {
      case "and": case "or":
        if (a.b !== "bool" || b.b !== "bool") { this.err(`"${e.op}" needs bool operands, got ${show(a)} and ${show(b)}`, e); return ERR; }
        return { b: "bool", q };
      case "==": case "!=": {
        const ok = (isNum(a) && isNum(b)) || (a.b === b.b && (a.b === "bool" || a.b === "string" || a.b === "color"));
        if (!ok) { this.err(`cannot compare ${show(a)} with ${show(b)}`, e); return ERR; }
        if ((a.b === "string" || a.b === "color") && q === "series") { this.err("strings and colors can only be compared as constants or inputs", e); return ERR; }
        return { b: "bool", q };
      }
      case "<": case "<=": case ">": case ">=":
        if (!isNum(a) || !isNum(b)) { this.err(`"${e.op}" needs numbers, got ${show(a)} and ${show(b)}`, e); return ERR; }
        return { b: "bool", q };
      default: {
        if (!isNum(a) || !isNum(b)) { this.err(`"${e.op}" needs numbers, got ${show(a)} and ${show(b)}${a.b === "bool" || b.b === "bool" ? " (a bool is not a number: use a ternary)" : ""}`, e); return ERR; }
        const isInt = a.b === "int" && b.b === "int" && e.op !== "/";
        return { b: isInt ? "int" : "float", q };
      }
    }
  }

  private ternary(e: Extract<Expr, { k: "tern" }>): Ty {
    const c = this.expr(e.c), a = this.expr(e.a), b = this.expr(e.b);
    e.st = !!(e.c.st || e.a.st || e.b.st);
    if (c !== ERR && c.b !== "bool") this.err(`the condition of ?: must be bool, got ${show(c)}`, e.c);
    if (a === ERR || b === ERR) return ERR;
    const q = qmax(c === ERR ? "const" : c.q, a.q, b.q);
    if (a.b === "na") return { b: b.b, q };
    if (b.b === "na") return { b: a.b, q };
    if (isNum(a) && isNum(b)) return { b: a.b === "int" && b.b === "int" ? "int" : "float", q };
    if (a.b === "string" && b.b === "string" && q === "series") {
      this.err("a string cannot depend on a series: the condition of ?: must be a constant or an input (a string is a label, not a value that changes per bar)", e);
      return ERR;
    }
    if (a.b === b.b) return { b: a.b, q };
    this.err(`the branches of ?: have different types: ${show(a)} and ${show(b)}`, e);
    return ERR;
  }

  /** Whether `x[n]` / ta.change(x) can read x's earlier values. */
  private historyOk(x: Expr): boolean {
    return !x.st || (x.k === "id" && x.sym?.kind === "state");
  }

  private index(e: Extract<Expr, { k: "idx" }>): Ty {
    const x = this.expr(e.x), i = this.expr(e.i);
    e.st = !!(e.x.st || e.i.st);
    if (x === ERR || i === ERR) return ERR;
    if (x.q !== "series" || !(isNum(x) || x.b === "bool")) { this.err(`only a series can be indexed with [ ], this is ${show(x)}`, e.x); return ERR; }
    if (i.b !== "int") { this.err(`the history offset must be an int, got ${show(i)}`, e.i); return ERR; }
    if (!this.historyOk(e.x)) {
      this.err("history [ ] needs a plain series or a top-level variable; a block variable, loop counter or an expression of those has no earlier values. Assign the value to a top-level variable first", e.x);
      return ERR;
    }
    const c = e.i.k === "num" ? e.i.value : e.i.k === "un" && e.i.op === "-" && e.i.x.k === "num" ? -e.i.x.value : undefined;
    if (c !== undefined && (c < 0 || c > MAX_HISTORY)) this.err(`the history offset must be between 0 and ${MAX_HISTORY}, got ${c}`, e.i);
    return { b: x.b, q: "series" };
  }

  // ---- calls ------------------------------------------------------------------------

  private calleeName(c: Call): string | null {
    if (c.callee.k === "id") return c.callee.name;
    if (c.callee.k === "mem" && c.callee.obj.k === "id") return `${c.callee.obj.name}.${c.callee.name}`;
    return null;
  }

  private skipInputArgs(c: Call): void {
    for (const a of c.args) this.expr(a.value);
  }

  private bind(sig: Sig, c: Call): (Expr | null)[] {
    const out: (Expr | null)[] = sig.params.map(() => null);
    let pos = 0;
    let named = false;
    for (const a of c.args) {
      if (a.name === null) {
        if (named) { this.err("positional arguments must come before named ones", a.value); continue; }
        if (pos >= sig.params.length) { this.err(`${sig.name} takes at most ${sig.params.length} argument${sig.params.length === 1 ? "" : "s"}, got ${c.args.length}`, a.value); return out; }
        out[pos++] = a.value;
      } else {
        named = true;
        const k = sig.params.findIndex((p) => p.name === a.name);
        if (k < 0) { this.err(`${sig.name} has no parameter "${a.name}" (parameters: ${sig.params.map((p) => p.name).join(", ") || "none"})`, a.nameSpan ?? a.value); continue; }
        if (out[k]) { this.err(`parameter "${a.name}" is given twice`, a.nameSpan ?? a.value); continue; }
        out[k] = a.value;
      }
    }
    sig.params.forEach((p, k) => {
      if (!p.opt && !out[k] && !(p.kind === "series" && false)) this.err(`${sig.name} needs the argument "${p.name}"`, c);
    });
    return out;
  }

  /** The value of a literal-like expression known at compile time. */
  constVal(e: Expr): number | string | boolean | undefined {
    switch (e.k) {
      case "num": return e.value;
      case "str": return e.value;
      case "bool": return e.value;
      case "color": return e.value;
      case "mem": return e.cv;
      case "un": if (e.op === "-" && e.x.k === "num") return -e.x.value; return undefined;
      default: return undefined;
    }
  }

  private checkParam(sig: Sig, p: Param, e: Expr): void {
    const ty = e.ty ?? this.expr(e);
    if (ty === ERR) return;
    const where = `argument "${p.name}" of ${sig.name}`;
    const needSimple = () => {
      if (!simple(ty)) this.err(`${where} must be a literal or an input, not a series value`, e);
    };
    switch (p.kind) {
      case "series":
        if (!isNum(ty)) this.err(`${where} must be a number series, got ${show(ty)}`, e);
        break;
      case "any":
        if (ty.b === "void" || ty.b === "plot" || ty.b === "tuple") this.err(`${where} must be a value`, e);
        break;
      case "num":
        if (!isNum(ty) || ty.b === "na") { this.err(`${where} must be a number, got ${show(ty)}`, e); break; }
        needSimple();
        break;
      case "int":
        if (ty.b !== "int") { this.err(`${where} must be an int, got ${show(ty)}`, e); break; }
        needSimple();
        break;
      case "bool": case "string": case "color":
        if (ty.b !== p.kind) { this.err(`${where} must be a ${p.kind}, got ${show(ty)}`, e); break; }
        needSimple();
        if (p.oneOf) {
          const sv = this.constVal(e);
          if (typeof sv === "string" && !p.oneOf.includes(sv)) this.err(`${where} must be one of ${p.oneOf.map((o) => JSON.stringify(o)).join(", ")}, got ${JSON.stringify(sv)}`, e);
        }
        break;
      case "enum": {
        const v = this.constVal(e);
        if (typeof v !== "string" || !p.oneOf!.includes(v) || e.k !== "mem") {
          const ns = p.oneOf === ENUMS.plotStyle ? "plot.style_*" : p.oneOf === ENUMS.lineStyle ? "hline.style_*" : p.oneOf === ENUMS.shape ? "shape.*" : "location.*";
          this.err(`${where} must be one of ${ns}`, e);
        }
        break;
      }
      case "strlist": break;
      case "plot":
        if (!(e.k === "id" && e.sym?.kind === "plot")) this.err(`${where} must be a plot handle: p = plot(...)`, e);
        break;
    }
    const cv = this.constVal(e);
    if (typeof cv === "number" && (p.kind === "int" || p.kind === "num")) {
      if ((p.min !== undefined && cv < p.min) || (p.max !== undefined && cv > p.max)) {
        this.err(`${where} must be between ${p.min ?? "-inf"} and ${p.max ?? "inf"}, got ${cv}`, e);
      }
    }
  }

  private call(c: Call, mode: "stmt" | "decl" | "expr" | "expr-block"): Ty {
    const name = this.calleeName(c);
    if (name === null) { this.err("only named functions can be called", c.callee); for (const a of c.args) this.expr(a.value); return ERR; }
    const sig = SIGS.get(name);
    if (!sig) {
      for (const a of c.args) this.expr(a.value);
      const near = [...SIGS.keys()].filter((k) => k.endsWith(`.${name.split(".").pop()}`) || k === name.split(".").pop());
      this.err(`unknown function "${name}"${near.length ? `; did you mean ${near.slice(0, 3).join(", ")}?` : ""}`, c.callee);
      return ERR;
    }
    c.fn = name;
    const declLike = name === "plot" || name === "hline" || name === "fill" || name === "plotshape" || name === "indicator";
    if (declLike) {
      if (this.depth > 0 || mode === "expr" || mode === "expr-block") this.err(`${name}() is only allowed as a statement at the top level of the script`, c);
      else if (mode === "decl" && name !== "plot") this.err(`${name}() does not return a handle`, c);
    }
    if (name.startsWith("input.") && mode !== "decl") {
      this.err("input.* may only be the whole right-hand side of a top-level declaration: name = input.int(...)", c);
      for (const a of c.args) this.expr(a.value);
      return ERR;
    }
    const bound = this.bind(sig, c);
    c.bound = bound;
    // type the arguments (arrays for options are checked by the input handler)
    sig.params.forEach((p, k) => {
      const a = bound[k];
      if (!a) return;
      if (p.kind === "strlist") return;
      this.expr(a);
    });
    sig.params.forEach((p, k) => {
      const a = bound[k];
      if (a && p.kind !== "strlist") this.checkParam(sig, p, a);
    });
    let st = false;
    for (const a of bound) if (a?.st) st = true;
    c.st = st;
    if (sig.needs) this.need(sig.needs);
    const ret = sig.ret;
    switch (sig.op) {
      case "kernel": case "study": {
        // pure arguments only: the kernels run over whole columns
        sig.params.forEach((p, k) => {
          const a = bound[k];
          if (a && a.st && p.kind === "series") {
            this.err(`argument "${p.name}" of ${sig.name} depends on a variable that is declared var, assigned with :=, or is a block variable / loop counter. ${sig.name} runs over whole columns, so its inputs must be known before the bar is evaluated`, a);
          }
        });
        c.st = false;
        if (sig.op === "study") this.studySources(sig, bound);
        return ret;
      }
      case "scalar": return { b: "float", q: qmax(...bound.filter((x): x is Expr => !!x).map((x) => x.ty!.q)) };
      case "special": return this.special(sig, c, bound, mode, ret);
    }
  }

  /** A generic study with a second source (e.g. correl) names it in a select: no extra needs. */
  private studySources(_sig: Sig, _bound: (Expr | null)[]): void { /* needs come from the study */ }

  private special(sig: Sig, c: Call, bound: (Expr | null)[], mode: string, ret: Ty): Ty {
    const arg = (n: string) => bound[sig.params.findIndex((p) => p.name === n)] ?? null;
    switch (sig.name) {
      case "nz": {
        const r = arg("replacement");
        const x = arg("x")!;
        return { b: "float", q: qmax(x.ty!.q, r?.ty?.q ?? "const") };
      }
      case "na": return { b: "bool", q: arg("x")!.ty!.q };
      case "math.sum": return ret;
      case "ta.change": {
        const x = arg("source")!;
        if (!this.historyOk(x)) this.err("ta.change needs a plain series or a top-level variable, not an expression of changing variables", x);
        c.st = !!x.st;
        return { b: "float", q: "series" };
      }
      case "ta.crossover": case "ta.crossunder": case "ta.cross": {
        for (const a of [arg("a")!, arg("b")!]) if (!this.historyOk(a)) this.err(`${sig.name} needs plain series or top-level variables, not expressions of changing variables; assign the value to a variable first`, a);
        c.st = !!(arg("a")!.st || arg("b")!.st);
        return { b: "bool", q: "series" };
      }
      case "ta.bb": {
        for (const a of bound) if (a?.st && a.ty!.q === "series") { this.err("ta.bb needs inputs known before the bar is evaluated (no var / := / block variables)", a); break; }
        c.st = false;
        return ret;
      }
      case "color.new": return t("color", qmax(...bound.map((x) => x!.ty!.q)));
      case "indicator": return this.indicator(c, bound);
      case "plot": return this.plot(c, bound);
      case "hline": return this.hline(c, bound);
      case "fill": return this.fill(c, bound);
      case "plotshape": return this.plotshape(c, bound);
      default:
        if (sig.name.startsWith("input.")) return t("void");
        void mode;
        return ret;
    }
  }

  // ---- declarations: indicator, inputs, plots ------------------------------------------

  private str(e: Expr | null | undefined): string | undefined {
    if (!e) return undefined;
    const v = this.constVal(e);
    if (typeof v === "string") return v;
    if (e.ty && e.ty !== ERR && e.ty.b === "string") this.err("this must be a string literal", e);
    return undefined;
  }

  private int(e: Expr | null | undefined): number | undefined {
    if (!e) return undefined;
    const v = this.constVal(e);
    if (typeof v === "number") return v;
    if (e.ty && e.ty !== ERR && isNum(e.ty)) this.err("this must be a number literal", e);
    return undefined;
  }

  private indicator(c: Call, bound: (Expr | null)[]): Ty {
    if (this.sawIndicator) this.err("indicator() may be called only once", c);
    this.sawIndicator = true;
    const title = this.str(bound[0]);
    if (title !== undefined) this.plan.title = title;
    const short = this.str(bound[1]);
    if (short !== undefined) this.plan.title = short;
    if (bound[2]) {
      const v = this.constVal(bound[2]);
      if (typeof v === "boolean") this.plan.overlay = v;
      else if (bound[2].ty && bound[2].ty !== ERR) this.err("overlay must be true or false", bound[2]);
    }
    return t("void");
  }

  private colorRef(e: Expr | null | undefined, dflt: string): ColorRef {
    if (!e) return { value: dflt };
    if (e.ty === ERR) return { value: dflt };
    const v = this.constVal(e);
    if (typeof v === "string" && e.ty?.b === "color") return { value: v };
    if (e.k === "id" && e.sym?.kind === "input" && e.sym.ty.b === "color") return { input: e.sym.key! };
    if (e.k === "call" && e.fn === "color.new") {
      const base = this.colorRef(e.bound![0], dflt);
      const tr = e.bound![1] ? this.constVal(e.bound![1]!) : undefined;
      if ("value" in base && typeof tr === "number") return { value: withTransparency(base.value, tr) };
    }
    this.err("a color here must be a constant (color.red, #rrggbb, color.new(...)) or an input.color variable", e);
    return { value: dflt };
  }

  private nextKey(title: string, n: number): string {
    let k = slug(title) || `plot${n}`;
    if (/^[0-9]/.test(k)) k = `p-${k}`;
    let u = k, i = 2;
    while (this.keys.has(u)) u = `${k}-${i++}`;
    this.keys.add(u);
    return u;
  }

  private plot(c: Call, b: (Expr | null)[]): Ty {
    const n = this.plan.plots.length;
    if (n >= 64) this.err("a script may draw at most 64 plots", c);
    const title = this.str(b[1]) ?? `Plot ${n + 1}`;
    const style = (b[4] ? (this.constVal(b[4]) as string | undefined) : undefined) ?? "line";
    const width = this.int(b[3]);
    const offset = this.int(b[5]);
    const down = b[6] ? this.colorRef(b[6], "#f23645") : undefined;
    if (down && "input" in down) this.err("color_down must be a constant color", b[6]!);
    this.plan.plots.push({
      kind: style as "line", key: this.nextKey(title, n + 1), title, color: this.colorRef(b[2], ["#2962ff", "#ff6d00", "#089981", "#f23645", "#9c27b0", "#fbc02d"][n % 6]!), expr: b[0]!,
      ...(width !== undefined && { width }), ...(offset !== undefined && { offset }),
      ...(down && "value" in down && { colorDown: down.value }), span: c,
    });
    return t("plot");
  }

  private hline(c: Call, b: (Expr | null)[]): Ty {
    const n = this.plan.plots.length;
    const title = this.str(b[1]) ?? `Level ${n + 1}`;
    const ls = b[3] ? (this.constVal(b[3]) as string | undefined) : undefined;
    this.plan.plots.push({ kind: "hline", key: this.nextKey(title, n + 1), title, color: this.colorRef(b[2], "#787b86"), expr: b[0]!, ...(ls && { lineStyle: ls }), span: c });
    return t("void");
  }

  private fill(c: Call, b: (Expr | null)[]): Ty {
    const n = this.plan.plots.length;
    const title = this.str(b[3]) ?? `Fill ${n + 1}`;
    const idx = (e: Expr | null | undefined): number | undefined => (e && e.k === "id" && e.sym?.kind === "plot" ? Number(e.sym.key) : undefined);
    const a = idx(b[0]), bb = idx(b[1]);
    for (const [i, e] of [[a, b[0]], [bb, b[1]]] as const) {
      if (i !== undefined && this.plan.plots[i]!.kind !== "line") this.err("fill needs line plots (not hline, histogram, area or markers)", e!);
    }
    if (a !== undefined && a === bb) this.err("fill needs two different plots", c);
    this.plan.plots.push({ kind: "fill", key: this.nextKey(title, n + 1), title, color: this.colorRef(b[2], "#2962ff33"), ...(a !== undefined && { a }), ...(bb !== undefined && { b: bb }), span: c });
    return t("void");
  }

  private plotshape(c: Call, b: (Expr | null)[]): Ty {
    const n = this.plan.plots.length;
    const x = b[0]!;
    const title = this.str(b[1]) ?? `Shape ${n + 1}`;
    const shape = (b[2] ? (this.constVal(b[2]) as string | undefined) : undefined) ?? "circle";
    const loc = (b[3] ? (this.constVal(b[3]) as string | undefined) : undefined) ?? "above";
    const xt = x.ty;
    if (xt && xt !== ERR) {
      if (xt.b === "bool" && loc === "value") this.err("location.absolute needs a number (the price to mark), not a bool", x);
      else if (xt.b !== "bool" && loc !== "value") this.err("plotshape marks bars where a bool is true; for a number use location=location.absolute", x);
      else if (xt.b !== "bool" && !isNum(xt)) this.err(`plotshape needs a bool or a number, got ${show(xt)}`, x);
    }
    const offset = this.int(b[5]);
    this.plan.plots.push({ kind: "markers", key: this.nextKey(title, n + 1), title, color: this.colorRef(b[4], "#2962ff"), expr: x, shape, position: loc, ...(offset !== undefined && { offset }), span: c });
    return t("void");
  }

  private inputDecl(s: VarDecl): void {
    const c = s.init as Call;
    const name = this.calleeName(c)!;
    const sig = SIGS.get(name);
    if (!sig) { this.err(`unknown function "${name}"`, c.callee); this.skipInputArgs(c); return; }
    c.fn = name;
    const bound = this.bind(sig, c);
    c.bound = bound;
    const kind = name.slice("input.".length) as InputSpec["kind"];
    const idx = (n: string) => sig.params.findIndex((p) => p.name === n);
    const arg = (n: string) => bound[idx(n)] ?? null;
    // arguments are literals; type them so errors point at the right place
    sig.params.forEach((p, k) => {
      const a = bound[k];
      if (!a) return;
      if (p.kind === "strlist") {
        if (a.k !== "arr" || a.items.length === 0 || a.items.some((i) => i.k !== "str")) this.err('options must be a non-empty list of string literals: options=["a", "b"]', a);
        return;
      }
      if (name === "input.source" && p.name === "defval") return;
      this.expr(a);
      this.checkParam(sig, p, a);
      if (a.ty && a.ty !== ERR && a.ty.q !== "const" && p.kind !== "series") this.err(`${p.name} of ${name} must be a literal`, a);
    });
    let dflt: number | boolean | string = 0;
    const dv = arg("defval");
    const label = this.str(arg("title")) ?? s.name;
    const spec: InputSpec = { key: s.name, kind, label, default: 0, span: s.nameSpan };
    if (dv) {
      if (name === "input.source") {
        if (dv.k === "id" && (SOURCE_NAMES as readonly string[]).includes(dv.name) && !this.scope.find(dv.name)) {
          dflt = dv.name;
          dv.ty = FLOAT_S;
          this.need(dv.name === "close" ? "value" : "ohlc");
        } else this.err(`the default of input.source must be one of ${SOURCE_NAMES.join(", ")}`, dv);
      } else {
        const v = this.constVal(dv);
        if (v !== undefined) dflt = v;
      }
    }
    spec.default = dflt;
    if (kind === "int" || kind === "float") {
      const mn = arg("minval") ? this.int(arg("minval")) : undefined, mx = arg("maxval") ? this.int(arg("maxval")) : undefined, st = arg("step") ? this.int(arg("step")) : undefined;
      if (mn !== undefined) spec.min = mn;
      if (mx !== undefined) spec.max = mx;
      if (st !== undefined) { if (st <= 0) this.err("step must be positive", arg("step")!); else spec.step = st; }
      if (typeof dflt === "number" && ((mn !== undefined && dflt < mn) || (mx !== undefined && dflt > mx))) this.err(`the default ${dflt} is outside [${mn ?? "-inf"}, ${mx ?? "inf"}]`, dv!);
      if (mn !== undefined && mx !== undefined && mn > mx) this.err("minval is above maxval", c);
    }
    if (kind === "string") {
      const o = arg("options");
      const opts = o && o.k === "arr" ? o.items.filter((i) => i.k === "str").map((i) => (i as { value: string }).value) : [];
      spec.options = opts;
      if (opts.length > 0 && !opts.includes(dflt as string)) this.err(`the default "${String(dflt)}" is not one of the options`, dv!);
    }
    if (kind === "color" && typeof dflt === "string" && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(dflt)) this.err("the default must be a color", dv!);
    this.plan.inputs.push(spec);
    const ty: Ty = kind === "source" ? FLOAT_S : kind === "string" ? t("string", "input") : t(kind as Ty["b"], "input");
    const sym: Sym = { name: s.name, kind: "input", ty, key: s.name };
    this.declare(s.name, sym, s.nameSpan);
    s.sym = sym;
    s.init.ty = ty;
    void INT_S;
    void BOOL_S;
  }
}

export function withTransparency(hex: string, transp: number): string {
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = Math.round((1 - transp / 100) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

export function check(prog: Program, rep: Reporter, limits = DEFAULT_LIMITS): Plan {
  return new Checker(rep, limits).run(prog);
}
export type { Arg };
