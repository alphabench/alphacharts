// The script runner for @alphacharts/ui's script panel: compile, attach to
// the active chart, report diagnostics. Structural, so this package does not
// depend on the UI (and the UI not on this package): the host passes
// `createScriptRunAdapter()` as `scriptRunner` next to the editor adapter.

import type { Chart, Series } from "@alphacharts/core";
import type { Diagnostic } from "./diag.js";
import { runScript, ScriptDiagnosticsError, type RunScriptOptions } from "./run.js";

/** Structural copy of `@alphacharts/ui`'s `ScriptRunAdapter` (the definition); apps/playground/src/adapter-contract.ts fails to compile if they drift apart. */
export interface ScriptRunAdapter {
  run(
    target: { chart: Chart; source: Series<"candles">; volume: Series<"histogram"> | null },
    code: string,
    onRuntimeError: (d: Diagnostic) => void,
  ): { diagnostics: readonly Diagnostic[]; remove(): void };
}

/**
 * Each run gets its own sandboxed worker (disposed with it), the script's
 * default inputs, and the volume series when the chart has one.
 */
export function createScriptRunAdapter(opts: Omit<RunScriptOptions, "volume" | "onError" | "runner"> = {}): ScriptRunAdapter {
  return {
    run(target, code, onRuntimeError) {
      try {
        const h = runScript(target.chart, target.source, code, {}, { ...opts, ...(target.volume ? { volume: target.volume } : {}), onError: onRuntimeError });
        return { diagnostics: [], remove: () => h.remove() };
      } catch (e) {
        // Compile errors are the user's to fix; anything else is a bug and is rethrown.
        if (e instanceof ScriptDiagnosticsError) return { diagnostics: e.diagnostics, remove: () => {} };
        throw e;
      }
    },
  };
}
