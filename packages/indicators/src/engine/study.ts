// Running a study definition: parameter validation, the streaming engine and
// the one-shot batch function the worker uses.

import { Graph, SOURCE_NAMES, type Col } from "./graph.js";
import type { BarColumns, BarInput, InputDef, InputValue, Params, StudyDef } from "../types.js";

/** Validate `given` against the study's inputs and fill defaults. Throws on anything unknown or out of range. */
export function resolveParams(def: StudyDef, given: Readonly<Record<string, InputValue>> = {}): Params {
  const out: Record<string, InputValue> = {};
  const known = new Set(def.inputs.map((i) => i.key));
  for (const k of Object.keys(given)) if (!known.has(k)) throw new RangeError(`${def.id}: unknown input "${k}" (known: ${[...known].join(", ") || "none"})`);
  for (const inp of def.inputs) {
    const v = given[inp.key] ?? inp.default;
    checkInput(def.id, inp, v);
    out[inp.key] = v;
  }
  return out;
}

function checkInput(id: string, inp: InputDef, v: InputValue): void {
  const where = `${id}.${inp.key}`;
  switch (inp.type) {
    case "int":
    case "float": {
      if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`${where}: expected a finite number, got ${String(v)}`);
      if (inp.type === "int" && !Number.isInteger(v)) throw new RangeError(`${where}: expected an integer, got ${v}`);
      if (inp.min !== undefined && v < inp.min) throw new RangeError(`${where}: ${v} is below the minimum ${inp.min}`);
      if (inp.max !== undefined && v > inp.max) throw new RangeError(`${where}: ${v} is above the maximum ${inp.max}`);
      return;
    }
    case "bool":
      if (typeof v !== "boolean") throw new TypeError(`${where}: expected a boolean, got ${String(v)}`);
      return;
    case "source":
    case "select": {
      const opts = inp.type === "source" ? (inp.options ?? SOURCE_NAMES) : inp.options;
      if (typeof v !== "string" || !opts?.includes(v)) throw new RangeError(`${where}: "${String(v)}" is not one of ${opts?.join(", ") ?? "(none)"}`);
    }
  }
}

/** A study bound to parameters and a graph: appends, revises and batch-loads bars. */
export class StudyEngine {
  readonly graph: Graph;
  readonly outputs: readonly Col[];
  readonly params: Params;

  constructor(readonly def: StudyDef, params: Readonly<Record<string, InputValue>> = {}) {
    this.params = resolveParams(def, params);
    this.graph = new Graph();
    this.outputs = def.build(this.graph, this.params);
    if (this.outputs.length !== def.columns.length) throw new Error(`${def.id}: build returned ${this.outputs.length} columns, declared ${def.columns.length}`);
  }

  get length(): number {
    return this.graph.n;
  }

  /** Replace all bars and compute. */
  load(d: BarColumns): void {
    const g = this.graph;
    const n = d.time.length;
    this.requireColumns(d);
    g.clear();
    g.reserve(n);
    g.time.v.set(d.time);
    g.close.v.set(d.close);
    if (d.open) g.open.v.set(d.open);
    if (d.high) g.high.v.set(d.high);
    if (d.low) g.low.v.set(d.low);
    if (d.volume) g.volume.v.set(d.volume);
    g.n = n;
    g.run(0, n);
  }

  /**
   * Like `load`, but evaluates in chunks of `chunk` bars and awaits `pause()`
   * between them, so a runner can service cancel messages. Stops quietly and
   * returns false when `cancelled()` turns true.
   */
  async loadChunked(d: BarColumns, chunk: number, pause: () => Promise<void>, cancelled: () => boolean): Promise<boolean> {
    const g = this.graph;
    const n = d.time.length;
    this.requireColumns(d);
    g.clear();
    g.reserve(n);
    g.time.v.set(d.time);
    g.close.v.set(d.close);
    if (d.open) g.open.v.set(d.open);
    if (d.high) g.high.v.set(d.high);
    if (d.low) g.low.v.set(d.low);
    if (d.volume) g.volume.v.set(d.volume);
    g.n = n;
    for (let a = 0; a < n; a += chunk) {
      if (cancelled()) return false;
      g.run(a, Math.min(n, a + chunk));
      await pause();
    }
    return !cancelled();
  }

  /** Append a bar (time later than the last). */
  push(b: BarInput): void {
    const g = this.graph;
    const i = g.n;
    if (i > 0 && !(b.time > g.time.v[i - 1]!)) throw new RangeError(`push: time ${b.time} is not after the last bar ${g.time.v[i - 1]}`);
    g.reserve(i + 1);
    this.write(i, b);
    g.n = i + 1;
    g.run(i, i + 1);
  }

  /** Replace the last bar (a tick revision). */
  reviseLast(b: BarInput): void {
    const g = this.graph;
    const i = g.n - 1;
    if (i < 0) throw new RangeError("reviseLast: no bars");
    if (b.time !== g.time.v[i]) throw new RangeError(`reviseLast: time ${b.time} differs from the last bar ${g.time.v[i]}`);
    this.write(i, b);
    g.run(i, i + 1);
  }

  /** Output column `k` as a view over the bars loaded (valid until the next push that grows the graph). */
  column(k: number): Float64Array {
    return this.outputs[k]!.v.subarray(0, this.graph.n);
  }

  private write(i: number, b: BarInput): void {
    const g = this.graph;
    g.time.v[i] = b.time;
    g.open.v[i] = b.open;
    g.high.v[i] = b.high;
    g.low.v[i] = b.low;
    g.close.v[i] = b.close;
    g.volume.v[i] = b.volume;
  }

  private requireColumns(d: BarColumns): void {
    const n = d.time.length;
    const need = this.def.needs;
    const chk = (name: string, a: Float64Array | undefined) => {
      if (!a) throw new TypeError(`${this.def.id} needs ${name} bars`);
      if (a.length !== n) throw new RangeError(`${this.def.id}: ${name} has ${a.length} rows, time has ${n}`);
    };
    chk("close", d.close);
    if (need !== "value") for (const k of ["open", "high", "low"] as const) chk(k, d[k]);
    if (need === "ohlcv") chk("volume", d.volume);
  }
}

/** One-shot: run a study over columns and return its output columns (copies, length n). */
export function runStudy(def: StudyDef, params: Readonly<Record<string, InputValue>>, d: BarColumns): Float64Array[] {
  const e = new StudyEngine(def, params);
  e.load(d);
  return e.outputs.map((c) => c.v.slice(0, e.length));
}
