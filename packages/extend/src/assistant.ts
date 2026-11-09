// Running an assistant adapter: ask, compile, and send the compiler's complaints back for a bounded repair.

import { AdapterError } from "./error.js";
import type { AssistantAdapter, AssistantDiagnostic, AssistantReply, AssistantRequest } from "./types.js";

/** What the host's compiler says about a script (`@alphacharts/script`'s `compile` fits after a small wrapper). */
export type CompileCheck = (script: string) => { ok: true } | { ok: false; diagnostics: readonly AssistantDiagnostic[] };

export interface RunAssistantOptions {
  /** The host's compiler. A script is never returned without passing it. */
  readonly compile: CompileCheck;
  /** Repairs after the first attempt. Default 2, at most 5. */
  readonly maxRepairs?: number;
  /** A reply longer than this is refused. Default 200 000 characters, the script language's own limit. */
  readonly maxScriptLength?: number;
  /** The chart's bars, put in the request only when `allowBars` is true. */
  readonly bars?: AssistantRequest["bars"];
  /** The host's grant of the `bars` permission, e.g. `registry.mayReadBars(id)`. The adapter's own manifest is never consulted. */
  readonly allowBars?: boolean;
  readonly signal: AbortSignal;
}

export interface AssistantRun extends AssistantReply {
  /** Calls to `generate`, the first one included. */
  readonly attempts: number;
}

/** The script failed to compile on every attempt; `diagnostics` is what the last attempt got wrong. */
export class AssistantFailed extends AdapterError {
  override readonly name = "AssistantFailed";
  constructor(adapter: string, readonly attempts: number, readonly diagnostics: readonly AssistantDiagnostic[]) {
    super(adapter, `no script that compiles after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${diagnostics[0] ? `${diagnostics[0].line}:${diagnostics[0].column} ${diagnostics[0].message}` : "unknown"}`);
  }
}

export async function runAssistant(
  adapter: AssistantAdapter,
  request: { prompt: string; symbol: string; interval: number },
  options: RunAssistantOptions,
): Promise<AssistantRun> {
  const id = adapter.manifest.id;
  if (!request.prompt.trim()) throw new AdapterError(id, "the prompt is empty");
  const repairs = Math.min(5, Math.max(0, Math.trunc(options.maxRepairs ?? 2)));
  const maxLen = options.maxScriptLength ?? 200_000;
  if (options.bars && !options.allowBars) throw new AdapterError(id, "was given bars without the host granting the bars permission");
  let previous: AssistantRequest["previous"];
  let last: readonly AssistantDiagnostic[] = [];
  for (let attempt = 1; attempt <= repairs + 1; attempt++) {
    options.signal.throwIfAborted();
    let reply: AssistantReply;
    try {
      reply = await adapter.generate({ ...request, ...(options.bars ? { bars: options.bars } : {}), ...(previous ? { previous } : {}), signal: options.signal });
    } catch (e) {
      if (options.signal.aborted) throw e;
      throw new AdapterError(id, `generate() failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    if (typeof reply?.script !== "string" || !reply.script.trim()) throw new AdapterError(id, "replied without a script");
    if (reply.script.length > maxLen) throw new AdapterError(id, `script is ${reply.script.length} characters; the limit is ${maxLen}`);
    if (reply.explanation !== undefined && typeof reply.explanation !== "string") throw new AdapterError(id, "explanation must be text");
    const r = options.compile(reply.script);
    if (r.ok) return { script: reply.script, ...(reply.explanation !== undefined ? { explanation: reply.explanation } : {}), attempts: attempt };
    last = r.diagnostics;
    previous = { script: reply.script, diagnostics: r.diagnostics };
  }
  throw new AssistantFailed(id, repairs + 1, last);
}
