// The sandbox that runs user scripts inside a dedicated Web Worker.
//
// Defence in depth, innermost first:
//  1. A script is never turned into JavaScript text: it is a tree of closures
//     built from its own syntax tree (codegen.ts), and the language has no way to
//     name `fetch`, `eval`, `self`, a prototype or any host object.
//  2. Budgets: loop iterations per batch (steps), columns, bytes, bars, period
//     and history size, all checked with a diagnostic naming the limit.
//  3. `lockdown` removes the host's network, storage, messaging and timing
//     capabilities from the worker global before any script is compiled, and
//     freezes the intrinsic prototypes.
//  4. The main thread terminates a worker that does not answer within the
//     batch / tick budget (runner.ts) and reports it.

import { StudyEngine, type BarColumns, type BarInput, type InputValue, type StudyDef } from "@alphacharts/indicators";
import { compile } from "./compile.js";
import { DEFAULT_LIMITS, type Limits } from "./limits.js";
import { ScriptError } from "./diag.js";

/** Host capabilities a script must not have: network, storage, other threads, message ports. */
export const BLOCKED_GLOBALS = [
  "fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "importScripts", "indexedDB", "caches",
  "BroadcastChannel", "SharedWorker", "Worker", "MessageChannel", "Request", "Response", "localStorage", "sessionStorage",
  "FileReader", "FileReaderSync", "Notification", "navigator", "location", "document", "window", "XMLHttpRequestUpload", "RTCPeerConnection",
] as const;

export interface LockdownReport {
  blocked: string[];
  missing: string[];
}

/** Shadow every blocked capability on `scope` with an undefined, non-configurable, read-only property. Idempotent. */
export function lockdown(scope: object = globalThis): LockdownReport {
  const blocked: string[] = [];
  const missing: string[] = [];
  for (const name of BLOCKED_GLOBALS) {
    try {
      Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false, enumerable: false });
      blocked.push(name);
    } catch {
      // already non-configurable: it is then either ours or the host's own; report it
      missing.push(name);
    }
  }
  const s = scope as { eval?: unknown; Math?: { random: unknown }; Date?: { now: unknown } };
  const refuse = (what: string) => () => { throw new Error(`${what} is not available to scripts`); };
  try { Object.defineProperty(scope, "eval", { value: refuse("eval"), writable: false, configurable: false }); } catch { missing.push("eval"); }
  if (s.Math) try { Object.defineProperty(s.Math, "random", { value: refuse("Math.random"), writable: false, configurable: false }); } catch { missing.push("Math.random"); }
  if (s.Date) try { Object.defineProperty(s.Date, "now", { value: refuse("Date.now"), writable: false, configurable: false }); } catch { missing.push("Date.now"); }
  const g = scope as Record<string, { prototype?: object } | undefined>;
  for (const k of ["Object", "Array", "Function", "String", "Number", "Boolean"]) {
    const proto = g[k]?.prototype;
    if (proto) Object.freeze(proto);
  }
  return { blocked, missing };
}

// ---- protocol -----------------------------------------------------------------------

export interface RunMsg { type: "run"; id: number; sid: number; source: string; params: Record<string, InputValue>; bars: BarColumns; limits?: Partial<Limits> }
export interface BarMsg { type: "bar"; sid: number; index: number; bar: BarInput }
export type ToWorker = RunMsg | BarMsg | { type: "cancel"; id: number } | { type: "dispose"; sid: number };

export interface ErrorInfo { message: string; from?: number; to?: number; kind: "build" | "runtime" | "budget" | "compile" }
export type FromWorker =
  | { type: "result"; id: number; n: number; buffers: Float64Array[] }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; error: ErrorInfo }
  | { type: "values"; sid: number; index: number; values: Float64Array }
  | { type: "tick-error"; sid: number; error: ErrorInfo };

const yieldNow = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const CHUNK = 1 << 16;

export function errorInfo(e: unknown): ErrorInfo {
  if (e instanceof ScriptError) return { message: e.message, ...(e.span && { from: e.span.from, to: e.span.to }), kind: e.kind };
  return { message: e instanceof Error ? e.message : String(e), kind: "build" };
}

/** A script's definition with one trailing node (the bridge the main thread listens on). */
export function withBridge(def: StudyDef, body?: (i: number) => void, mirror = false): StudyDef {
  return {
    ...def,
    build: (g, p) => {
      let target = g;
      if (mirror) {
        // main-thread mirror: same columns, nodes that compute nothing
        target = Object.create(g) as typeof g;
        (target as { node: unknown }).node = () => g.node(() => {});
      }
      const out = def.build(target, p);
      g.node((_s, from, to) => { if (body && to - from === 1) body(from); });
      return out;
    },
  };
}

/** Worker-side handler. `post` sends to the main thread. */
export function serveScripts(post: (m: FromWorker, transfer?: Transferable[]) => void): (data: unknown) => void {
  const engines = new Map<number, StudyEngine>();
  const cancelled = new Set<number>();
  const inflight = new Set<number>();
  /** Instances disposed while a batch was still running must not keep an engine. */
  const gone = new Set<number>();
  return (data) => {
    const m = data as ToWorker;
    switch (m.type) {
      case "cancel": if (inflight.has(m.id)) cancelled.add(m.id); return;
      case "dispose": engines.delete(m.sid); gone.add(m.sid); return;
      case "bar": {
        const e = engines.get(m.sid);
        if (!e) { post({ type: "tick-error", sid: m.sid, error: { message: "the script has no computed state in this worker (it was restarted); change an input to run it again", kind: "runtime" } }); return; }
        try {
          const n = e.length;
          const last = n > 0 ? e.graph.time.v[n - 1]! : Number.NaN;
          if (n > 0 && m.bar.time === last) e.reviseLast(m.bar);
          else e.push(m.bar);
          if (e.length - 1 !== m.index) throw new ScriptError(`out of sync with the chart: bar ${m.index} arrived with ${e.length} bars computed`);
          const values = new Float64Array(e.outputs.length);
          e.outputs.forEach((c, k) => (values[k] = c.v[m.index]!));
          post({ type: "values", sid: m.sid, index: m.index, values }, [values.buffer]);
        } catch (err) {
          post({ type: "tick-error", sid: m.sid, error: errorInfo(err) });
        }
        return;
      }
      case "run": {
        inflight.add(m.id);
        void (async () => {
          try {
            const limits = { ...DEFAULT_LIMITS, ...m.limits };
            const r = compile(m.source, limits);
            if (!r.ok) throw new ScriptError(r.diagnostics.map((d) => `${d.line}:${d.column}: ${d.message}`).join("; "));
            const n = m.bars.time.length;
            if (n > limits.maxBars) throw new ScriptError(`${n} bars exceed the limit of ${limits.maxBars}`, null, "budget");
            const e = new StudyEngine(withBridge(r.study), m.params);
            const bytes = e.graph.cols.length * n * 8 * 3;
            if (bytes > limits.maxBytes) throw new ScriptError(`the script needs ${(bytes / 2 ** 20).toFixed(0)} MiB (3 x ${e.graph.cols.length} columns x ${n} bars x 8); the limit is ${(limits.maxBytes / 2 ** 20).toFixed(0)} MiB`, null, "budget");
            const done = await e.loadChunked(m.bars, CHUNK, yieldNow, () => cancelled.has(m.id));
            if (!done) { post({ type: "cancelled", id: m.id }); return; }
            if (!gone.has(m.sid)) engines.set(m.sid, e);
            const buffers = e.graph.cols.map((c) => c.v.slice());
            post({ type: "result", id: m.id, n: e.length, buffers }, buffers.map((b) => b.buffer));
          } catch (err) {
            post({ type: "error", id: m.id, error: errorInfo(err) });
          } finally {
            cancelled.delete(m.id);
            inflight.delete(m.id);
          }
        })();
        return;
      }
    }
  };
}
