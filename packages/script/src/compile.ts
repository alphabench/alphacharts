// compile(source): lexer -> parser -> checker -> code generation.

import type { StudyDef } from "@alphacharts/indicators";
import { Reporter, type Diagnostic } from "./diag.js";
import { parse } from "./parser.js";
import { check, type InputSpec, type Plan, type PlotSpec } from "./check.js";
import type { Expr, Stmt } from "./ast.js";
import { generate, type ColorInput } from "./codegen.js";
import type { Dependency } from "./feeds.js";
import { DEFAULT_LIMITS, type Limits } from "./limits.js";

/** One output statement of the script. `expr` is the series plotted (plot, plotshape) or the price of an hline; fill has none. */
export interface PlotView {
  kind: PlotSpec["kind"];
  title: string;
  expr: Expr | null;
}

/**
 * What the script means, read off the checked syntax tree (nothing is executed). Read-only: the tree is shared with the
 * compiled study, do not change it. Names are resolved: an `id` node's `sym` is the declaration it refers to (same object for every use
 * and every assignment of one variable), `ty` is every expression's type, `call.fn` the resolved function name ("ta.sma").
 */
export interface ScriptPlan {
  overlay: boolean;
  /** The price axis the script's series use. */
  scale: "left" | "right";
  /**
   * The outside series the script reads, one entry per distinct `outside(symbol, field, timeframe)` call, found by
   * reading the program (nothing is run). `symbol` / `timeframe` are null for "this chart's". The host loads them and
   * gives them to the script (`feedsOf(plan.dependencies)` groups them by series).
   */
  dependencies: readonly Dependency[];
  /** The most the script reads: "value" (close/time only), "ohlc", or "ohlcv" when it reads volume (the `volume` series or a study that does). */
  needs: Plan["needs"];
  plots: readonly PlotView[];
  /** Top-level statements, in order. */
  body: readonly Stmt[];
}

export interface CompileOk {
  ok: true;
  study: StudyDef;
  /** Inputs the study schema has no type for (input.color): applied as plot colours. */
  colorInputs: ColorInput[];
  inputs: InputSpec[];
  title: string;
  /** Warnings only. */
  diagnostics: Diagnostic[];
  source: string;
  plan: ScriptPlan;
}
export interface CompileFailed {
  ok: false;
  diagnostics: Diagnostic[];
}
export type CompileResult = CompileOk | CompileFailed;

export function compile(source: string, limits: Limits = DEFAULT_LIMITS): CompileResult {
  if (typeof source !== "string") return { ok: false, diagnostics: [{ severity: "error", message: "the script must be a string", line: 1, column: 1, endLine: 1, endColumn: 1, from: 0, to: 0 }] };
  if (source.length > limits.maxSourceChars) {
    return { ok: false, diagnostics: [{ severity: "error", message: `the script is ${source.length} characters; the limit is ${limits.maxSourceChars}`, line: 1, column: 1, endLine: 1, endColumn: 1, from: 0, to: 0 }] };
  }
  const rep = new Reporter(source);
  const prog = parse(source, rep);
  let plan: Plan | null = null;
  if (rep.errorCount === 0) plan = check(prog, rep, limits);
  if (rep.errorCount === 0 && plan && plan.plots.length === 0) rep.error("the script draws nothing: add plot(...)", { from: 0, to: Math.min(source.length, 1) });
  if (rep.errorCount > 0 || !plan) return { ok: false, diagnostics: rep.list };
  const { def, colorInputs } = generate(plan, source, limits);
  return { ok: true, study: def, colorInputs, inputs: plan.inputs, title: plan.title, diagnostics: rep.list, source, plan: { overlay: plan.overlay, scale: plan.scale, dependencies: plan.dependencies, needs: plan.needs, plots: plan.plots.map((p) => ({ kind: p.kind, title: p.title, expr: p.expr ?? null })), body: plan.body } };
}
