// Running a study's batch computation off the UI thread.
//
// Protocol (structured clone; the arrays are transferred, never copied):
//   main -> worker  { type: "run", id, studyId, params, bars }   bars: BarColumns
//                   { type: "cancel", id }
//   worker -> main  { type: "result", id, n, buffers }           every graph column, in registration order
//                   { type: "cancelled", id }
//                   { type: "error", id, message }
// The worker evaluates in chunks and yields between them, so a cancel message
// is serviced within one chunk. Only built-in studies (looked up by id in the
// worker's own registry) run in a worker; a study defined at runtime does not
// exist there, so `createRunner` callers use InlineRunner for it (`canRun`).

import { StudyEngine } from "./engine/study.js";
import type { BarColumns, InputValue, StudyDef } from "./types.js";

export const CHUNK = 1 << 16;

export interface RunRequest {
  studyId: string;
  params: Readonly<Record<string, InputValue>>;
  /** Transferred to the runner when it is a worker: do not use afterwards. */
  bars: BarColumns;
}

export interface RunResult {
  n: number;
  /** All graph columns (inputs, state, outputs), in registration order. */
  buffers: Float64Array[];
}

export class CancelledError extends Error {
  constructor() {
    super("study run cancelled");
    this.name = "CancelledError";
  }
}

export interface StudyRunner {
  /** Whether this runner can evaluate `def` (a worker only knows built-ins). */
  canRun(def: StudyDef): boolean;
  /** Rejects with CancelledError when `cancel(handle)` is called first. */
  run(def: StudyDef, req: RunRequest): { promise: Promise<RunResult>; cancel(): void };
  dispose(): void;
}

const yieldNow = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Main-thread fallback: same chunked evaluation, same cancellation. */
export class InlineRunner implements StudyRunner {
  canRun(): boolean {
    return true;
  }
  run(def: StudyDef, req: RunRequest) {
    let cancelled = false;
    const promise = (async (): Promise<RunResult> => {
      const e = new StudyEngine(def, req.params);
      const done = await e.loadChunked(req.bars, CHUNK, yieldNow, () => cancelled);
      if (!done) throw new CancelledError();
      return { n: e.length, buffers: e.graph.cols.map((c) => c.v) };
    })();
    return { promise, cancel: () => void (cancelled = true) };
  }
  dispose(): void {}
}

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
  addEventListener(type: "error", fn: (e: { message?: string }) => void): void;
  terminate(): void;
}

type WorkerReply =
  | { type: "result"; id: number; n: number; buffers: Float64Array[] }
  | { type: "cancelled"; id: number }
  | { type: "error"; id: number; message: string };

/** Runs built-in studies in a Web Worker. `isBuiltin` says which ids the worker knows. */
export class WorkerRunner implements StudyRunner {
  private nextId = 1;
  /** Set once the worker has failed: later runs reject at once instead of waiting on a dead worker. */
  private dead: Error | null = null;
  private readonly pending = new Map<number, { resolve(r: RunResult): void; reject(e: Error): void }>();

  constructor(private readonly worker: WorkerLike, private readonly isBuiltin: (def: StudyDef) => boolean) {
    worker.addEventListener("message", (e) => {
      const m = e.data as WorkerReply;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === "result") p.resolve({ n: m.n, buffers: m.buffers });
      else if (m.type === "cancelled") p.reject(new CancelledError());
      else p.reject(new Error(`study worker: ${m.message}`));
    });
    worker.addEventListener("error", (e) => {
      const err = new Error(`study worker failed: ${e.message ?? "unknown error"}`);
      this.dead = err;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  canRun(def: StudyDef): boolean {
    return this.isBuiltin(def);
  }

  run(def: StudyDef, req: RunRequest) {
    if (this.dead) return { promise: Promise.reject(this.dead), cancel: () => {} };
    const id = this.nextId++;
    const promise = new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const b = req.bars;
      const transfer = [b.time, b.close, b.open, b.high, b.low, b.volume].filter((a): a is Float64Array => !!a).map((a) => a.buffer);
      this.worker.postMessage({ type: "run", id, studyId: def.id, params: req.params, bars: b }, transfer);
    });
    return { promise, cancel: () => this.worker.postMessage({ type: "cancel", id }) };
  }

  dispose(): void {
    this.worker.terminate();
    const err = new CancelledError();
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

/** Worker-side message handler: wire it to `self.onmessage` (see worker.ts). */
export function serveWorker(
  post: (msg: WorkerReply, transfer?: Transferable[]) => void,
  find: (id: string) => StudyDef | undefined,
): (data: unknown) => void {
  const cancelled = new Set<number>();
  return (data) => {
    const m = data as { type: string; id: number; studyId?: string; params?: Record<string, InputValue>; bars?: BarColumns };
    if (m.type === "cancel") {
      cancelled.add(m.id);
      return;
    }
    if (m.type !== "run") return;
    void (async () => {
      try {
        const def = find(m.studyId!);
        if (!def) throw new Error(`unknown study "${m.studyId}"`);
        const e = new StudyEngine(def, m.params ?? {});
        const done = await e.loadChunked(m.bars!, CHUNK, yieldNow, () => cancelled.has(m.id));
        if (!done) {
          post({ type: "cancelled", id: m.id });
          return;
        }
        const buffers = e.graph.cols.map((c) => c.v);
        post({ type: "result", id: m.id, n: e.length, buffers }, buffers.map((b) => b.buffer));
      } catch (err) {
        post({ type: "error", id: m.id, message: err instanceof Error ? err.message : String(err) });
      } finally {
        cancelled.delete(m.id);
      }
    })();
  };
}

/**
 * A worker runner on the worker `factory` creates, otherwise (no factory, or the worker would not start) the inline fallback.
 * The package never guesses where its worker lives: the host's bundler spells the URL out,
 * `() => new Worker(new URL("@alphacharts/indicators/worker", import.meta.url), { type: "module" })`.
 */
export function createRunner(builtinIds: ReadonlySet<string>, factory?: () => WorkerLike): StudyRunner {
  try {
    if (!factory) return new InlineRunner();
    return new WorkerRunner(factory(), (d) => builtinIds.has(d.id));
  } catch {
    return new InlineRunner();
  }
}
