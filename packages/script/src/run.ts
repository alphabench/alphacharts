// runScript: a script on a chart, computed in the sandbox worker, as a handle
// like addStudy's. Batch runs and ticks both execute in the worker; the main
// thread only mirrors the columns and draws them through the indicators plugin.

import { addStudy, type Study, type StudyDef } from "@alphacharts/indicators";
import type { Chart, Series, SeriesType } from "@alphacharts/core";
import { compile, type CompileOk } from "./compile.js";
import { alignFor, feedsOf, type FeedRef } from "./feeds.js";
import { LineMap, ScriptError, type Diagnostic } from "./diag.js";
import { ScriptRunner } from "./runner.js";
import { withBridge } from "./sandbox.js";
import type { Limits } from "./limits.js";
import type { FeedBar, FeedBars, InputValue, WorkerLike } from "@alphacharts/indicators";

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
  /** Creates the worker, from the host's bundler (`new Worker(new URL("@alphacharts/script/worker", import.meta.url), { type: "module" })`). Required unless `runner` is given: the package never guesses where its worker lives. */
  workerFactory?: () => WorkerLike;
  limits?: Partial<Limits>;
  /**
   * Length of one bar of the source series, ms. Required when the script reads outside series (`compile().plan.dependencies`):
   * it decides whether each joins on exact time (same length) or on the bar that has finished (longer).
   */
  intervalMs?: number;
  id?: string;
  /** Called when the script fails at run time (budget, runtime error, worker failure). */
  onError?: (d: Diagnostic) => void;
}

export interface ScriptHandle {
  readonly study: Study;
  readonly compiled: CompileOk;
  /** The outside series the script reads (what to load and pass to `setSeries`), empty for a script that reads none. */
  readonly feeds: readonly FeedRef[];
  /**
   * Give the script the bars of outside series `key` (one of `feeds[i].key`), in that series' own time (UTC ms, strictly
   * increasing), replacing what it had, and compute again. The script keeps its own copy.
   */
  setSeries(key: string, bars: FeedBars): void;
  /**
   * A live bar of outside series `key`: the same time as its last bar revises it, a later time appends. Only the chart's
   * last bar is evaluated again, and only when it sees a different bar of that series; otherwise nothing is computed or
   * redrawn. Does nothing until `setSeries` has given the series.
   */
  pushSeries(key: string, bar: FeedBar): void;
  /** Last run-time failure, if any. */
  error: Diagnostic | null;
  /**
   * Change inputs: those in `partial` take their value, the others keep theirs, and the keys in `reset` go back to the
   * script's defaults (colour inputs included). Outside series the script was given stay.
   */
  setInputs(partial: Readonly<Record<string, InputValue>>, reset?: readonly string[]): void;
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
  if (!opts.runner && !opts.workerFactory) throw new Error("runScript needs a workerFactory or a runner: the package does not guess where its worker lives");
  const runner = opts.runner ?? new ScriptRunner(opts.workerFactory!, opts.limits);
  const colorKeys = new Set(r.colorInputs.map((c) => c.key));
  const schema: Record<string, InputValue> = {};
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (colorKeys.has(k)) colors[k] = String(v);
    else schema[k] = v;
  }
  const feeds = feedsOf(r.plan.dependencies);
  if (feeds.length > 0 && !(opts.intervalMs! > 0)) throw new TypeError("this script reads outside series: pass options.intervalMs, the length of one bar of the chart, in milliseconds");
  const feedRef = new Map(feeds.map((f) => [f.key, f]));
  const loaded = new Set<string>();
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
    feeds,
    setSeries(key, bars) {
      const f = feedRef.get(key);
      if (!f) throw new RangeError(`this script reads no outside series "${key}" (it reads: ${feeds.map((x) => JSON.stringify(x.key)).join(", ") || "none"})`);
      study!.setFeed(key, bars, alignFor(f.timeframe, opts.intervalMs!));
      loaded.add(key);
      study!.ready().catch(report);
    },
    pushSeries(key, bar) {
      if (!feedRef.has(key)) throw new RangeError(`this script reads no outside series "${key}"`);
      if (!loaded.has(key)) return;
      study!.pushFeedBar(key, bar);
    },
    get error() { return handleRef.error; },
    set error(v) { handleRef.error = v; },
    setInputs(partial, reset = []) {
      const rest: Record<string, InputValue> = {};
      for (const k of reset) {
        const c = r.colorInputs.find((x) => x.key === k);
        if (c) { colors[k] = c.default; colorOf(k, c.default); }
      }
      for (const [k, v] of Object.entries(partial)) {
        if (colorKeys.has(k)) { colors[k] = String(v); colorOf(k, String(v)); } else rest[k] = v;
      }
      const dropped = reset.filter((k) => !colorKeys.has(k));
      if (Object.keys(rest).length > 0 || dropped.length > 0) { handleRef.error = null; study!.setInputs(rest, dropped); study!.ready().catch(report); }
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
export function restoreScript(chart: Chart, saved: SavedScript, opts: RunScriptOptions): ScriptHandle {
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
