// Code generation: a checked Plan becomes a StudyDef for the indicators engine.
//
// Nothing here evaluates text: the output is a tree of JavaScript closures built
// from the syntax tree, so no identifier or string of a script can become code.
//
// Evaluation model (see README "How a script runs"):
//  - pure parts (functions of the bars and inputs) become whole-column graph
//    nodes; ta.* calls are the same kernels the built-in studies use, so the
//    numbers are identical;
//  - the stateful part (var, :=, if, for) is one per-bar node. A var lives in
//    its column: bar i restarts from bar i-1's committed value, so a revised
//    last bar recomputes from committed state exactly like a built-in.

import type { Col, Graph, InputDef, Params, PlotDef, StudyDef } from "@alphacharts/indicators";
import { resolveParams, SOURCE_NAMES } from "@alphacharts/indicators";
import type { Call, Expr, Stmt, Sym } from "./ast.js";
import { ScriptError, type Span } from "./diag.js";
import { SIGS, type Sig } from "./builtins.js";
import type { Plan, PlotSpec } from "./check.js";
import { DEFAULT_LIMITS, MAX_HISTORY, type Limits } from "./limits.js";

type Ev = (i: number) => number;
type Mode = "col" | "exec";
const NaN_ = Number.NaN;
const truthy = (v: number) => v === v && v !== 0;

export interface ColorInput { key: string; label: string; default: string; plotKeys: string[] }

export interface Compiled {
  def: StudyDef;
  colorInputs: ColorInput[];
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function generate(plan: Plan, source: string, limits: Limits = DEFAULT_LIMITS): Compiled {
  const inputDefs: InputDef[] = [];
  const colorInputs: ColorInput[] = [];
  for (const s of plan.inputs) {
    switch (s.kind) {
      case "int": inputDefs.push({ key: s.key, label: s.label, type: "int", default: s.default as number, ...(s.min !== undefined && { min: s.min }), ...(s.max !== undefined && { max: s.max }), step: s.step ?? 1 }); break;
      case "float": inputDefs.push({ key: s.key, label: s.label, type: "float", default: s.default as number, ...(s.min !== undefined && { min: s.min }), ...(s.max !== undefined && { max: s.max }), ...(s.step !== undefined && { step: s.step }) }); break;
      case "bool": inputDefs.push({ key: s.key, label: s.label, type: "bool", default: s.default as boolean }); break;
      case "string": inputDefs.push({ key: s.key, label: s.label, type: "select", default: s.default as string, options: s.options! }); break;
      case "source": inputDefs.push({ key: s.key, label: s.label, type: "source", default: s.default as string, options: SOURCE_NAMES }); break;
      case "color": colorInputs.push({ key: s.key, label: s.label, default: s.default as string, plotKeys: [] }); break;
    }
  }
  const inputDefault = (key: string) => plan.inputs.find((i) => i.key === key)!.default as string;

  // columns and plot definitions
  const columns: string[] = [];
  const plots: PlotDef[] = [];
  const colOfPlot = new Map<number, string>();
  plan.plots.forEach((sp, idx) => {
    const color = "value" in sp.color ? sp.color.value : inputDefault(sp.color.input);
    if ("input" in sp.color) colorInputs.find((c) => c.key === (sp.color as { input: string }).input)!.plotKeys.push(sp.key);
    const base = { key: sp.key, title: sp.title };
    switch (sp.kind) {
      case "line": columns.push(sp.key); colOfPlot.set(idx, sp.key); plots.push({ kind: "line", ...base, col: sp.key, color, ...(sp.width !== undefined && { width: sp.width }), ...(sp.offset !== undefined && { offset: sp.offset }) }); break;
      case "histogram": columns.push(sp.key); plots.push({ kind: "histogram", ...base, col: sp.key, color, ...(sp.colorDown && { colorDown: sp.colorDown }) }); break;
      case "area": columns.push(sp.key); plots.push({ kind: "area", ...base, col: sp.key, color }); break;
      case "markers": columns.push(sp.key); plots.push({ kind: "markers", ...base, col: sp.key, shape: sp.shape as "circle", position: sp.position as "above", color, ...(sp.offset !== undefined && { offset: sp.offset }) }); break;
      case "hline": plots.push({ kind: "hline", ...base, value: (p: Params) => new Builder(null, p, plan, limits).simpleNumber(sp.expr!), color, style: (sp.lineStyle ?? "dashed") as "dashed" }); break;
      case "fill": plots.push({ kind: "fill", ...base, a: colOfPlot.get(sp.a!)!, b: colOfPlot.get(sp.b!)!, color }); break;
    }
  });

  const def: StudyDef = {
    id: `script-${hash(source)}`,
    name: plan.title,
    family: "tv",
    inputs: inputDefs,
    needs: plan.needs,
    pane: plan.overlay ? "overlay" : "new",
    columns,
    plots,
    build: (g, p) => new Builder(g, p, plan, limits).build(),
    reference: "AlphaCharts script",
  };
  return { def, colorInputs };
}

class Builder {
  private readonly simple = new Map<Sym, number | string>();
  private readonly pure = new Map<Sym, Col>();
  private readonly stateCols = new Map<Sym, Col>();
  private readonly hoisted = new Map<Expr, Col[]>();
  private readonly mats = new Map<Expr, Col>();
  private readonly inits = new Map<Sym, Expr>();
  private S: Float64Array;
  private readonly ctx = { steps: 0 };
  private tr: Col | null = null;

  constructor(private readonly g: Graph | null, private readonly p: Params, private readonly plan: Plan, private readonly limits: Limits) {
    this.S = new Float64Array(plan.slots);
    for (const s of plan.body) if (s.k === "decl" && s.sym) this.inits.set(s.sym, s.init);
  }

  private G(): Graph {
    if (!this.g) throw new ScriptError("a series is not available here");
    return this.g;
  }

  // ---- program -------------------------------------------------------------------

  build(): Col[] {
    const g = this.G();
    const exec: Stmt[] = [];
    for (const s of this.plan.body) {
      switch (s.k) {
        case "decl": {
          const sym = s.sym!;
          if (sym.kind === "state") exec.push(s);
          else if (sym.kind === "pure") this.pure.set(sym, this.colOf(s.init));
          break;
        }
        case "tuple": {
          const cols = this.hoist(s.init as Call);
          s.syms!.forEach((sym, k) => this.pure.set(sym, cols[k]!));
          break;
        }
        case "assign": case "if": case "for": exec.push(s); break;
        default: break;
      }
    }
    if (exec.length > 0 || this.plan.stateVars.length > 0) this.buildExec(exec);
    const out: Col[] = [];
    for (const sp of this.plan.plots) {
      if (sp.kind === "hline" || sp.kind === "fill") continue;
      out.push(sp.kind === "markers" ? this.markers(sp) : this.colOf(sp.expr!));
    }
    if (g.cols.length > this.limits.maxColumns) throw new ScriptError(`the script needs ${g.cols.length} columns; the limit is ${this.limits.maxColumns}`);
    return out;
  }

  private markers(sp: PlotSpec): Col {
    const e = sp.expr!;
    const f = this.ev(e, "col");
    const absolute = sp.position === "value";
    return this.G().calc(absolute ? f : (i) => (truthy(f(i)) ? 1 : NaN_));
  }

  private buildExec(stmts: Stmt[]): void {
    const g = this.G();
    for (const sym of this.plan.stateVars) this.stateCols.set(sym, g.col());
    const run = stmts.map((s) => this.stmt(s));
    const S = this.S, ctx = this.ctx, max = this.limits.maxSteps;
    const vars = this.plan.stateVars.map((sym) => ({ slot: sym.slot!, col: this.stateCols.get(sym)!, restore: !!sym.isVar }));
    g.node((_self, from, to) => {
      void max;
      for (let i = from; i < to; i++) {
        ctx.steps = 0; // the budget is per bar: it must not depend on how many bars a batch holds
        for (const v of vars) if (v.restore) S[v.slot] = i > 0 ? v.col.v[i - 1]! : NaN_;
        for (const r of run) r(i);
        for (const v of vars) v.col.v[i] = S[v.slot]!;
      }
    });
  }

  private step(span: Span): void {
    if (++this.ctx.steps > this.limits.maxSteps) throw new ScriptError(`execution budget exceeded: more than ${this.limits.maxSteps} loop steps in one bar`, span, "budget");
  }

  private stmt(s: Stmt): (i: number) => void {
    const S = this.S;
    switch (s.k) {
      case "decl": {
        const f = this.ev(s.init, "exec"), slot = s.sym!.slot!;
        return s.isVar ? (i) => { if (i === 0) S[slot] = f(i); } : (i) => { S[slot] = f(i); };
      }
      case "assign": {
        const f = this.ev(s.value, "exec"), slot = s.sym!.slot!;
        switch (s.op) {
          case ":=": return (i) => { S[slot] = f(i); };
          case "+=": return (i) => { S[slot] = S[slot]! + f(i); };
          case "-=": return (i) => { S[slot] = S[slot]! - f(i); };
          case "*=": return (i) => { S[slot] = S[slot]! * f(i); };
          case "/=": return (i) => { const d = f(i); S[slot] = d === 0 ? NaN_ : S[slot]! / d; };
          default: return (i) => { const d = f(i); S[slot] = d === 0 ? NaN_ : S[slot]! % d; };
        }
      }
      case "if": {
        const c = this.ev(s.cond, "exec"), a = s.then.map((x) => this.stmt(x)), b = (s.else ?? []).map((x) => this.stmt(x));
        return (i) => { for (const r of truthy(c(i)) ? a : b) r(i); };
      }
      case "for": {
        const lo = this.ev(s.lo, "exec"), hi = this.ev(s.hi, "exec"), by = s.by ? this.ev(s.by, "exec") : null;
        const body = s.body.map((x) => this.stmt(x)), slot = s.sym!.slot!, maxIt = this.limits.maxLoopIterations;
        return (i) => {
          const a = lo(i), b = hi(i);
          let st = by ? by(i) : a <= b ? 1 : -1;
          if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(st) || st === 0) throw new ScriptError("loop bounds must be finite and the step non-zero", s, "runtime");
          if (by && ((st > 0 && a > b) || (st < 0 && a < b))) return;
          if (!by && a > b) st = -1;
          const trips = Math.floor(Math.abs(b - a) / Math.abs(st)) + 1;
          if (trips > maxIt) throw new ScriptError(`this loop would run ${trips} times; the limit is ${maxIt} iterations per loop`, s, "budget");
          let v = a;
          for (let k = 0; k < trips; k++, v += st) {
            this.step(s);
            S[slot] = v;
            for (const r of body) r(i);
          }
        };
      }
      default: return () => {};
    }
  }

  // ---- series ---------------------------------------------------------------------

  private srcCol(name: string): Col {
    const g = this.G();
    switch (name) {
      case "volume": return g.volume;
      case "time": return g.time;
      case "bar_index": return g.calc((i) => i);
      default: return g.src(name as "close");
    }
  }

  /** The column holding a series expression (materialised once). */
  colOf(e: Expr): Col {
    const g = this.G();
    if (e.k === "id" && e.sym) {
      const s = e.sym;
      if (s.kind === "builtin") return this.memo(e, () => this.srcCol(s.key!));
      if (s.kind === "pure") return this.pure.get(s)!;
      if (s.kind === "state") return this.stateCols.get(s)!;
      if (s.kind === "input" && s.ty.b === "float" && s.ty.q === "series") return this.srcCol(String(this.p[s.key!]));
    }
    if (e.k === "call" && this.isHoisted(e)) return this.hoist(e)[0]!;
    return this.memo(e, () => {
      const f = this.ev(e, "col");
      return g.calc(f);
    });
  }

  private memo(e: Expr, make: () => Col): Col {
    let c = this.mats.get(e);
    if (!c) this.mats.set(e, (c = make()));
    return c;
  }

  private isHoisted(c: Call): boolean {
    const sig = SIGS.get(c.fn!);
    return !!sig && (sig.op === "kernel" || sig.op === "study" || sig.name === "ta.bb");
  }

  private num(e: Expr | null | undefined, what: string, min: number, max: number, int = true): number {
    const v = this.ev(e!, "col")(0);
    if (!Number.isFinite(v) || (int && !Number.isInteger(v)) || v < min || v > max) {
      throw new ScriptError(`${what} must be ${int ? "an integer" : "a number"} between ${min} and ${max}, got ${v}`, e!, "build");
    }
    return v;
  }

  private hoist(c: Call): Col[] {
    const hit = this.hoisted.get(c);
    if (hit) return hit;
    const sig = SIGS.get(c.fn!)!;
    const b = c.bound!;
    const g = this.G();
    const lim = this.limits.maxPeriod;
    let out: Col[];
    const len = (k: number) => this.num(b[k], `the length of ${sig.name}`, 1, lim);
    switch (sig.name) {
      case "ta.sma": out = [g.sma(this.colOf(b[0]!), len(1))]; break;
      case "ta.ema": out = [g.ema(this.colOf(b[0]!), len(1))]; break;
      case "ta.wma": out = [g.wma(this.colOf(b[0]!), len(1))]; break;
      case "ta.rma": out = [g.rma(this.colOf(b[0]!), len(1))]; break;
      case "ta.highest": out = [g.highest(this.colOf(b[0]!), len(1))]; break;
      case "ta.lowest": out = [g.lowest(this.colOf(b[0]!), len(1))]; break;
      case "ta.highestbars": out = [g.highestBars(this.colOf(b[0]!), len(1))]; break;
      case "ta.lowestbars": out = [g.lowestBars(this.colOf(b[0]!), len(1))]; break;
      case "ta.stdev": out = [g.stdev(this.colOf(b[0]!), len(1))]; break;
      case "ta.variance": out = [g.variance(this.colOf(b[0]!), len(1))]; break;
      case "ta.sum": case "math.sum": out = [g.sum(this.colOf(b[0]!), len(1))]; break;
      case "ta.linreg": {
        const n = this.num(b[1], "the length of ta.linreg", 2, lim);
        out = [g.linreg(this.colOf(b[0]!), n).value];
        break;
      }
      case "ta.atr": out = [g.atr(len(0))]; break;
      case "ta.bb": {
        const def = SIGS.get("ta.bbands")!.study!;
        const mult = this.num(b[2], "mult of ta.bb", 0, 100, false);
        const cols = this.runStudy(def, { length: len(1), multUp: mult, multDn: mult }, this.colOf(b[0]!));
        out = [cols[1]!, cols[0]!, cols[2]!];
        break;
      }
      default: out = this.hoistStudy(sig, c);
    }
    this.hoisted.set(c, out);
    return out;
  }

  private hoistStudy(sig: Sig, c: Call): Col[] {
    const def = sig.study!;
    const given: Record<string, unknown> = {};
    let srcCol: Col | null = null;
    sig.params.forEach((prm, k) => {
      const a = c.bound![k];
      if (!a) return;
      const inp = prm.input!;
      if (inp.type === "source") { srcCol = this.colOf(a); return; }
      if (inp.type === "select") { given[inp.key] = this.str(a); return; }
      if (inp.type === "bool") { given[inp.key] = truthy(this.ev(a, "col")(0)); return; }
      const v = this.ev(a, "col")(0);
      if (!Number.isFinite(v) || (inp.type === "int" && !Number.isInteger(v)) || (inp.min !== undefined && v < inp.min) || (inp.max !== undefined && v > inp.max)) {
        throw new ScriptError(`${inp.key} of ${sig.name} must be ${inp.type === "int" ? "an integer" : "a number"}${inp.min !== undefined ? ` >= ${inp.min}` : ""}${inp.max !== undefined ? ` <= ${inp.max}` : ""}, got ${v}`, a);
      }
      given[inp.key] = v;
    });
    try {
      return this.runStudy(def, given, srcCol);
    } catch (e) {
      if (e instanceof ScriptError) throw e;
      throw new ScriptError(`${sig.name}: ${e instanceof Error ? e.message : String(e)}`, c);
    }
  }

  /** Build a built-in study's nodes on this graph, with its `source` input bound to `src`. */
  private runStudy(def: StudyDef, given: Record<string, unknown>, src: Col | null): Col[] {
    // validated like addStudy validates a built-in's inputs: an unknown name or a value outside the schema is an error, never a default
    const p = resolveParams(def, given as Record<string, number | boolean | string>);
    const gv = Object.create(this.G()) as Graph;
    if (src) (gv as { src: (n: string) => Col }).src = () => src;
    return [...def.build(gv, p)];
  }

  // ---- expressions ----------------------------------------------------------------

  private str(e: Expr): string {
    switch (e.k) {
      case "str": return e.value;
      case "color": return e.value;
      case "mem": return String(e.cv);
      case "id": {
        const s = e.sym!;
        if (s.kind === "input") return String(this.p[s.key!]);
        if (s.kind === "simple") return String(this.simpleVal(s));
        break;
      }
      case "tern": return truthy(this.ev(e.c, "col")(0)) ? this.str(e.a) : this.str(e.b);
      case "call": if (e.fn === "color.new") return String(this.simpleVal2(e)); break;
      default: break;
    }
    throw new ScriptError("this string cannot be evaluated here", e);
  }

  private simpleVal2(e: Call): string {
    return String(e.fn);
  }

  private simpleVal(s: Sym): number | string {
    const hit = this.simple.get(s);
    if (hit !== undefined) return hit;
    const init = this.inits.get(s)!;
    const v = init.ty!.b === "string" || init.ty!.b === "color" ? this.str(init) : this.ev(init, "col")(0);
    this.simple.set(s, v);
    return v;
  }

  simpleNumber(e: Expr): number {
    return this.ev(e, "col")(0);
  }

  private hist(x: Expr, k: Ev, mode: Mode, span: Span): Ev {
    const S = this.S;
    const bad = (v: number) => { throw new ScriptError(`the history offset must be an integer between 0 and ${MAX_HISTORY}, got ${v}`, span, "runtime"); };
    if (x.k === "id" && x.sym?.kind === "state" && mode === "exec") {
      const slot = x.sym.slot!, col = this.stateCols.get(x.sym)!;
      return (i) => {
        const n = k(i);
        if (!Number.isInteger(n) || n < 0 || n > MAX_HISTORY) return bad(n);
        return n === 0 ? S[slot]! : i - n >= 0 ? col.v[i - n]! : NaN_;
      };
    }
    const col = this.colOf(x);
    return (i) => {
      const n = k(i);
      if (!Number.isInteger(n) || n < 0 || n > MAX_HISTORY) return bad(n);
      return i - n >= 0 ? col.v[i - n]! : NaN_;
    };
  }

  ev(e: Expr, mode: Mode): Ev {
    const S = this.S;
    switch (e.k) {
      case "num": { const v = e.value; return () => v; }
      case "bool": { const v = e.value ? 1 : 0; return () => v; }
      case "str": case "color": case "arr": throw new ScriptError("a string or color is not a number", e);
      case "id": {
        const s = e.sym;
        if (!s) return () => NaN_; // na
        switch (s.kind) {
          case "builtin": {
            if (s.key === "bar_index") return (i) => i;
            const c = this.srcCol(s.key!);
            return (i) => c.v[i]!;
          }
          case "input": {
            if (s.ty.b === "float" && s.ty.q === "series") { const c = this.srcCol(String(this.p[s.key!])); return (i) => c.v[i]!; }
            const v = this.p[s.key!];
            if (typeof v === "string") throw new ScriptError("a string is not a number", e);
            const n = typeof v === "boolean" ? (v ? 1 : 0) : (v as number);
            return () => n;
          }
          case "simple": {
            const v = this.simpleVal(s);
            if (typeof v === "string") throw new ScriptError("a string is not a number", e);
            return () => v;
          }
          case "pure": { const c = this.pure.get(s)!; return (i) => c.v[i]!; }
          case "state": {
            if (mode === "exec") { const slot = s.slot!; return () => S[slot]!; }
            const c = this.stateCols.get(s)!;
            return (i) => c.v[i]!;
          }
          case "local": case "loop": { const slot = s.slot!; return () => S[slot]!; }
          default: throw new ScriptError("this name has no numeric value", e);
        }
      }
      case "mem": {
        if (typeof e.cv === "number") { const v = e.cv; return () => v; }
        if (e.obj.k === "id" && e.name === "tr") { const c = (this.tr ??= this.G().tr()); return (i) => c.v[i]!; }
        throw new ScriptError("this name has no numeric value", e);
      }
      case "un": {
        const x = this.ev(e.x, mode);
        if (e.op === "-") return (i) => -x(i);
        if (e.op === "+") return x;
        return (i) => (truthy(x(i)) ? 0 : 1);
      }
      case "bin": return this.binary(e, mode);
      case "tern": {
        const c = this.ev(e.c, mode), a = this.ev(e.a, mode), b = this.ev(e.b, mode);
        return (i) => (truthy(c(i)) ? a(i) : b(i));
      }
      case "idx": {
        const k = this.ev(e.i, mode);
        return this.hist(e.x, k, mode, e);
      }
      case "call": return this.callEv(e, mode);
    }
  }

  private binary(e: Extract<Expr, { k: "bin" }>, mode: Mode): Ev {
    const ta = e.a.ty!, tb = e.b.ty!;
    if (e.op === "==" || e.op === "!=") {
      if ((ta.b === "string" || ta.b === "color") && ta.b === tb.b) {
        const eq = this.str(e.a) === this.str(e.b);
        const v = (e.op === "==") === eq ? 1 : 0;
        return () => v;
      }
    }
    const a = this.ev(e.a, mode), b = this.ev(e.b, mode);
    switch (e.op) {
      case "+": return (i) => a(i) + b(i);
      case "-": return (i) => a(i) - b(i);
      case "*": return (i) => a(i) * b(i);
      case "/": return (i) => { const d = b(i); return d === 0 ? NaN_ : a(i) / d; };
      case "%": return (i) => { const d = b(i); return d === 0 ? NaN_ : a(i) % d; };
      case "<": return (i) => (a(i) < b(i) ? 1 : 0);
      case "<=": return (i) => (a(i) <= b(i) ? 1 : 0);
      case ">": return (i) => (a(i) > b(i) ? 1 : 0);
      case ">=": return (i) => (a(i) >= b(i) ? 1 : 0);
      case "==": return (i) => (a(i) === b(i) ? 1 : 0);
      // na never compares equal or unequal: both sides must be present
      case "!=": return (i) => { const x = a(i), y = b(i); return x === x && y === y && x !== y ? 1 : 0; };
      case "and": return (i) => (truthy(a(i)) && truthy(b(i)) ? 1 : 0);
      case "or": return (i) => (truthy(a(i)) || truthy(b(i)) ? 1 : 0);
      default: throw new ScriptError(`unknown operator ${e.op}`, e);
    }
  }

  private callEv(c: Call, mode: Mode): Ev {
    const sig = SIGS.get(c.fn!)!;
    const b = c.bound!;
    if (this.isHoisted(c)) {
      const col = this.hoist(c)[0]!;
      return (i) => col.v[i]!;
    }
    switch (sig.name) {
      case "nz": {
        const x = this.ev(b[0]!, mode), r = b[1] ? this.ev(b[1], mode) : () => 0;
        return (i) => { const v = x(i); return v === v ? v : r(i); };
      }
      case "na": { const x = this.ev(b[0]!, mode); return (i) => { const v = x(i); return v === v ? 0 : 1; }; }
      case "ta.change": {
        const cur = this.ev(b[0]!, mode), prev = this.hist(b[0]!, b[1] ? this.ev(b[1], mode) : () => 1, mode, c);
        return (i) => cur(i) - prev(i);
      }
      case "ta.crossover": case "ta.crossunder": case "ta.cross": {
        const ca = this.ev(b[0]!, mode), cb = this.ev(b[1]!, mode);
        const pa = this.hist(b[0]!, () => 1, mode, c), pb = this.hist(b[1]!, () => 1, mode, c);
        const over = (i: number) => ca(i) > cb(i) && pa(i) <= pb(i);
        const under = (i: number) => ca(i) < cb(i) && pa(i) >= pb(i);
        if (sig.name === "ta.crossover") return (i) => (over(i) ? 1 : 0);
        if (sig.name === "ta.crossunder") return (i) => (under(i) ? 1 : 0);
        return (i) => (over(i) || under(i) ? 1 : 0);
      }
      case "color.new": throw new ScriptError("a color is not a number", c);
      default:
        if (sig.op === "scalar") {
          const fn = sig.fn!, args = b.map((x) => this.ev(x!, mode));
          if (args.length === 1) { const a0 = args[0]!; return (i) => fn(a0(i)); }
          const a0 = args[0]!, a1 = args[1]!;
          return (i) => fn(a0(i), a1(i));
        }
        throw new ScriptError(`${sig.name} cannot be used as a value here`, c);
    }
  }
}
