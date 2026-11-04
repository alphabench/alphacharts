import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitFault } from "../../core/src/fault.js";
import { CORE_VERSION } from "../../core/src/version.js";
import { enableCrashReporting, errorForwarder, plotErrorForwarder, reportError, VERSION } from "../src/index.js";

interface Sent {
  url: string;
  body: any;
  raw: string;
}
let sent: Sent[];
let disable: (() => void) | null;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function stubTransport(): void {
  sent = [];
  vi.stubGlobal("navigator", {
    userAgent: UA,
    sendBeacon: (url: string, blob: Blob) => {
      // Blob content is read synchronously in tests through a captured copy.
      sent.push({ url, body: blob, raw: "" });
      return true;
    },
  });
}

async function bodies(): Promise<Sent[]> {
  return Promise.all(sent.map(async (s) => {
    const raw = typeof s.body === "string" ? s.body : await (s.body as Blob).text();
    return { url: s.url, raw, body: JSON.parse(raw) };
  }));
}

const opts = { endpoint: "https://crash.example.test/batch", key: "phc_test" };

beforeEach(stubTransport);
afterEach(() => {
  disable?.();
  disable = null;
  vi.unstubAllGlobals();
});

describe("off by default", () => {
  it("importing sends nothing and a fault with nobody enabled is ignored", () => {
    emitFault({ source: "ctor", error: new Error("x") });
    reportError(new Error("x"), "plot");
    expect(sent).toEqual([]);
  });

  it("there is no default server: a missing, empty or non-string endpoint or key throws and sends nothing", () => {
    const fetched: unknown[] = [];
    vi.stubGlobal("fetch", (...a: unknown[]) => (fetched.push(a), Promise.resolve({})));
    expect(() => enableCrashReporting({} as never)).toThrow(/endpoint/);
    expect(() => enableCrashReporting(undefined as never)).toThrow(/endpoint/);
    expect(() => enableCrashReporting({ endpoint: "https://x.test" } as never)).toThrow(/key/);
    expect(() => enableCrashReporting({ endpoint: "", key: "k" })).toThrow(/endpoint/);
    expect(() => enableCrashReporting({ endpoint: "https://x.test", key: "" })).toThrow(/key/);
    emitFault({ source: "ctor", error: new Error("x") });
    expect(sent).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("ignores context-restored (a recovery, not a fault) but clears context_lost", async () => {
    disable = enableCrashReporting(opts);
    emitFault({ source: "context-lost", error: undefined });
    emitFault({ source: "context-restored", error: undefined });
    emitFault({ source: "ctor", error: new Error("x") });
    const got = await bodies();
    expect(got.map((s) => s.body.batch[0].properties.source)).toEqual(["context-lost", "ctor"]);
    expect(got[1]!.body.batch[0].properties.context_lost).toBe(false);
  });

  it("version constant matches package.json", async () => {
    const pkg = (await import("../package.json" as string)) as { default: { version: string } };
    expect(VERSION).toBe(pkg.default.version);
  });
});

describe("payload", () => {
  it("is an allow-list: no message, price or symbol leaks", async () => {
    disable = enableCrashReporting(opts);
    const e = new TypeError("bad bar for RELIANCE at 2987.55 in series s-42");
    e.stack = `TypeError: bad bar for RELIANCE at 2987.55 in series s-42\n    at drawBar (https://app.test/assets/chunk-ab12.js:1:2345)\n    at https://app.test/assets/main-cd34.js:9:8\nwidth@https://app.test/x/y.mjs?v=2:1:1\nRELIANCE 2987.55 secret.js:1:1`;
    emitFault({ source: "draw-loop", error: e });
    const [s] = await bodies();
    expect(s!.url).toBe(opts.endpoint);
    expect(s!.body.api_key).toBe("phc_test");
    const ev = s!.body.batch[0];
    expect(ev.event).toBe("$exception");
    expect(ev.distinct_id).toMatch(/^[0-9a-f-]{20,}$/i);
    expect(ev.properties).toEqual({
      project: "alphacharts",
      version: CORE_VERSION,
      report_version: VERSION,
      error_type: "TypeError",
      source: "draw-loop",
      webgl2: false,
      context_lost: false,
      browser: "Chrome 126",
      os: "macOS",
      $exception_list: [
        { type: "TypeError", value: "alphacharts fault: draw-loop" },
      ],
      $process_person_profile: false,
      $geoip_disable: true,
    });
    for (const leak of ["RELIANCE", "2987", "s-42", "bad bar", "drawBar", "app.test", "chunk-ab12", "secret.js", "stacktrace", "filename"]) expect(s!.raw).not.toContain(leak);
  });

  it("no frame or message text ever appears, even when the message imitates a frame", async () => {
    disable = enableCrashReporting(opts);
    const e = new Error("fake\n    at x (evil-RELIANCE.js:1:1)");
    e.stack = `Error: ${e.message}\n    at real (https://a.test/ok.js:2:3)`;
    emitFault({ source: "ctor", error: e });
    const [s] = await bodies();
    for (const leak of ["evil", "RELIANCE", "ok.js", "a.test", "stacktrace", "frames"]) expect(s!.raw).not.toContain(leak);
    expect(s!.body.batch[0].properties.$exception_list).toEqual([{ type: "Error", value: "alphacharts fault: ctor" }]);
  });

  it("context events carry renderer and track context_lost; a non-Error is NonError", async () => {
    disable = enableCrashReporting(opts);
    emitFault({ source: "context-lost", error: undefined, renderer: "webgl" });
    emitFault({ source: "ctor", error: "price 100" });
    const b = await bodies();
    expect(b[0]!.body.batch[0].properties).toMatchObject({ source: "context-lost", renderer: "webgl", context_lost: true, error_type: "None" });
    expect(b[1]!.body.batch[0].properties).toMatchObject({ error_type: "NonError", context_lost: true });
    expect(b[1]!.raw).not.toContain("price");
  });

  it("an error name that could carry data is replaced", async () => {
    disable = enableCrashReporting(opts);
    const e = new Error("m");
    e.name = "RELIANCE 2987.55";
    emitFault({ source: "ctor", error: e });
    expect((await bodies())[0]!.raw).not.toContain("RELIANCE");
  });

  it("an unknown source is dropped", async () => {
    disable = enableCrashReporting(opts);
    emitFault({ source: "RELIANCE" as never, error: new Error("x") });
    expect(sent).toEqual([]);
  });
});

describe("dedupe and cap", () => {
  it("sends one report per identical fault and the same error object once", async () => {
    disable = enableCrashReporting(opts);
    const e = new Error("a");
    e.stack = "Error: a\n    at f (https://a.test/x.js:1:1)";
    emitFault({ source: "draw-loop", error: e });
    emitFault({ source: "shader", error: e });
    emitFault({ source: "draw-loop", error: new Error("b") }); // same class + source
    expect(sent).toHaveLength(1);
    emitFault({ source: "draw-loop", error: new TypeError("c") }); // new class
    expect(sent).toHaveLength(2);
  });

  it("stops at maxReports", () => {
    disable = enableCrashReporting({ ...opts, maxReports: 2 });
    for (const source of ["draw-loop", "shader", "ctor", "context-lost"] as const) emitFault({ source, error: new Error("x") });
    expect(sent).toHaveLength(2);
  });
});

describe("transport", () => {
  it("falls back to fetch with keepalive when sendBeacon refuses", () => {
    const calls: any[] = [];
    vi.stubGlobal("navigator", { userAgent: UA, sendBeacon: () => false });
    vi.stubGlobal("fetch", (url: string, init: any) => (calls.push([url, init]), Promise.resolve({})));
    disable = enableCrashReporting(opts);
    emitFault({ source: "ctor", error: new Error("x") });
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
  });

  it("swallows every transport failure", async () => {
    vi.stubGlobal("navigator", { userAgent: UA, sendBeacon: () => { throw new Error("no"); } });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    disable = enableCrashReporting(opts);
    expect(() => emitFault({ source: "ctor", error: new Error("x") })).not.toThrow();
    vi.stubGlobal("navigator", { userAgent: UA, sendBeacon: () => false });
    const e = new Error("y");
    e.stack = "Error: y\n    at f (https://a.test/y.js:1:1)";
    expect(() => emitFault({ source: "shader", error: e })).not.toThrow();
    await Promise.resolve();
  });
});

describe("disable", () => {
  it("removes the listener", () => {
    const off = enableCrashReporting(opts);
    off();
    emitFault({ source: "ctor", error: new Error("x") });
    reportError(new Error("x"), "plot");
    expect(sent).toEqual([]);
  });

  it("a second enable replaces the first", () => {
    enableCrashReporting(opts);
    disable = enableCrashReporting(opts);
    emitFault({ source: "ctor", error: new Error("x") });
    expect(sent).toHaveLength(1);
  });
});

describe("adapters", () => {
  it("forward the error and a source, never the second argument", async () => {
    disable = enableCrashReporting(opts);
    const drawing = { id: "d-1", tool: "trendline", points: [{ time: 1, price: 2987.55 }] };
    const e = new RangeError("x");
    e.stack = "RangeError: x\n    at f (https://a.test/d.js:1:1)";
    const seen: unknown[][] = [];
    const fwd = errorForwarder("drawings", (...a: unknown[]) => void seen.push(a));
    (fwd as (e: Error, d: unknown) => void)(e, drawing);
    expect(seen).toEqual([[e]]);
    const [s] = await bodies();
    expect(s!.body.batch[0].properties.source).toBe("drawings");
    expect(s!.raw).not.toContain("2987");
    expect(s!.raw).not.toContain("d-1");
    expect(errorForwarder("drawings").length).toBe(1);
  });

  it("plot error forwarder reports the error and passes the event on", () => {
    disable = enableCrashReporting(opts);
    const got: unknown[] = [];
    const e = new Error("x");
    e.stack = "Error: x\n    at f (https://a.test/p.js:1:1)";
    plotErrorForwarder((ev) => got.push(ev))({ error: e });
    expect(got).toEqual([{ error: e }]);
    expect(sent).toHaveLength(1);
  });

  it("do nothing but chain when reporting is off", () => {
    let called = 0;
    errorForwarder("feed", () => called++)(new Error("x"));
    expect(called).toBe(1);
    expect(sent).toEqual([]);
  });
});
