// @ease/compiler — public API

export { split, SplitError, SplitDiagnostics } from "./splitter.js";
export type { RawBlock, SplitResult } from "./splitter.js";

export { parseTemplate, ParseDiagnostics } from "./template-parser.js";
export type {
  ParseResult,
  ParseData,
  ParseFailure,
  TemplateNode,
  TextNode,
  InterpolationNode,
  ElementNode,
  AttrNode,
  DirectiveNode,
  SlotNode,
} from "./template-parser.js";

export {
  success,
  failure,
  emptySuccess,
  unwrap,
} from "@ease/shared";
export type {
  Result,
  ResultSuccess,
  ResultFailure,
  EmptyResult,
} from "@ease/shared";

export { analyzeScript } from "./script-analyzer.js";
export type {
  ScriptAnalysis,
  StateField,
  ActionInfo,
} from "./script-analyzer.js";

export { resolveBindings } from "./binding-resolver.js";
export type { Binding, ResolvedComponent } from "./binding-resolver.js";

export { generateServer } from "./codegen/server.js";
export type { ServerOutput } from "./codegen/server.js";

export { generateClient } from "./codegen/client.js";
export type { ClientOutput } from "./codegen/client.js";

export {
  formatDiagnostic,
  formatTimings,
  createDiagnostic,
  offsetToLocation,
  timeStage,
} from "./diagnostics.js";
export type {
  Diagnostic,
  Severity,
  SourceLocation,
  SourceSpan,
  StageTiming,
  CompileDiagnostics,
} from "./diagnostics.js";

import type { SplitResult } from "./splitter.js";
import type { ServerOutput } from "./codegen/server.js";
import type { ClientOutput } from "./codegen/client.js";
import type { CompileDiagnostics } from "./diagnostics.js";

export interface CompileResult {
  split: SplitResult;
  server: ServerOutput;
  client: ClientOutput;
  diagnostics: CompileDiagnostics;
}

export interface CompileOptions {
  filename?: string;
  timing?: boolean;
}

/**
 * Compile a `.ease` source file through all pipeline stages.
 * Currently only stage 1 (splitter) is implemented.
 */
export function compile(_source: string, _options?: CompileOptions): CompileResult {
  throw new Error(
    "Full compile pipeline not yet implemented. Use individual stages.",
  );
}
