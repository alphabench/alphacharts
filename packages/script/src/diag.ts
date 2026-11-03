// Diagnostics: every problem in a script is a Diagnostic with a source range,
// reported as line:column (1-based) and as character offsets for editors.

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  /** 1-based. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  /** Character offsets into the source, `to` exclusive. */
  from: number;
  to: number;
}

export interface Span {
  from: number;
  to: number;
}

/** Converts offsets to line:column for one source text. */
export class LineMap {
  private readonly starts: number[] = [0];
  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  at(offset: number): { line: number; column: number } {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo]! + 1 };
  }
}

/** Collects diagnostics; stops accepting errors after `max` (the last one says so). */
export class Reporter {
  readonly list: Diagnostic[] = [];
  private readonly map: LineMap;
  private errors = 0;
  constructor(text: string, private readonly max = 50) {
    this.map = new LineMap(text);
  }
  get errorCount(): number {
    return this.errors;
  }
  error(message: string, span: Span): void {
    this.add("error", message, span);
  }
  warn(message: string, span: Span): void {
    this.add("warning", message, span);
  }
  private add(severity: "error" | "warning", message: string, span: Span): void {
    if (this.errors > this.max) return;
    if (severity === "error") {
      this.errors++;
      if (this.errors > this.max) message = `too many errors; stopped after ${this.max}`;
    }
    const to = Math.max(span.to, span.from);
    const a = this.map.at(span.from), b = this.map.at(to);
    this.list.push({ severity, message, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, from: span.from, to });
  }
}

/** Thrown for failures found while building or running a script, with the range of the offending code. */
export class ScriptError extends Error {
  constructor(message: string, readonly span: Span | null = null, readonly kind: "build" | "runtime" | "budget" = "build") {
    super(message);
    this.name = "ScriptError";
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.line}:${d.column}: ${d.severity}: ${d.message}`;
}
