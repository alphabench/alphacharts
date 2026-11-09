import { describe, expect, it } from "vitest";
import { AdapterError, createAdapterRegistry, type ToolAdapter } from "../src/index.js";
import { manifest, studyAs, toolAs } from "./fixtures.js";

const drawing = (id: string, tools = [toolAs(`${id}.line`)], m = manifest(id)): ToolAdapter => ({ kind: "drawing", manifest: m, tools });

describe("register", () => {
  it("collects the tools, studies and assistants of what it holds", () => {
    const r = createAdapterRegistry();
    r.register(drawing("acme"));
    r.register({ kind: "study", manifest: manifest("acme-studies"), studies: [studyAs("acme-studies.fast")] });
    r.register({ kind: "assistant", manifest: manifest("nl"), generate: async () => ({ script: "x" }) });
    expect(r.tools().map((t) => t.id)).toEqual(["acme.line"]);
    expect(r.studies().map((s) => s.id)).toEqual(["acme-studies.fast"]);
    expect(r.assistants().map((a) => a.manifest.id)).toEqual(["nl"]);
    expect(r.list("study")).toHaveLength(1);
  });

  it("refuses a bad manifest, naming the problem", () => {
    const r = createAdapterRegistry();
    expect(() => r.register(drawing("Acme"))).toThrow(/lower-case/);
    expect(() => r.register({ ...drawing("a"), manifest: { ...manifest("a"), version: "1" } } as ToolAdapter)).toThrow(/version/);
    expect(() => r.register({ ...drawing("a"), manifest: { ...manifest("a"), name: " " } } as ToolAdapter)).toThrow(/name is empty/);
    expect(() => r.register({ kind: "oracle", manifest: manifest("a") } as unknown as ToolAdapter)).toThrow(/unknown kind/);
    expect(() => r.register(undefined as unknown as ToolAdapter)).toThrow(AdapterError);
  });

  it("refuses a duplicate adapter id", () => {
    const r = createAdapterRegistry();
    r.register(drawing("acme"));
    expect(() => r.register(drawing("acme"))).toThrow(/already registered/);
  });

  it("refuses a permission the host did not grant, and accepts it once granted", () => {
    const m = manifest("acme", ["bars"]);
    expect(() => createAdapterRegistry().register(drawing("acme", [toolAs("acme.line")], m))).toThrow(/did not grant/);
    expect(() => createAdapterRegistry({ allow: ["bars"] }).register(drawing("acme", [toolAs("acme.line")], m))).not.toThrow();
    expect(() => createAdapterRegistry({ allow: ["bars"] }).register(drawing("acme", [toolAs("acme.line")], manifest("acme", ["root" as never])))).toThrow(/unknown permission/);
  });

  it("makes every tool and study id start with the adapter id, so two adapters cannot collide with each other or the built-ins", () => {
    const r = createAdapterRegistry();
    expect(() => r.register(drawing("acme", [toolAs("trendLine")]))).toThrow(/must start with "acme\."/);
    expect(() => r.register(drawing("acme", [toolAs("other.line")]))).toThrow(/must start with/);
    expect(() => r.register(drawing("acme", [toolAs("acme.")]))).toThrow(/must start with/);
    expect(() => r.register({ kind: "study", manifest: manifest("acme"), studies: [studyAs("sma")] })).toThrow(/must start with/);
    expect(() => r.register(drawing("acme", [toolAs("acme.a"), toolAs("acme.a")]))).toThrow(/defined twice/);
    expect(r.list()).toEqual([]);
  });

  it("refuses a reserved id", () => {
    const r = createAdapterRegistry({ reserved: new Set(["acme"]) });
    expect(() => r.register(drawing("acme"))).toThrow(/reserved/);
  });

  it("refuses a tool that is not a ToolDef and a study whose columns do not match its plots", () => {
    const r = createAdapterRegistry();
    expect(() => r.register(drawing("acme", [{ id: "acme.x", label: "x" } as never]))).toThrow(/not a ToolDef/);
    const bad = { ...studyAs("acme.s"), plots: [{ key: "k", title: "k", kind: "line" as const, col: "nope", color: "#fff" }] };
    expect(() => r.register({ kind: "study", manifest: manifest("acme"), studies: [bad] })).toThrow(/unknown column "nope"/);
  });

  it("refuses empty payloads and adapters without their method", () => {
    const r = createAdapterRegistry();
    expect(() => r.register({ kind: "drawing", manifest: manifest("a"), tools: [] })).toThrow(/no tools/);
    expect(() => r.register({ kind: "study", manifest: manifest("b"), studies: [] })).toThrow(/no studies/);
    expect(() => r.register({ kind: "analysis", manifest: manifest("c") } as unknown as ToolAdapter)).toThrow(/no run/);
    expect(() => r.register({ kind: "assistant", manifest: manifest("d") } as unknown as ToolAdapter)).toThrow(/no generate/);
  });

  it("serves what was checked at register(): mutating the adapter afterwards widens nothing", () => {
    const r = createAdapterRegistry({ allow: ["bars"] });
    const tools = [toolAs("acme.line")];
    const perms: Array<"bars" | "network"> = [];
    r.register({ kind: "drawing", manifest: { ...manifest("acme"), permissions: perms }, tools });
    perms.push("bars");
    tools.push(toolAs("trendLine"));
    expect(r.mayReadBars("acme")).toBe(false);
    expect(r.tools().map((t) => t.id)).toEqual(["acme.line"]);
  });

  it("refuses a study with no build() or without its arrays", () => {
    const r = createAdapterRegistry();
    expect(() => r.register({ kind: "study", manifest: manifest("acme"), studies: [{ ...studyAs("acme.s"), build: undefined as never }] })).toThrow(/no build/);
    expect(() => r.register({ kind: "study", manifest: manifest("acme"), studies: [{ ...studyAs("acme.s"), plots: undefined as never }] })).toThrow(/arrays/);
  });

  it("mayReadBars follows the manifest", () => {
    const r = createAdapterRegistry({ allow: ["bars"] });
    r.register({ kind: "analysis", manifest: manifest("a", ["bars"]), run: async () => ({ drawings: [] }) });
    r.register({ kind: "analysis", manifest: manifest("b"), run: async () => ({ drawings: [] }) });
    expect([r.mayReadBars("a"), r.mayReadBars("b"), r.mayReadBars("zzz")]).toEqual([true, false, false]);
  });
});
