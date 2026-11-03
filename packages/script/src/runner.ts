// Main-thread side of the script sandbox: a StudyRunner the indicators package
// can use (batch runs in the worker) plus the tick channel (one bar in, that
// bar's output values back). Owns the watchdog: a worker that does not answer
// within the budget is terminated and replaced, and the failure is reported.

import { CancelledError, type BarColumns, type BarInput, type RunRequest, type RunResult, type StudyDef, type StudyRunner, type WorkerLike } from "@alphacharts/indicators";
import { ScriptError } from "./diag.js";
import { DEFAULT_LIMITS, type Limits } from "./limits.js";
import type { ErrorInfo, FromWorker, ToWorker } from "./sandbox.js";

export interface ScriptInfo { sid: number; source: string }

export interface TickListener {
  values(index: number, values: Float64Array): void;
  error(e: ScriptError): void;
}

const toError = (e: ErrorInfo): ScriptError => new ScriptError(e.message, e.from !== undefined ? { from: e.from, to: e.to ?? e.from } : null, e.kind === "compile" ? "build" : e.kind);

export class ScriptRunner implements StudyRunner {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private nextSid = 1;
  private readonly infos = new WeakMap<StudyDef, ScriptInfo>();
  private readonly pending = new Map<number, { resolve(r: RunResult): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> | undefined }>();
  private readonly listeners = new Map<number, TickListener>();
  private tickTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Instances whose computed state died with a terminated worker: their bars are not sent until a new batch result. */
  private readonly dead = new Set<number>();
  private limits: Limits;
  private disposed = false;

  constructor(private readonly factory: () => WorkerLike, limits: Partial<Limits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Change budgets for later requests. */
  setLimits(l: Partial<Limits>): void {
    this.limits = { ...this.limits, ...l };
  }

  /** Bind a (mirror) definition to a script instance. Returns the instance id. */
  attach(def: StudyDef, source: string, listener: TickListener): number {
    const sid = this.nextSid++;
    this.infos.set(def, { sid, source });
    this.listeners.set(sid, listener);
    return sid;
  }

  detach(sid: number): void {
    this.listeners.delete(sid);
    this.dead.delete(sid);
    this.clearTick(sid);
    this.post({ type: "dispose", sid });
  }

  canRun(def: StudyDef): boolean {
    return this.infos.has(def);
  }

  private ensure(): WorkerLike {
    if (this.disposed) throw new ScriptError("the script runner was disposed");
    if (!this.worker) {
      const w = this.factory();
      w.addEventListener("message", (e) => this.onMessage(e.data as FromWorker));
      w.addEventListener("error", (e) => this.fail(new ScriptError(`script worker failed: ${e.message ?? "unknown error"}`, null, "runtime")));
      this.worker = w;
    }
    return this.worker;
  }

  private post(m: ToWorker, transfer: Transferable[] = []): void {
    if (this.disposed) return;
    if (m.type === "dispose" && !this.worker) return;
    this.ensure().postMessage(m, transfer);
  }

  run(def: StudyDef, req: RunRequest) {
    const info = this.infos.get(def);
    if (!info) return { promise: Promise.reject(new ScriptError("not a script study")), cancel: () => {} };
    const id = this.nextId++;
    this.dead.delete(info.sid);
    const b = req.bars as BarColumns;
    const promise = new Promise<RunResult>((resolve, reject) => {
      const timer = setTimeout(() => this.timeout(id, `the script did not finish within ${this.limits.batchMs} ms and was terminated`), this.limits.batchMs);
      this.pending.set(id, { resolve, reject, timer });
      const transfer = [b.time, b.close, b.open, b.high, b.low, b.volume].filter((a): a is Float64Array => !!a).map((a) => a.buffer);
      try {
        this.post({ type: "run", id, sid: info.sid, source: info.source, params: req.params, bars: b, limits: this.limits }, transfer);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    return { promise, cancel: () => { this.post({ type: "cancel", id }); this.settle(id)?.reject(new CancelledError()); } };
  }

  /** Send one bar of a tick (append or revision) to the script instance. */
  sendBar(sid: number, index: number, bar: BarInput): void {
    if (!this.listeners.has(sid) || this.dead.has(sid)) return;
    // a tick queued behind another script's batch is not slow because of its own script: no timer then
    if (!this.tickTimers.has(sid) && this.pending.size === 0) {
      this.tickTimers.set(sid, setTimeout(() => {
        this.tickTimers.delete(sid);
        this.terminateWorker(new ScriptError(`a tick took longer than ${this.limits.tickMs} ms; the script was terminated`, null, "budget"));
      }, this.limits.tickMs));
    }
    this.post({ type: "bar", sid, index, bar });
  }

  private clearTick(sid: number): void {
    const t = this.tickTimers.get(sid);
    if (t !== undefined) clearTimeout(t);
    this.tickTimers.delete(sid);
  }

  private settle(id: number) {
    const p = this.pending.get(id);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(id);
    return p;
  }

  private onMessage(m: FromWorker): void {
    switch (m.type) {
      case "result": this.settle(m.id)?.resolve({ n: m.n, buffers: m.buffers }); return;
      case "cancelled": this.settle(m.id)?.reject(new CancelledError()); return;
      case "error": this.settle(m.id)?.reject(toError(m.error)); return;
      case "values": {
        this.clearTick(m.sid);
        this.listeners.get(m.sid)?.values(m.index, m.values);
        return;
      }
      case "tick-error": this.clearTick(m.sid); this.listeners.get(m.sid)?.error(toError(m.error)); return;
    }
  }

  private timeout(id: number, message: string): void {
    const p = this.settle(id);
    if (!p) return;
    p.reject(new ScriptError(message, null, "budget"));
    this.terminateWorker(new ScriptError(message, null, "budget"));
  }

  /**
   * Kill the worker. Every instance lost its computed state with it: each one is told, and stops
   * sending bars until it is run again (a new batch, e.g. after an input change).
   */
  private terminateWorker(reason?: ScriptError): void {
    this.worker?.terminate();
    this.worker = null;
    const err = reason ?? new ScriptError("the script worker was terminated", null, "budget");
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(err);
    for (const t of this.tickTimers.values()) clearTimeout(t);
    this.tickTimers.clear();
    for (const [sid, l] of this.listeners) {
      if (this.dead.has(sid)) continue;
      this.dead.add(sid);
      l.error(err);
    }
  }

  private fail(e: ScriptError): void {
    this.terminateWorker(e);
  }

  dispose(): void {
    this.terminateWorker();
    this.disposed = true;
    this.listeners.clear();
  }
}

/** The default worker: dist/worker.js next to this module (a bundler rewrites the URL). */
export function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL("./sandbox-worker.js", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}
