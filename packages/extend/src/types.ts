// The adapter model: what a host hands the chart to add a tool. An adapter is a manifest plus one of four
// kinds of payload. Everything an adapter returns is untrusted: the registry and the helpers here check it
// before it reaches the chart, and say what was wrong.

import type { Bar, NewDrawing, ToolDef } from "@alphacharts/drawings";
import type { StudyDef } from "@alphacharts/indicators";

/**
 * What an adapter asks for. The host lists what it grants (`createAdapterRegistry({ allow })`) and an adapter
 * asking for more is refused at registration.
 * - `bars`: the chart's bars are put in the context an analysis or an assistant receives. Enforced here:
 *   without it `ctx.bars` is absent.
 * - `network`: the adapter's own code talks to a server. This package cannot enforce it (the adapter's code
 *   runs in the host's page); it is declared so a host can show it to the user before they add the tool.
 */
export type Permission = "bars" | "network";

export interface AdapterManifest {
  /** Lower-case words joined by `-` or `.`, e.g. `acme.regime`. Every tool and study id the adapter defines starts with `<id>.`. */
  readonly id: string;
  /** Semantic version of the adapter, `1.2.3`. */
  readonly version: string;
  /** Shown to the user. */
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly Permission[];
}

/** Drawing tools. Each `ToolDef` id starts with `<manifest.id>.`. */
export interface DrawingAdapter {
  readonly kind: "drawing";
  readonly manifest: AdapterManifest;
  readonly tools: readonly ToolDef[];
}

/** Studies. Each `StudyDef` id starts with `<manifest.id>.`. */
export interface StudyAdapter {
  readonly kind: "study";
  readonly manifest: AdapterManifest;
  readonly studies: readonly StudyDef[];
}

export interface AnalysisContext {
  readonly symbol: string;
  /** Bar length in milliseconds. */
  readonly interval: number;
  /** Present only when the adapter has the `bars` permission. */
  readonly bars?: readonly Bar[];
  readonly signal: AbortSignal;
}

/** Drawings an analysis wants on the chart (regression bands, regime boxes, levels). */
export interface AnalysisResult {
  readonly drawings: readonly NewDrawing[];
}

/** Runs something over the chart's data and draws the answer back with the chart's own drawing tools. */
export interface AnalysisAdapter {
  readonly kind: "analysis";
  readonly manifest: AdapterManifest;
  run(ctx: AnalysisContext): Promise<AnalysisResult>;
}

export interface AssistantRequest {
  /** What the user typed. */
  readonly prompt: string;
  readonly symbol: string;
  readonly interval: number;
  /** Present only when the adapter has the `bars` permission. */
  readonly bars?: readonly Bar[];
  /** After a failed attempt: the script it wrote and what the compiler said, so it can repair it. */
  readonly previous?: { readonly script: string; readonly diagnostics: readonly AssistantDiagnostic[] };
  readonly signal: AbortSignal;
}

export interface AssistantDiagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  /** 1-based. */
  readonly line: number;
  readonly column: number;
}

export interface AssistantReply {
  /** A script in the `@alphacharts/script` language. */
  readonly script: string;
  /** One or two sentences for the user: what the script draws. */
  readonly explanation?: string;
}

/**
 * Turns a request in the user's words into a script. The model, the vendor and the endpoint are the host's:
 * this package has none. The script is compiled by the host's compiler before anything is attached, and
 * failures go back through `request.previous` for a bounded number of repairs (`runAssistant`).
 */
export interface AssistantAdapter {
  readonly kind: "assistant";
  readonly manifest: AdapterManifest;
  generate(request: AssistantRequest): Promise<AssistantReply>;
}

export type ToolAdapter = DrawingAdapter | StudyAdapter | AnalysisAdapter | AssistantAdapter;
export type AdapterKind = ToolAdapter["kind"];
