// Stage 4: Binding Resolver
// Walks the template AST, cross-references every expression against the script
// analysis (state fields, actions), and produces a flat list of Binding objects
// for code generation.

import {createDiagnostic, type Diagnostic, type StageOutput} from "./diagnostics.js";
import {success, failure, type Result} from "@ease/shared";
import type {TemplateNode, ElementNode, InterpolationNode} from "./template-parser.js";
import type {ScriptAnalysis} from "./script-analyzer.js";
import {extractIdentifiers, parseEachExpression} from "./utils.js";

// ── Types ──────────────────────────────────────────────────────

/** Classification of where a binding originates in the template. */
export type BindingType = "text" | "event" | "attr" | "conditional" | "loop";

/** A resolved connection between a template expression and script declarations. */
export interface Binding {
    /** What template construct this binding came from */
    type: BindingType;
    /** The raw expression from the template, e.g. "count + 1", "increment", "item in items" */
    expression: string;
    /** Primary resolved name: action name for events, first referenced identifier otherwise */
    target: string;
    /** All state/action identifiers referenced in the expression (deduplicated) */
    referencedNames: string[];
    /** Index path through the template AST to the node containing this binding */
    nodePath: number[];
}

/** A fully resolved component: template AST, script analysis, and the bindings between them. */
export interface ResolvedComponent {
    /** The parsed template AST */
    template: TemplateNode[];
    /** The analyzed script data (server + client) */
    script: ScriptAnalysis;
    /** All resolved bindings connecting template expressions to script declarations */
    bindings: Binding[];
}

// ── Result Types ───────────────────────────────────────────────

export type ResolverResult = Result<StageOutput<ResolvedComponent>, StageOutput<ResolvedComponent>>;

// ── Diagnostic Codes ───────────────────────────────────────────

export const ResolverDiagnostics = {
    // Errors
    E300: "E300", // Event directive references unknown action
    E301: "E301", // @each directive has invalid syntax

    // Warnings
    W300: "W300", // Expression references unknown identifier
    W301: "W301", // Empty interpolation expression
    W302: "W302", // Empty dynamic attribute value
    W303: "W303", // Empty conditional expression (not @else)
} as const;

// ── Walk Context ───────────────────────────────────────────────

interface WalkContext {
    knownState: Set<string>;
    knownActions: Set<string>;
    loopVars: Set<string>;
    bindings: Binding[];
    diagnostics: Diagnostic[];
}

// ── Tree Walker ────────────────────────────────────────────────

function walkNodes(nodes: TemplateNode[], basePath: number[], ctx: WalkContext): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const nodePath = [...basePath, i];

        switch (node.type) {
            case "text":
            case "slot":
                break;

            case "interpolation":
                resolveInterpolation(node, nodePath, ctx);
                break;

            case "element":
                resolveElement(node, nodePath, ctx);
                break;
        }
    }
}

function resolveInterpolation(node: InterpolationNode, nodePath: number[], ctx: WalkContext): void {
    const expr = node.expression;

    if (expr.length === 0) {
        ctx.diagnostics.push(
            createDiagnostic(
                "warning",
                ResolverDiagnostics.W301,
                "Empty interpolation expression.",
                null,
                "Add an expression inside the mustaches."
            )
        );
        ctx.bindings.push({
            type: "text",
            expression: expr,
            target: "",
            referencedNames: [],
            nodePath,
        });
        return;
    }

    const names = extractIdentifiers(expr);
    warnUnknownNames(names, nodePath, ctx);

    ctx.bindings.push({
        type: "text",
        expression: expr,
        target: names[0] ?? expr,
        referencedNames: names,
        nodePath,
    });
}

function resolveElement(node: ElementNode, nodePath: number[], ctx: WalkContext): void {
    let childLoopVars = ctx.loopVars;

    // Process directives
    for (const dir of node.directives) {
        switch (dir.kind) {
            case "event":
                resolveEventDirective(dir.name, dir.value, nodePath, ctx);
                break;

            case "conditional":
                resolveConditionalDirective(dir.name, dir.value, nodePath, ctx);
                break;

            case "loop":
                childLoopVars = resolveLoopDirective(dir.value, nodePath, ctx);
                break;
        }
    }

    // Build scoped context — loop variable is in scope for attrs on the same element and children
    const scopedCtx: WalkContext =
        childLoopVars !== ctx.loopVars ? {...ctx, loopVars: childLoopVars} : ctx;

    // Process dynamic attributes (with loop var in scope if @each is on this element)
    for (const attr of node.attrs) {
        if (!attr.dynamic) continue;
        resolveDynamicAttr(attr.name, attr.value ?? "", nodePath, scopedCtx);
    }

    // Recurse into children
    walkNodes(node.children, nodePath, scopedCtx);
}

function resolveEventDirective(
    directiveName: string,
    value: string,
    nodePath: number[],
    ctx: WalkContext
): void {
    const actionName = value.trim();

    if (!ctx.knownActions.has(actionName)) {
        const known = [...ctx.knownActions];
        ctx.diagnostics.push(
            createDiagnostic(
                "error",
                ResolverDiagnostics.E300,
                `Event @${directiveName} references unknown action '${actionName}'.`,
                null,
                known.length > 0
                    ? `Known actions: ${known.join(", ")}`
                    : "No actions are defined in the script block."
            )
        );
    }

    ctx.bindings.push({
        type: "event",
        expression: value,
        target: actionName,
        referencedNames: [actionName],
        nodePath,
    });
}

function resolveConditionalDirective(
    directiveName: string,
    value: string,
    nodePath: number[],
    ctx: WalkContext
): void {
    const expr = value.trim();

    // @else intentionally has no expression
    if (directiveName !== "else" && expr.length === 0) {
        ctx.diagnostics.push(
            createDiagnostic(
                "warning",
                ResolverDiagnostics.W303,
                `Empty conditional expression on @${directiveName}.`,
                null,
                "Add a condition expression."
            )
        );
        ctx.bindings.push({
            type: "conditional",
            expression: expr,
            target: "",
            referencedNames: [],
            nodePath,
        });
        return;
    }

    const names = extractIdentifiers(expr);
    warnUnknownNames(names, nodePath, ctx);

    ctx.bindings.push({
        type: "conditional",
        expression: expr,
        target: names[0] ?? expr,
        referencedNames: names,
        nodePath,
    });
}

function resolveLoopDirective(value: string, nodePath: number[], ctx: WalkContext): Set<string> {
    const parsed = parseEachExpression(value);

    if (!parsed) {
        ctx.diagnostics.push(
            createDiagnostic(
                "error",
                ResolverDiagnostics.E301,
                `Invalid @each syntax: '${value}'.`,
                null,
                'Use the format @each="item in items".'
            )
        );
        ctx.bindings.push({
            type: "loop",
            expression: value,
            target: "",
            referencedNames: [],
            nodePath,
        });
        return ctx.loopVars;
    }

    const iterableNames = extractIdentifiers(parsed.iterable);
    warnUnknownNames(iterableNames, nodePath, ctx);

    ctx.bindings.push({
        type: "loop",
        expression: value,
        target: iterableNames[0] ?? parsed.iterable,
        referencedNames: iterableNames,
        nodePath,
    });

    // Scope the loop variable for children
    return new Set([...ctx.loopVars, parsed.variable]);
}

function resolveDynamicAttr(
    attrName: string,
    value: string,
    nodePath: number[],
    ctx: WalkContext
): void {
    const expr = value.trim();

    if (expr.length === 0) {
        ctx.diagnostics.push(
            createDiagnostic(
                "warning",
                ResolverDiagnostics.W302,
                `Empty dynamic attribute value on :${attrName}.`,
                null,
                "Add an expression as the attribute value."
            )
        );
        ctx.bindings.push({
            type: "attr",
            expression: expr,
            target: "",
            referencedNames: [],
            nodePath,
        });
        return;
    }

    const names = extractIdentifiers(expr);
    warnUnknownNames(names, nodePath, ctx);

    ctx.bindings.push({
        type: "attr",
        expression: expr,
        target: names[0] ?? expr,
        referencedNames: names,
        nodePath,
    });
}

// ── Validation ─────────────────────────────────────────────────

function warnUnknownNames(names: string[], _nodePath: number[], ctx: WalkContext): void {
    for (const name of names) {
        if (ctx.knownState.has(name)) continue;
        if (ctx.knownActions.has(name)) continue;
        if (ctx.loopVars.has(name)) continue;

        ctx.diagnostics.push(
            createDiagnostic(
                "warning",
                ResolverDiagnostics.W300,
                `Expression references unknown identifier '${name}'.`,
                null,
                "If this is a global or prop, you can ignore this warning."
            )
        );
    }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Resolve bindings between template AST and script analysis.
 *
 * Walks the template tree, cross-references every expression (interpolations,
 * event handlers, dynamic attributes, conditionals, loops) against the known
 * state fields and actions from the script analysis. Produces a flat list of
 * `Binding` objects for code generation, along with diagnostics for unknown
 * references and malformed directives.
 */
export function resolveBindings(template: TemplateNode[], script: ScriptAnalysis): ResolverResult {
    const diagnostics: Diagnostic[] = [];
    const bindings: Binding[] = [];

    const knownState = new Set<string>();
    const knownActions = new Set<string>();

    if (script.server) {
        for (const s of script.server.state) knownState.add(s.name);
        for (const a of script.server.actions) knownActions.add(a.name);
    }

    const ctx: WalkContext = {
        knownState,
        knownActions,
        loopVars: new Set(),
        bindings,
        diagnostics,
    };

    walkNodes(template, [], ctx);

    const output: ResolvedComponent = {template, script, bindings};
    const hasErrors = diagnostics.some((d) => d.severity === "error");

    if (hasErrors) {
        return failure({output, diagnostics});
    }
    return success({output, diagnostics});
}
