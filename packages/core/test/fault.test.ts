import { afterEach, describe, expect, it, vi } from "vitest";
import { emitFault, onFault, type Fault } from "../src/fault.js";
import * as internal from "../src/internal.js";
import * as index from "../src/index.js";

describe("fault emitter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is exposed through internal only", () => {
    expect(internal.onFault).toBe(onFault);
    expect("onFault" in index).toBe(false);
  });

  it("CORE_VERSION matches package.json and is exposed through internal", async () => {
    const pkg = (await import("../package.json" as string)) as { default: { version: string } };
    expect(internal.CORE_VERSION).toBe(pkg.default.version);
    expect("CORE_VERSION" in index).toBe(false);
  });

  it("has no listener until one subscribes, and unsubscribes", () => {
    const seen: Fault[] = [];
    emitFault({ source: "ctor", error: new Error("x") });
    const off = onFault((f) => seen.push(f));
    emitFault({ source: "ctor", error: 1 });
    off();
    emitFault({ source: "ctor", error: 2 });
    expect(seen.map((f) => f.error)).toEqual([1]);
  });

  it("a throwing listener changes nothing", () => {
    const off = onFault(() => { throw new Error("listener"); });
    expect(() => emitFault({ source: "ctor", error: 1 })).not.toThrow();
    off();
  });

  it("the scheduler emits the first failure and still rethrows it", async () => {
    let cb: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => ((cb = f), 1));
    const { requestRender } = await import("../src/chart/scheduler.js");
    const seen: Fault[] = [];
    const off = onFault((f) => seen.push(f));
    const first = new Error("boom");
    requestRender({ render: () => { throw first; } }, 1);
    requestRender({ render: () => { throw new Error("second"); } }, 1);
    expect(() => cb!(0)).toThrow(first);
    off();
    expect(seen).toEqual([{ source: "draw-loop", error: first }]);
  });
});
