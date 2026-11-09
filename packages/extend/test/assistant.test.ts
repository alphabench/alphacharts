import { compile } from "@alphacharts/script";
import { describe, expect, it } from "vitest";
import { AdapterError, AssistantFailed, runAssistant, type AssistantAdapter, type AssistantReply, type AssistantRequest, type CompileCheck } from "../src/index.js";
import { manifest } from "./fixtures.js";

const signal = () => new AbortController().signal;
const req = { prompt: "sma 20", symbol: "X", interval: 60_000 };
const failing: CompileCheck = () => ({ ok: false, diagnostics: [{ severity: "error", message: "bad", line: 1, column: 2 }] });
const adapter = (generate: (r: AssistantRequest) => Promise<AssistantReply>, perms: readonly ("bars" | "network")[] = []): AssistantAdapter => ({ kind: "assistant", manifest: manifest("nl", perms), generate });

describe("runAssistant", () => {
  it("returns the first script that compiles", async () => {
    const out = await runAssistant(adapter(async () => ({ script: "ok", explanation: "e" })), req, { compile: () => ({ ok: true }), signal: signal() });
    expect(out).toEqual({ script: "ok", explanation: "e", attempts: 1 });
  });

  it("sends the compiler's complaints back and returns the repaired script", async () => {
    const seen: Array<AssistantRequest["previous"]> = [];
    const gen = async (r: AssistantRequest) => { seen.push(r.previous); return { script: seen.length === 1 ? "broken" : "fixed" }; };
    const out = await runAssistant(adapter(gen), req, { compile: (s) => (s === "fixed" ? { ok: true } : failing(s)), signal: signal() });
    expect(out).toEqual({ script: "fixed", attempts: 2 });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toEqual({ script: "broken", diagnostics: [{ severity: "error", message: "bad", line: 1, column: 2 }] });
  });

  it("stops after maxRepairs and says what the last attempt got wrong; never returns a script that did not compile", async () => {
    let calls = 0;
    const p = runAssistant(adapter(async () => ({ script: `s${++calls}` })), req, { compile: failing, maxRepairs: 1, signal: signal() });
    await expect(p).rejects.toBeInstanceOf(AssistantFailed);
    await expect(p).rejects.toThrow(/after 2 attempts: 1:2 bad/);
    expect(calls).toBe(2);
  });

  it("caps repairs at five whatever is asked", async () => {
    let calls = 0;
    await expect(runAssistant(adapter(async () => ({ script: `s${++calls}` })), req, { compile: failing, maxRepairs: 99, signal: signal() })).rejects.toBeInstanceOf(AssistantFailed);
    expect(calls).toBe(6);
  });

  it("refuses an empty prompt, an empty or oversize script, and a non-text explanation, without calling the compiler", async () => {
    const never: CompileCheck = () => { throw new Error("compiled"); };
    const run = (reply: unknown, prompt = "p") => runAssistant(adapter(async () => reply as AssistantReply), { ...req, prompt }, { compile: never, maxScriptLength: 5, signal: signal() });
    await expect(run({ script: "x" }, "  ")).rejects.toThrow(/prompt is empty/);
    await expect(run({ script: " " })).rejects.toThrow(/without a script/);
    await expect(run({})).rejects.toThrow(/without a script/);
    await expect(run({ script: "123456" })).rejects.toThrow(/limit is 5/);
    await expect(run({ script: "ok", explanation: 3 })).rejects.toThrow(/explanation/);
  });

  it("wraps a throwing adapter, and lets an abort through untouched", async () => {
    await expect(runAssistant(adapter(async () => { throw new Error("quota"); }), req, { compile: failing, signal: signal() })).rejects.toThrow(/generate\(\) failed: quota/);
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(runAssistant(adapter(async () => ({ script: "x" })), req, { compile: failing, signal: ac.signal })).rejects.toThrow("stop");
  });

  it("gives bars only to an adapter that has the permission", async () => {
    const bars = [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
    let got: AssistantRequest | undefined;
    const gen = async (r: AssistantRequest) => { got = r; return { script: "ok" }; };
    await runAssistant(adapter(gen, ["bars"]), req, { compile: () => ({ ok: true }), bars, allowBars: true, signal: signal() });
    expect(got?.bars).toBe(bars);
    // The host's grant decides, not what the adapter says about itself.
    await expect(runAssistant(adapter(gen, ["bars"]), req, { compile: () => ({ ok: true }), bars, signal: signal() })).rejects.toBeInstanceOf(AdapterError);
    await runAssistant(adapter(gen), req, { compile: () => ({ ok: true }), signal: signal() });
    expect(got && "bars" in got).toBe(false);
  });

  it("works with the real script compiler: a broken script is repaired from its diagnostics", async () => {
    const real: CompileCheck = (s) => { const r = compile(s); return r.ok ? { ok: true } : { ok: false, diagnostics: r.diagnostics }; };
    const good = 'indicator("EMA of close")\nlen = input.int(20, "Length")\nplot(ta.ema(close, len))';
    let n = 0;
    const out = await runAssistant(adapter(async (r) => (++n === 1 ? { script: "this is not a script" } : (expect(r.previous?.diagnostics.length).toBeGreaterThan(0), { script: good }))), req, { compile: real, signal: signal() });
    expect(out.attempts).toBe(2);
    expect(compile(out.script).ok).toBe(true);
  });
});
