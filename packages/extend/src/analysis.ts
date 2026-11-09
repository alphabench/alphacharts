// Running an analysis adapter: its drawings are checked as a whole before any reaches the chart.

import type { Bar, Drawing, DrawingsPlugin } from "@alphacharts/drawings";
import { AdapterError } from "./error.js";
import type { AnalysisAdapter, AnalysisResult } from "./types.js";

export interface RunAnalysisOptions {
  readonly drawings: DrawingsPlugin;
  readonly symbol: string;
  readonly interval: number;
  /** The chart's bars, given to the adapter only when `allowBars` is true. */
  readonly bars?: readonly Bar[];
  /** The host's grant of the `bars` permission, e.g. `registry.mayReadBars(id)`. The adapter's own manifest is never consulted. */
  readonly allowBars?: boolean;
  /** At most this many drawings per run. Default 500. */
  readonly maxDrawings?: number;
  readonly signal: AbortSignal;
}

/**
 * An analysis adapter as the shell's `analyses` option wants it: it runs the adapter with the host's grant of the bars
 * and hands back the drawings (the shell adds them as one undo step). `allowBars` is the host's grant, e.g.
 * `registry.mayReadBars(id)`; an adapter that asks for bars without it is refused at the first run.
 */
export function analysisEntry(adapter: AnalysisAdapter, o: { allowBars: boolean; id?: string }): {
  id: string; name: string;
  run(request: { symbol: string; interval: number; bars: readonly Bar[]; signal: AbortSignal }): Promise<{ drawings: AnalysisResult["drawings"] }>;
} {
  const id = adapter.manifest.id;
  return {
    id: o.id ?? id,
    name: adapter.manifest.name,
    async run({ symbol, interval, bars, signal }) {
      if (bars.length && !o.allowBars && adapter.manifest.permissions.includes("bars")) throw new AdapterError(id, "asks for the chart's bars and the host did not grant them");
      try {
        const r = await adapter.run({ symbol, interval, ...(o.allowBars ? { bars } : {}), signal });
        if (!Array.isArray(r?.drawings)) throw new AdapterError(id, "run() must return { drawings: [...] }");
        return { drawings: r.drawings };
      } catch (e) {
        if (signal.aborted || e instanceof AdapterError) throw e;
        throw new AdapterError(id, `run() failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    },
  };
}

/**
 * Run the adapter and add its drawings as one undo step: all are added or none (`DrawingsPlugin.addMany`). The drawings go
 * through the plugin's own validation, so an analysis can never put on the chart what a user could not draw.
 */
export async function runAnalysis(adapter: AnalysisAdapter, options: RunAnalysisOptions): Promise<Drawing[]> {
  const id = adapter.manifest.id;
  if (options.bars && !options.allowBars) throw new AdapterError(id, "was given bars without the host granting the bars permission");
  let result;
  try {
    result = await adapter.run({ symbol: options.symbol, interval: options.interval, ...(options.bars ? { bars: options.bars } : {}), signal: options.signal });
  } catch (e) {
    if (options.signal.aborted) throw e;
    throw new AdapterError(id, `run() failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  options.signal.throwIfAborted();
  const specs = result?.drawings;
  if (!Array.isArray(specs)) throw new AdapterError(id, "run() must return { drawings: [...] }");
  const max = options.maxDrawings ?? 500;
  if (specs.length > max) throw new AdapterError(id, `returned ${specs.length} drawings; the limit is ${max}`);
  try {
    return options.drawings.addMany(specs);
  } catch (e) {
    throw new AdapterError(id, e instanceof Error ? e.message : String(e), { cause: e });
  }
}
