// compile(source): lexer -> parser -> checker -> code generation.

import type { StudyDef } from "@alphacharts/indicators";
import { Reporter, type Diagnostic } from "./diag.js";
import { parse } from "./parser.js";
import { check, type InputSpec, type Plan } from "./check.js";
import { generate, type ColorInput } from "./codegen.js";
import { DEFAULT_LIMITS, type Limits } from "./limits.js";

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
  return { ok: true, study: def, colorInputs, inputs: plan.inputs, title: plan.title, diagnostics: rep.list, source };
}
