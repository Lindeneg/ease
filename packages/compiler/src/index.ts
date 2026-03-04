export {split, SplitError, SplitDiagnostics} from "./splitter.js";
export type {RawBlock, SplitResult} from "./splitter.js";

export {parseTemplate, ParseDiagnostics} from "./template-parser.js";
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

export {success, failure, emptySuccess, unwrap} from "@ease/shared";
export type {Result, ResultSuccess, ResultFailure, EmptyResult} from "@ease/shared";

export {analyzeScript, AnalyzerDiagnostics} from "./script-analyzer.js";
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

export {resolveBindings, ResolverDiagnostics} from "./binding-resolver.js";
export type {Binding, BindingType, ResolvedComponent, ResolverResult} from "./binding-resolver.js";

export {extractIdentifiers, parseEachExpression, isComponentTag} from "./utils.js";
export type {EachExpression} from "./utils.js";

export {generate, generateServer, CodegenDiagnostics} from "./codegen/server.js";
export type {CompiledOutput, CompiledMeta, CodegenResult, ServerOutput} from "./codegen/server.js";

export {generateClient} from "./codegen/client.js";
export type {ClientOutput} from "./codegen/client.js";

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

import {split} from "./splitter.js";
import {parseTemplate} from "./template-parser.js";
import {analyzeScript} from "./script-analyzer.js";
import {resolveBindings} from "./binding-resolver.js";
import {generate} from "./codegen/server.js";
import {timeStage, type Diagnostic, type StageTiming} from "./diagnostics.js";
import type {SplitResult} from "./splitter.js";
import type {CompiledOutput} from "./codegen/server.js";
import type {ResolvedComponent} from "./binding-resolver.js";
import type {CompileDiagnostics} from "./diagnostics.js";

/** The final output of a full `.ease` compilation, combining all pipeline stage results. */
export interface CompileResult {
    /** Raw blocks from the splitter stage */
    split: SplitResult;
    /** Resolved component (template AST + script analysis + bindings) */
    resolved: ResolvedComponent;
    /** Generated unified JS module (works on both server and client) */
    output: CompiledOutput;
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
 *
 * Pipeline: split → parseTemplate → analyzeScript → resolveBindings → generate
 *
 * Collects diagnostics from every stage. If any stage produces errors, later stages
 * still run with best-effort partial data (for IDE tooling). The final result always
 * includes all diagnostics regardless of success/failure.
 */
export function compile(source: string, options?: CompileOptions): CompileResult {
    const allDiagnostics: Diagnostic[] = [];
    const timings: StageTiming[] = [];
    const totalStart = performance.now();
    const measure = options?.timing ?? false;

    // ── 1. Split ────────────────────────────────────────────
    const splitRun = measure
        ? timeStage("split", () => split(source))
        : {result: split(source), timing: null};
    const splitResult = splitRun.result;
    if (splitRun.timing) timings.push(splitRun.timing);
    allDiagnostics.push(...splitResult.diagnostics);

    // ── 2. Parse template ───────────────────────────────────
    const templateContent = splitResult.template?.content ?? "";
    const parseRun = measure
        ? timeStage("template-parser", () => parseTemplate(templateContent))
        : {result: parseTemplate(templateContent), timing: null};
    const parseResult = parseRun.result;
    if (parseRun.timing) timings.push(parseRun.timing);

    const template = parseResult.ok
        ? parseResult.data.output
        : parseResult.ctx.output;
    allDiagnostics.push(
        ...(parseResult.ok ? parseResult.data.diagnostics : parseResult.ctx.diagnostics),
    );

    // ── 3. Analyze script ───────────────────────────────────
    const serverSrc = splitResult.serverScript?.content ?? null;
    const clientSrc = splitResult.clientScript?.content ?? null;
    const analyzeRun = measure
        ? timeStage("script-analyzer", () => analyzeScript(serverSrc, clientSrc))
        : {result: analyzeScript(serverSrc, clientSrc), timing: null};
    const analyzeResult = analyzeRun.result;
    if (analyzeRun.timing) timings.push(analyzeRun.timing);

    const analysis = analyzeResult.ok
        ? analyzeResult.data.output
        : analyzeResult.ctx.output;
    allDiagnostics.push(
        ...(analyzeResult.ok ? analyzeResult.data.diagnostics : analyzeResult.ctx.diagnostics),
    );

    // ── 4. Resolve bindings ─────────────────────────────────
    const resolveRun = measure
        ? timeStage("binding-resolver", () => resolveBindings(template, analysis))
        : {result: resolveBindings(template, analysis), timing: null};
    const resolveResult = resolveRun.result;
    if (resolveRun.timing) timings.push(resolveRun.timing);

    const resolved = resolveResult.ok
        ? resolveResult.data.output
        : resolveResult.ctx.output;
    allDiagnostics.push(
        ...(resolveResult.ok ? resolveResult.data.diagnostics : resolveResult.ctx.diagnostics),
    );

    // ── 5. Generate code ────────────────────────────────────
    const genRun = measure
        ? timeStage("codegen", () => generate(resolved))
        : {result: generate(resolved), timing: null};
    const genResult = genRun.result;
    if (genRun.timing) timings.push(genRun.timing);

    const output = genResult.ok
        ? genResult.data.output
        : genResult.ctx.output;
    allDiagnostics.push(
        ...(genResult.ok ? genResult.data.diagnostics : genResult.ctx.diagnostics),
    );

    // ── Assemble result ─────────────────────────────────────
    const totalMs = performance.now() - totalStart;

    return {
        split: splitResult,
        resolved,
        output,
        diagnostics: {
            diagnostics: allDiagnostics,
            timings,
            totalMs,
        },
    };
}
