// runScript: a script on a chart, computed in the sandbox worker, as a handle
// like addStudy's. Batch runs and ticks both execute in the worker; the main
// thread only mirrors the columns and draws them through the indicators plugin.

import { addStudy, type Study, type StudyDef } from "@alphacharts/indicators";
import type { Chart, Series, SeriesType } from "@alphacharts/core";
import { compile, type CompileOk } from "./compile.js";
import { LineMap, ScriptError, type Diagnostic } from "./diag.js";
import { ScriptRunner, defaultWorkerFactory } from "./runner.js";
import { withBridge } from "./sandbox.js";
import type { Limits } from "./limits.js";
import type { InputValue, WorkerLike } from "@alphacharts/indicators";

type SourceSeries = Series<"candles" | "bars" | "line" | "area" | "histogram">;
type VolumeSeries = Series<"histogram" | "line" | "area">;

export class ScriptDiagnosticsError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.filter((d) => d.severity === "error").map((d) => `${d.line}:${d.column}: ${d.message}`).join("\n"));
    this.name = "ScriptDiagnosticsError";
  }
}

export interface RunScriptOptions {
  volume?: VolumeSeries;
  /** Share one runner (one worker) between scripts. Default: a private one that `remove()` disposes. */
  runner?: ScriptRunner;
  /** Creates the worker (default: dist/worker.js next to the package's index). */
  workerFactory?: () => WorkerLike;
  limits?: Partial<Limits>;
  id?: string;
  /** Called when the script fails at run time (budget, runtime error, worker failure). */
  onError?: (d: Diagnostic) => void;
}

export interface ScriptHandle {
  readonly study: Study;
  readonly compiled: CompileOk;
  /** Last run-time failure, if any. */
  error: Diagnostic | null;
  setInputs(partial: Readonly<Record<string, InputValue>>): void;
  remove(): void;
  ready(): Promise<void>;
  toJSON(): SavedScript;
}

export interface SavedScript {
  version: 1;
  source: string;
  inputs: Record<string, InputValue>;
  series: string;
  volume?: string;
  visible: boolean;
}

let counter = 0;

function toDiagnostic(source: string, e: unknown): Diagnostic {
  const lm = new LineMap(source);
  const se = e instanceof ScriptError ? e : null;
  const from = se?.span?.from ?? 0, to = se?.span?.to ?? 0;
  const a = lm.at(from), b = lm.at(to);
  return { severity: "error", message: e instanceof Error ? e.message : String(e), line: a.line, column: a.column, endLine: b.line, endColumn: b.column, from, to };
}

export function runScript(chart: Chart, source: SourceSeries, text: string, inputs: Readonly<Record<string, InputValue>>, opts: RunScriptOptions): ScriptHandle {
  const r = compile(text);
  if (!r.ok) throw new ScriptDiagnosticsError(r.diagnostics);
  const ownRunner = !opts.runner;
  const runner = opts.runner ?? new ScriptRunner(opts.workerFactory ?? defaultWorkerFactory, opts.limits);
  const colorKeys = new Set(r.colorInputs.map((c) => c.key));
  const schema: Record<string, InputValue> = {};
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (colorKeys.has(k)) colors[k] = String(v);
    else schema[k] = v;
  }
  const id = opts.id ?? `script${++counter}`;
  let study: Study | null = null;
  let handleRef: { error: Diagnostic | null } = { error: null };
  const report = (e: unknown) => {
    const d = toDiagnostic(text, e);
    handleRef.error = d;
    opts.onError?.(d);
  };
  const base: StudyDef = { ...r.study, id: `script:${id}` };
  // the main-thread mirror: same columns as the worker's graph, nothing computed here
  let sid = 0;
  const mirror = withBridge(base, (i) => {
    const g = lastGraph!;
    runner.sendBar(sid, i, { time: g.time.v[i]!, open: g.open.v[i]!, high: g.high.v[i]!, low: g.low.v[i]!, close: g.close.v[i]!, volume: g.volume.v[i]! });
  }, true);
  let lastGraph: import("@alphacharts/indicators").Graph | null = null;
  const def: StudyDef = { ...mirror, build: (g, p) => { lastGraph = g; return mirror.build(g, p); } };
  sid = runner.attach(def, text, {
    values(index, values) {
      if (!study || study.disposed) return;
      const cols = def.columns;
      const n = study.times().length;
      if (index >= n) return;
      cols.forEach((c, k) => { study!.column(c)[index] = values[k]!; });
      study.refresh(index === n - 1);
    },
    error: report,
  });
  const colorOf = (key: string, v: string) => {
    for (const plot of r.colorInputs.find((c) => c.key === key)!.plotKeys) study!.setStyle(plot, { color: v });
  };
  // This study uses this runner even when the chart's studies plugin was installed with another (or none).
  study = addStudy(chart, source, def, schema, {
    runner, id, persist: false, ...(opts.volume && { volume: opts.volume }),
    // however the study ends (remove(), its source series removed, a layout restored over it) the worker state goes too
    onDispose: () => { runner.detach(sid); if (ownRunner) runner.dispose(); },
  });
  for (const [k, v] of Object.entries(colors)) colorOf(k, v);
  study.ready().catch(report);
  const handle: ScriptHandle = {
    study,
    compiled: r,
    get error() { return handleRef.error; },
    set error(v) { handleRef.error = v; },
    setInputs(partial) {
      const rest: Record<string, InputValue> = {};
      for (const [k, v] of Object.entries(partial)) {
        if (colorKeys.has(k)) { colors[k] = String(v); colorOf(k, String(v)); } else rest[k] = v;
      }
      if (Object.keys(rest).length > 0) { handleRef.error = null; study!.setInputs(rest); study!.ready().catch(report); }
    },
    remove() {
      study!.remove();
    },
    ready: () => study!.ready(),
    toJSON() {
      return { version: 1, source: text, inputs: { ...(study!.inputs() as Record<string, InputValue>), ...colors }, series: source.options().id, ...(opts.volume && { volume: opts.volume.options().id }), visible: study!.visible };
    },
  };
  return handle;
}

/** Recreate a saved script (SavedScript from `toJSON`) on a chart that holds its series. */
export function restoreScript(chart: Chart, saved: SavedScript, opts: RunScriptOptions = {}): ScriptHandle {
  if (saved?.version !== 1 || typeof saved.source !== "string") throw new TypeError("unrecognised saved script");
  const byId = new Map(chart.series().map((s) => [s.options().id, s]));
  const src = byId.get(saved.series);
  if (!src) throw new Error(`the saved script needs series "${saved.series}"`);
  const vol = saved.volume ? byId.get(saved.volume) : undefined;
  const h = runScript(chart, src as SourceSeries, saved.source, saved.inputs, { ...opts, ...(vol && { volume: vol as VolumeSeries }) });
  if (!saved.visible) h.study.setVisible(false);
  return h;
}

export type { SeriesType };
