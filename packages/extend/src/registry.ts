// The adapter registry: the one door third-party tools come through.

import type { ToolDef } from "@alphacharts/drawings";
import { validateDef, type StudyDef } from "@alphacharts/indicators";
import { AdapterError } from "./error.js";
import type { AdapterKind, AssistantAdapter, ToolAdapter, Permission } from "./types.js";

const ID = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const PERMISSIONS: readonly Permission[] = ["bars", "network"];
const KINDS: readonly AdapterKind[] = ["drawing", "study", "analysis", "assistant"];

export interface AdapterRegistryOptions {
  /** What the host grants. An adapter that asks for anything else is refused. Default: none. */
  readonly allow?: readonly Permission[];
  /** Tool ids and study ids the host already has (the built-in ones). An adapter's ids are prefixed, so this only guards a manifest id that equals one. */
  readonly reserved?: ReadonlySet<string>;
}

export interface AdapterRegistry {
  /** Adapters live as long as the page: there is no unregister, because the shell and the study registry keep what they were given. Throws `AdapterError` when the adapter is invalid, asks for a permission the host did not grant, or reuses an id. */
  register(adapter: ToolAdapter): void;
  get(id: string): ToolAdapter | undefined;
  list(kind?: AdapterKind): ToolAdapter[];
  /** Every drawing tool of every drawing adapter, to pass as the shell's or the plugin's `tools` next to the built-in ones. */
  tools(): ToolDef[];
  /** Every study of every study adapter. */
  studies(): StudyDef[];
  assistants(): AssistantAdapter[];
  /** Whether the host granted the adapter the chart's bars, as checked at register(). Pass it as `allowBars` to the runners. */
  mayReadBars(id: string): boolean;
}

export function createAdapterRegistry(options: AdapterRegistryOptions = {}): AdapterRegistry {
  const allow = new Set(options.allow ?? []);
  // What was checked at register() is what is served: the manifest's permissions and the tool and study lists are copied then,
  // so an adapter cannot widen its grant or add an id afterwards by mutating what it passed.
  const adapters = new Map<string, ToolAdapter>();
  const frozen = new Map<string, { permissions: readonly Permission[]; tools: readonly ToolDef[]; studies: readonly StudyDef[] }>();

  function check(a: ToolAdapter): void {
    const m = a?.manifest;
    const id = typeof m?.id === "string" ? m.id : "(no id)";
    const fail = (msg: string): never => { throw new AdapterError(id, msg); };
    if (!m || typeof m !== "object") fail("has no manifest");
    if (typeof m.id !== "string" || !ID.test(m.id)) fail(`id must be lower-case words joined by "-" or ".", got ${JSON.stringify(m.id)}`);
    if (typeof m.version !== "string" || !SEMVER.test(m.version)) fail(`version must be like 1.2.3, got ${JSON.stringify(m.version)}`);
    if (typeof m.name !== "string" || !m.name.trim()) fail("name is empty");
    if (!Array.isArray(m.permissions)) fail("permissions must be an array");
    for (const p of m.permissions) {
      if (!PERMISSIONS.includes(p)) fail(`unknown permission ${JSON.stringify(p)}`);
      if (!allow.has(p)) fail(`asks for permission "${p}", which this host did not grant`);
    }
    if (!KINDS.includes(a.kind)) fail(`unknown kind ${JSON.stringify((a as { kind?: unknown }).kind)}`);
    if (options.reserved?.has(m.id)) fail("id is reserved");
    if (adapters.has(m.id)) fail("is already registered");

    const prefix = `${m.id}.`;
    const own = (what: string, x: string): void => {
      if (typeof x !== "string" || !x.startsWith(prefix) || x.length === prefix.length) fail(`${what} id ${JSON.stringify(x)} must start with "${prefix}"`);
      if (options.reserved?.has(x)) fail(`${what} id "${x}" is reserved`);
      for (const other of adapters.values()) {
        if (other.kind === "drawing" && other.tools.some((t) => t.id === x)) fail(`${what} id "${x}" is already defined by "${other.manifest.id}"`);
        if (other.kind === "study" && other.studies.some((s) => s.id === x)) fail(`${what} id "${x}" is already defined by "${other.manifest.id}"`);
      }
    };
    switch (a.kind) {
      case "drawing": {
        if (!Array.isArray(a.tools) || !a.tools.length) fail("has no tools");
        const seen = new Set<string>();
        for (const t of a.tools) {
          own("tool", t?.id);
          if (seen.has(t.id)) fail(`tool "${t.id}" is defined twice`);
          seen.add(t.id);
          if (typeof t.label !== "string" || !t.label || typeof t.defaults !== "function" || typeof t.shapes !== "function") fail(`tool "${t.id}" is not a ToolDef (needs label, defaults and shapes)`);
        }
        break;
      }
      case "study": {
        if (!Array.isArray(a.studies) || !a.studies.length) fail("has no studies");
        const seen = new Set<string>();
        for (const s of a.studies) {
          own("study", s?.id);
          if (seen.has(s.id)) fail(`study "${s.id}" is defined twice`);
          seen.add(s.id);
          if (typeof s.build !== "function") fail(`study "${s.id}" has no build()`);
          if (!Array.isArray(s.columns) || !Array.isArray(s.plots) || !Array.isArray(s.inputs)) fail(`study "${s.id}" needs columns, plots and inputs arrays`);
          try { validateDef(s); } catch (e) { throw new AdapterError(m.id, e instanceof Error ? e.message : String(e), { cause: e }); }
        }
        break;
      }
      case "analysis": if (typeof a.run !== "function") fail("has no run()"); break;
      case "assistant": if (typeof a.generate !== "function") fail("has no generate()"); break;
    }
  }

  const of = <K extends AdapterKind>(kind: K) => [...adapters.values()].filter((a): a is Extract<ToolAdapter, { kind: K }> => a.kind === kind);
  return {
    register(a) {
      check(a);
      adapters.set(a.manifest.id, a);
      frozen.set(a.manifest.id, {
        permissions: Object.freeze([...a.manifest.permissions]),
        tools: Object.freeze(a.kind === "drawing" ? [...a.tools] : []),
        studies: Object.freeze(a.kind === "study" ? [...a.studies] : []),
      });
    },
    get: (id) => adapters.get(id),
    list: (kind) => [...adapters.values()].filter((a) => !kind || a.kind === kind),
    tools: () => [...frozen.values()].flatMap((f) => [...f.tools]),
    studies: () => [...frozen.values()].flatMap((f) => [...f.studies]),
    assistants: () => of("assistant"),
    mayReadBars: (id) => frozen.get(id)?.permissions.includes("bars") ?? false,
  };
}
