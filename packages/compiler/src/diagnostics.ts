// Compiler diagnostics — structured errors, warnings, and timing.

export type Severity = "error" | "warning" | "info";

export interface SourceLocation {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

export interface Diagnostic {
  severity: Severity;
  code: string;        // e.g. "E001", "W003" — stable, greppable
  message: string;     // human-readable description
  span: SourceSpan | null;
  hint?: string;       // actionable suggestion for the user
}

export interface StageTiming {
  stage: string;
  durationMs: number;
}

export interface CompileDiagnostics {
  diagnostics: Diagnostic[];
  timings: StageTiming[];
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
