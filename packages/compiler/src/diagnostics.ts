// Compiler diagnostics — structured errors, warnings, and timing.

export type Severity = "error" | "warning" | "info";

/** A precise position within source text, used to pinpoint diagnostic locations. */
export interface SourceLocation {
  /** Zero-based byte offset from the start of the source */
  offset: number;
  /** One-based line number */
  line: number;
  /** One-based column number within the line */
  column: number;
}

/** A contiguous range in source text, defined by a start and end location. */
export interface SourceSpan {
  /** Inclusive start of the span */
  start: SourceLocation;
  /** Exclusive end of the span */
  end: SourceLocation;
}

/** A single compiler diagnostic (error, warning, or info) with optional source location. */
export interface Diagnostic {
  /** Whether this is an error, warning, or informational message */
  severity: Severity;
  /** Stable, greppable code, e.g. "E001", "W003" */
  code: string;
  /** Human-readable description of the problem */
  message: string;
  /** Source range where the issue occurred, or null for whole-file diagnostics */
  span: SourceSpan | null;
  /** Actionable suggestion for the user on how to fix the issue */
  hint?: string;
}

/** Timing measurement for a single compiler pipeline stage. */
export interface StageTiming {
  /** Stage name, e.g. "splitter", "template-parser" */
  stage: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

/** Aggregated diagnostics and timing data from a full compilation run. */
export interface CompileDiagnostics {
  /** All diagnostics collected across every pipeline stage */
  diagnostics: Diagnostic[];
  /** Per-stage timing measurements */
  timings: StageTiming[];
  /** Total wall-clock duration of the entire compilation in milliseconds */
  totalMs: number;
}

/**
 * Convert an offset in source text to line/column.
 */
export function offsetToLocation(source: string, offset: number): SourceLocation {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { offset, line, column };
}

/**
 * Format a diagnostic for terminal display.
 */
export function formatDiagnostic(
  d: Diagnostic,
  source?: string,
  filename?: string,
): string {
  const prefix = d.severity === "error"
    ? "error"
    : d.severity === "warning"
      ? "warning"
      : "info";

  let loc = "";
  if (d.span) {
    const file = filename ?? "<input>";
    loc = ` --> ${file}:${d.span.start.line}:${d.span.start.column}`;
  }

  let out = `${prefix}[${d.code}]: ${d.message}${loc}`;

  if (d.span && source) {
    const lines = source.split("\n");
    const lineIdx = d.span.start.line - 1;
    if (lineIdx >= 0 && lineIdx < lines.length) {
      const lineText = lines[lineIdx];
      const lineNum = String(d.span.start.line).padStart(4);
      out += `\n${lineNum} | ${lineText}`;
      out += `\n     | ${" ".repeat(d.span.start.column - 1)}^`;
    }
  }

  if (d.hint) {
    out += `\n     = hint: ${d.hint}`;
  }

  return out;
}

/**
 * Format timing report for terminal display.
 */
export function formatTimings(timings: StageTiming[], totalMs: number): string {
  const lines = timings.map(
    (t) => `  ${t.stage.padEnd(20)} ${t.durationMs.toFixed(1)}ms`,
  );
  lines.push(`  ${"total".padEnd(20)} ${totalMs.toFixed(1)}ms`);
  return lines.join("\n");
}

/**
 * Generic output shape shared by every compiler stage.
 * The `output` field carries stage-specific extracted data (may be partial on failure).
 * `diagnostics` contains warnings only when `ok: true`; at least one error when `ok: false`.
 */
export interface StageOutput<T> {
  /** Stage-specific extracted data (may be partial on failure) */
  output: T;
  /** Warnings only when ok: true; at least one error when ok: false */
  diagnostics: Diagnostic[];
}

/**
 * Create a diagnostic.
 */
export function createDiagnostic(
  severity: Severity,
  code: string,
  message: string,
  span: SourceSpan | null,
  hint?: string,
): Diagnostic {
  return { severity, code, message, span, hint };
}

/**
 * Measure the duration of a stage.
 */
export function timeStage<T>(
  stage: string,
  fn: () => T,
): { result: T; timing: StageTiming } {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, timing: { stage, durationMs } };
}
