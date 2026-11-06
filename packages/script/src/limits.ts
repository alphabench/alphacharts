// Resource limits. Every one is enforced with a diagnostic naming the limit; none degrades silently.

export interface Limits {
  /** Largest period / length a ta.* call or history offset may use. Matches the indicators' own maximum. */
  maxPeriod: number;
  /** Iterations of one `for` statement execution. */
  maxLoopIterations: number;
  /** Loop iterations in the evaluation of one bar (the count restarts every bar, so it does not depend on the history length). */
  maxSteps: number;
  /** Columns of the compiled graph (every named series, ta.* result and intermediate). */
  maxColumns: number;
  /** Bytes a script may hold: columns x bars x 8, counted three times (the worker keeps a copy, and a column grows by half when a bar is appended). */
  maxBytes: number;
  /** Bars a script runs over. */
  maxBars: number;
  /** Nodes of the syntax tree / source length: refuses pathological inputs before they are parsed. */
  maxSourceChars: number;
  /** Distinct outside series (symbol and timeframe pairs) a script may read. Each is held twice (worker and page), in six columns of its own length. */
  maxFeeds: number;
  /** Wall-clock budget of one batch in the worker before it is terminated, milliseconds. */
  batchMs: number;
  /** Wall-clock budget of one tick, milliseconds. */
  tickMs: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxPeriod: 5000,
  maxLoopIterations: 10_000,
  maxSteps: 2_000_000,
  maxColumns: 512,
  maxBytes: 512 * 1024 * 1024,
  maxBars: 10_000_000,
  maxFeeds: 8,
  maxSourceChars: 200_000,
  batchMs: 8000,
  tickMs: 1000,
});

/** Largest history offset `x[n]`. */
export const MAX_HISTORY = 1_000_000;
