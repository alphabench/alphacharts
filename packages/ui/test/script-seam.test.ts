import { describe, expect, it } from "vitest";
import { ChartApp } from "../src/engine/app.js";

describe("script panel seam", () => {
  it("refuses an editor without a runner (a Run button that cannot run)", () => {
    const editor = { mount: () => ({ setDiagnostics() {}, destroy() {} }) };
    expect(() => new ChartApp({} as HTMLElement, { scriptEditor: editor } as never)).toThrow(/scriptEditor needs scriptRunner/);
  });
});

describe("assistant seam", () => {
  const ask = async () => ({ script: "x" });
  it("refuses an assistant without a runner (an Add button that cannot add)", () => {
    expect(() => new ChartApp({} as HTMLElement, { assistant: { ask } } as never)).toThrow(/assistant needs scriptRunner/);
  });

  /** The state machine only: the app without its chart, with the few members the methods touch. */
  function app(seam: (r: { prompt: string; symbol: string; interval: number; signal: AbortSignal }) => Promise<{ script: string; explanation?: string }>, diagnostics: Array<{ severity: string; message: string }> = []) {
    const a = Object.create(ChartApp.prototype) as Record<string, unknown> & ChartApp;
    const log = { ran: [] as string[], reported: [] as unknown[], closed: 0 };
    Object.assign(a, {
      options: { assistant: { ask: seam }, scriptRunner: {} },
      instances: [{ symbol: "NIFTY", interval: "5m" }],
      active: 0,
      assistant: { status: "idle" },
      assistantAbort: null,
      scriptDiagnostics: [],
      bump: () => {},
      t: (k: string) => k,
      announce: () => {},
      report: (e: unknown) => log.reported.push(e),
      closeDialog: () => { log.closed++; },
      execScript(code: string) { log.ran.push(code); (this as { scriptDiagnostics: unknown }).scriptDiagnostics = diagnostics; },
    });
    return { a, log };
  }

  it("asks with the active chart's symbol and the interval in milliseconds, and holds the script for review without running it", async () => {
    let got: { symbol: string; interval: number } | undefined;
    const { a, log } = app(async (r) => { got = r; return { script: "plot(close)", explanation: "the close" }; });
    await a.askAssistant("close");
    expect(got).toMatchObject({ symbol: "NIFTY", interval: 300_000 });
    expect(a.assistant).toMatchObject({ status: "ready", script: "plot(close)", explanation: "the close" });
    expect(log.ran).toEqual([]);
  });

  it("runs the script only on Add, and closes the dialog when it compiled", async () => {
    const { a, log } = app(async () => ({ script: "plot(close)" }));
    await a.askAssistant("close");
    a.addAssistantScript();
    expect(log.ran).toEqual(["plot(close)"]);
    expect(a.assistant).toEqual({ status: "idle" });
    expect(log.closed).toBe(1);
  });

  it("refuses to add on another chart than the one asked about", async () => {
    const { a, log } = app(async () => ({ script: "plot(close)" }));
    await a.askAssistant("close");
    (a as unknown as { instances: unknown[]; active: number }).instances.push({ symbol: "OTHER", interval: "1h" });
    (a as unknown as { active: number }).active = 1;
    a.addAssistantScript();
    expect(log.ran).toEqual([]);
    expect(a.assistant).toEqual({ status: "failed", message: "assistant.chartChanged" });
  });

  it("Add does not replace the script panel's text; Edit does, and remounts the panel", async () => {
    const { a } = app(async () => ({ script: "plot(close)" }));
    Object.assign(a, { scriptCode: "mine", scriptEpoch: 0 });
    Object.defineProperty(a, "hasScript", { value: true });
    await a.askAssistant("close");
    a.addAssistantScript();
    expect(a.scriptCode).toBe("mine");
    await a.askAssistant("close");
    a.editAssistantScript();
    expect(a.scriptCode).toBe("plot(close)");
    expect(a.scriptEpoch).toBe(1);
  });

  it("keeps the dialog open and shows the diagnostic when Add's run reports an error", async () => {
    const { a, log } = app(async () => ({ script: "bad" }), [{ severity: "error", message: "nope" }]);
    await a.askAssistant("x");
    a.addAssistantScript();
    expect(a.assistant).toEqual({ status: "failed", message: "nope" });
    expect(log.closed).toBe(0);
  });

  it("reports a rejection to the user and to onError, and refuses an empty script", async () => {
    const one = app(async () => { throw new Error("quota"); });
    await one.a.askAssistant("x");
    expect(one.a.assistant).toEqual({ status: "failed", message: "quota" });
    expect(one.log.reported).toHaveLength(1);
    const two = app(async () => ({ script: "  " }));
    await two.a.askAssistant("x");
    expect(two.a.assistant).toEqual({ status: "failed", message: "assistant.empty" });
  });

  it("a newer ask replaces one in flight, and a cancelled ask never lands", async () => {
    const releases: Array<() => void> = [];
    const { a } = app((r) => new Promise((res) => { releases.push(() => res({ script: r.prompt })); }));
    const first = a.askAssistant("first");
    const second = a.askAssistant("second");
    releases[0]!(); releases[1]!();
    await Promise.all([first, second]);
    expect(a.assistant).toMatchObject({ status: "ready", script: "second", explanation: null });
    const third = a.askAssistant("third");
    a.cancelAssistant();
    releases[2]!();
    await third;
    expect(a.assistant).toEqual({ status: "idle" });
  });
});
