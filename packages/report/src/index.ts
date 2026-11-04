// Opt-in, anonymous crash reports. Nothing happens at import: no listener, no
// timer, no network. enableCrashReporting() subscribes to the core's fault
// emitter and sends a fixed set of fields to the endpoint the host names. There is no default endpoint.
//
// Never sent: error messages, option/data/series/plugin/marker ids, symbols,
// prices, GPU strings, stack text, file names. No global
// window.onerror / unhandledrejection handler is installed.

import { CORE_VERSION, onFault, type Fault } from "@alphacharts/core/internal";

export const VERSION = "0.1.0";

export type ReportSource = Fault["source"] | "plot" | "drawings" | "alerts" | "feed";

export interface CrashReportingOptions {
  /** Full URL that accepts a PostHog capture batch (POST); no path is appended. Required: there is no default. */
  endpoint: string;
  /** The project's public capture key (it can only write events). Required. */
  key: string;
  /** Most reports sent per page load (default 5). */
  maxReports?: number | undefined;
}

const SOURCES: ReadonlySet<string> = new Set(["draw-loop", "ctor", "context-lost", "shader", "plot", "drawings", "alerts", "feed"]);

interface Active {
  report(error: unknown, source: ReportSource, renderer?: "webgl" | "canvas2d"): void;
}
let active: Active | null = null;
let stop: (() => void) | null = null;
let pageId = "";

/** Start reporting. Returns the function that stops it. A missing, empty or non-string endpoint or key throws: nothing is sent unless the host names where. */
export function enableCrashReporting(options: CrashReportingOptions): () => void {
  const endpoint = options?.endpoint;
  const key = options?.key;
  if (typeof endpoint !== "string" || endpoint === "") throw new TypeError("alphacharts report: endpoint is required (the full URL of your PostHog capture endpoint)");
  if (typeof key !== "string" || key === "") throw new TypeError("alphacharts report: key is required (your PostHog project's public capture key)");
  stop?.(); // a second call replaces the first
  const cap = Math.max(0, Math.floor(options.maxReports ?? 5));
  const seenKeys = new Set<string>();
  const seenErrors = new WeakSet<object>();
  let sent = 0;
  let contextLost = false;

  const self: Active = {
    report(error, source, renderer) {
      try {
        if (source === "context-restored") {
          contextLost = false; // a recovery, not a fault: tracked, never sent
          return;
        }
        if (!SOURCES.has(source)) return;
        // One failure can reach two entry points (a shader error inside a frame).
        if (typeof error === "object" && error !== null) {
          if (seenErrors.has(error)) return;
          seenErrors.add(error);
        }
        if (source === "context-lost") contextLost = true;
        const props = properties(error, source, renderer, contextLost);
        const dedupeKey = `${source}|${props.error_type}`;
        if (seenKeys.has(dedupeKey) || sent >= cap) return;
        seenKeys.add(dedupeKey);
        sent++;
        send(endpoint, key, props);
      } catch {
        // reporting must never change what the page does
      }
    },
  };
  active = self;
  const off = onFault((f) => self.report(f.error, f.source, f.renderer));
  const disable = (): void => {
    off();
    if (active === self) active = null;
    if (stop === disable) stop = null;
  };
  stop = disable;
  return disable;
}

/** Forwards an error to the reporter if one is enabled. Only the error and a source name leave the caller. */
export function reportError(error: unknown, source: "plot" | "drawings" | "alerts" | "feed"): void {
  active?.report(error, source);
}

/** For `DrawingsOptions.onError`, `AlertsOptions.onError`, `FeedOptions.onError`. Uses only the first argument, never the drawing. */
export function errorForwarder(source: "drawings" | "alerts" | "feed", next?: (error: unknown) => void): (error: unknown) => void {
  return (error) => {
    reportError(error, source);
    next?.(error);
  };
}

/** For `plot.on("error", ...)`. */
export function plotErrorForwarder(next?: (e: { error: unknown }) => void): (e: { error: unknown }) => void {
  return (e) => {
    reportError(e.error, "plot");
    next?.(e);
  };
}

// ---- payload -----------------------------------------------------------------

function properties(error: unknown, source: string, renderer: "webgl" | "canvas2d" | undefined, contextLost: boolean): Record<string, unknown> {
  const errorType = nameOf(error);
  const { browser, os } = agent();
  const props: Record<string, unknown> = {
    project: "alphacharts",
    version: CORE_VERSION, // the core that faulted, not this package
    report_version: VERSION,
    error_type: errorType,
    source,
    webgl2: typeof WebGL2RenderingContext !== "undefined",
    context_lost: contextLost,
    browser,
    os,
    // No message and no stack: PostHog groups by class + source. The value is built from the source allow-list only.
    $exception_list: [{ type: errorType, value: `alphacharts fault: ${source}` }],
    $process_person_profile: false,
    $geoip_disable: true,
  };
  if (renderer) props.renderer = renderer;
  return props;
}

function nameOf(error: unknown): string {
  const n = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (typeof n === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(n)) return n;
  return error === undefined ? "None" : error instanceof Error ? "Error" : "NonError";
}

function agent(): { browser: string; os: string } {
  const ua = typeof navigator !== "undefined" && typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  const pick = (re: RegExp, name: string): string | null => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  const browser =
    pick(/Edg\/(\d+)/, "Edge") ?? pick(/OPR\/(\d+)/, "Opera") ?? pick(/(?:Firefox|FxiOS)\/(\d+)/, "Firefox") ?? pick(/(?:Chrome|CriOS)\/(\d+)/, "Chrome") ?? pick(/Version\/(\d+)[^]*Safari/, "Safari") ?? "other";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "other";
  return { browser, os };
}

// ---- transport ---------------------------------------------------------------

function uuid(): string {
  if (pageId) return pageId;
  const c = (globalThis as { crypto?: Crypto }).crypto;
  pageId = c?.randomUUID ? c.randomUUID() : Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10).padEnd(8, "0")).join("-");
  return pageId;
}

function send(endpoint: string, key: string, properties: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({ api_key: key, batch: [{ event: "$exception", distinct_id: uuid(), properties }] });
    // text/plain keeps the request CORS-simple: no preflight.
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav && typeof nav.sendBeacon === "function" && nav.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))) return;
    if (typeof fetch === "function") {
      fetch(endpoint, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "content-type": "text/plain" } }).catch(() => {});
    }
  } catch {
    // ignore every transport failure
  }
}
