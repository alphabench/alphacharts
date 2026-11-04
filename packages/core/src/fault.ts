// Fault emitter for the opt-in @alphacharts/report package. Exposed only through
// "@alphacharts/core/internal". With no listener an emit is one size check.

export type FaultSource = "draw-loop" | "ctor" | "context-lost" | "context-restored" | "shader";
export interface Fault {
  source: FaultSource;
  /** The thrown value; undefined for context events. */
  error: unknown;
  renderer?: "webgl" | "canvas2d";
}

const listeners = new Set<(f: Fault) => void>();

export function onFault(fn: (f: Fault) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function emitFault(f: Fault): void {
  for (const fn of [...listeners]) {
    try {
      fn(f);
    } catch {
      // a listener must never change what the chart does
    }
  }
}
