// @ease/compiler — public API

export { split, SplitError, SplitDiagnostics } from "./splitter.js";
export type { RawBlock, SplitResult } from "./splitter.js";

export { parseTemplate, ParseDiagnostics } from "./template-parser.js";
export type {
  ParseResult,
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

export { analyzeScript, AnalyzerDiagnostics } from "./script-analyzer.js";
export type {
  ScriptAnalysis,
  StateField,
  ActionInfo,
  EmitInfo,
  ImportInfo,
  ServerAnalysis,
  ClientAnalysis,
  LifecycleHook,
  AnalyzerResult,
} from "./script-analyzer.js";

export { resolveBindings, ResolverDiagnostics } from "./binding-resolver.js";
export type { Binding, BindingType, ResolvedComponent, ResolverResult } from "./binding-resolver.js";

export { extractIdentifiers, parseEachExpression, isComponentTag } from "./utils.js";
export type { EachExpression } from "./utils.js";

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
  StageOutput,
  CompileDiagnostics,
} from "./diagnostics.js";

import type { SplitResult } from "./splitter.js";
import type { ServerOutput } from "./codegen/server.js";
import type { ClientOutput } from "./codegen/client.js";
import type { CompileDiagnostics } from "./diagnostics.js";

/** The final output of a full `.ease` compilation, combining all pipeline stage results. */
export interface CompileResult {
  /** Raw blocks from the splitter stage */
  split: SplitResult;
  /** Generated server-side rendering module */
  server: ServerOutput;
  /** Generated client-side module (pure actions + DOM updaters) */
  client: ClientOutput;
  /** Aggregated diagnostics and timing from all stages */
  diagnostics: CompileDiagnostics;
}

/** Options for the top-level `compile()` function. */
export interface CompileOptions {
  /** Source filename, used in diagnostic messages */
  filename?: string;
  /** When true, include per-stage timing measurements in the result */
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
