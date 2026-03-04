// Unified code generation — produces a single JS module per component.
//
// The same module works on both server (vhtml → HTML string) and client
// (morphdom diffing). The runtime decides what to use where.

import {createDiagnostic, type Diagnostic, type StageOutput} from "../diagnostics.js";
import type {ResolvedComponent} from "../binding-resolver.js";
import type {TemplateNode, ElementNode, TextNode, SlotNode} from "../template-parser.js";
import type {ServerAnalysis, ActionInfo} from "../script-analyzer.js";
import {success, failure, type Result} from "@ease/shared";
import {isComponentTag} from "../utils.js";

// ── Types ──────────────────────────────────────────────────────

/** Metadata extracted during compilation, used by the runtime and server. */
export interface CompiledMeta {
    /** Names of client-only actions (run in browser, no server round-trip) */
    clientActions: string[];
    /** Names of server actions (round-trip to server via HTTP POST) */
    serverActions: string[];
    /** Event names this component can emit to its parent */
    emits: string[];
    /** Whether the component factory accepts props */
    hasProps: boolean;
    /** Whether the template contains `<slot />` elements (layout support) */
    hasSlots: boolean;
}

/** The generated JS module for a component — a single output for both server and client. */
export interface CompiledOutput {
    /** The full generated JS module source code (imports h(), exports init/render/actions/etc.) */
    code: string;
    /** Component metadata extracted during compilation */
    meta: CompiledMeta;
}

/** Result type for the codegen stage. */
export type CodegenResult = Result<StageOutput<CompiledOutput>, StageOutput<CompiledOutput>>;

// ── Diagnostic Codes ───────────────────────────────────────────

export const CodegenDiagnostics = {
    E400: "E400", // No server script analysis available
} as const;

// ── Helpers ────────────────────────────────────────────────────

function isWhitespaceOnly(text: string): boolean {
    return /^\s*$/.test(text);
}

/** Check if a template AST contains any SlotNode (recursive). */
function templateContainsSlot(nodes: TemplateNode[]): boolean {
    for (const node of nodes) {
        if (node.type === "slot") return true;
        if (node.type === "element") {
            if (templateContainsSlot(node.children)) return true;
        }
    }
    return false;
}

/** Get the conditional directive kind from an element's directives, if any. */
function getConditionalKind(node: ElementNode): string | null {
    for (const dir of node.directives) {
        if (dir.kind === "conditional") return dir.name;
    }
    return null;
}

/** Get the conditional expression from an element's directives. */
function getConditionalExpr(node: ElementNode): string {
    for (const dir of node.directives) {
        if (dir.kind === "conditional") return dir.value;
    }
    return "";
}

/** Get the loop directive from an element, if any. */
function getLoopDirective(node: ElementNode): {variable: string; iterable: string} | null {
    for (const dir of node.directives) {
        if (dir.kind === "loop") {
            // Parse "item in items" — same format as binding resolver
            const trimmed = dir.value.trim();
            const spaceIdx = trimmed.indexOf(" in ");
            if (spaceIdx === -1) return null;
            return {
                variable: trimmed.slice(0, spaceIdx).trim(),
                iterable: trimmed.slice(spaceIdx + 4).trim(),
            };
        }
    }
    return null;
}

/** Escape a string for use as a JS string literal (without outer quotes). */
function escapeString(s: string): string {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

/** Collapse whitespace in text: trim edges, collapse internal runs to single space. */
function normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

// ── Code Generators ────────────────────────────────────────────

function genImports(): string {
    return 'import { h } from "@ease/runtime";';
}

function genInit(analysis: ServerAnalysis): string {
    const fields = analysis.state;
    if (fields.length === 0) {
        return "export function init(props, ctx) {\n  return {};\n}";
    }
    const entries = fields.map((f) => `${f.name}: ${f.initializer}`);
    return `export function init(props, ctx) {\n  return { ${entries.join(", ")} };\n}`;
}

function genRender(template: TemplateNode[], analysis: ServerAnalysis): string {
    const lines: string[] = [];
    lines.push("export function render(state, slots) {");

    // State destructuring
    const stateNames = analysis.state.map((s) => s.name);
    if (stateNames.length > 0) {
        lines.push(`  var { ${stateNames.join(", ")} } = state;`);
    }

    // Generate children
    const body = genChildren(template);

    if (body.length === 0) {
        lines.push("  return null;");
    } else if (body.length === 1) {
        lines.push(`  return ${body[0]};`);
    } else {
        lines.push(`  return [${body.join(", ")}];`);
    }

    lines.push("}");
    return lines.join("\n");
}

/**
 * Process a list of child nodes, grouping conditional chains and
 * filtering whitespace-only text between conditionals.
 * Returns an array of JS expression strings.
 */
function genChildren(nodes: TemplateNode[]): string[] {
    const results: string[] = [];
    let i = 0;

    while (i < nodes.length) {
        const node = nodes[i];

        // Check if this starts a conditional chain
        if (node.type === "element" && getConditionalKind(node) === "if") {
            const chain: ElementNode[] = [node];
            i++;

            // Collect @else-if and @else siblings, skipping whitespace text nodes
            while (i < nodes.length) {
                const next = nodes[i];
                // Skip whitespace-only text nodes between conditional siblings
                if (next.type === "text" && isWhitespaceOnly(next.value)) {
                    // Peek ahead to see if the next non-whitespace is a conditional continuation
                    let peek = i + 1;
                    while (peek < nodes.length && nodes[peek].type === "text" && isWhitespaceOnly((nodes[peek] as TextNode).value)) {
                        peek++;
                    }
                    if (peek < nodes.length && nodes[peek].type === "element") {
                        const peekKind = getConditionalKind(nodes[peek] as ElementNode);
                        if (peekKind === "else-if" || peekKind === "else") {
                            // Skip all whitespace text nodes up to the conditional
                            i = peek;
                            continue;
                        }
                    }
                    // Not followed by a conditional continuation — break
                    break;
                }
                if (next.type === "element") {
                    const kind = getConditionalKind(next);
                    if (kind === "else-if" || kind === "else") {
                        chain.push(next);
                        i++;
                        if (kind === "else") break; // @else terminates the chain
                        continue;
                    }
                }
                break;
            }

            results.push(genConditionalChain(chain));
            continue;
        }

        // Skip whitespace-only text nodes at the boundary of children
        if (node.type === "text") {
            const normalized = normalizeText(node.value);
            if (normalized.length > 0) {
                results.push(`"${escapeString(normalized)}"`);
            }
            i++;
            continue;
        }

        results.push(genNode(node));
        i++;
    }

    return results;
}

function genNode(node: TemplateNode): string {
    switch (node.type) {
        case "text":
            return genText(node);
        case "interpolation":
            return node.expression;
        case "element":
            return genElement(node);
        case "slot":
            return genSlot(node);
    }
}

function genText(node: TextNode): string {
    const normalized = normalizeText(node.value);
    if (normalized.length === 0) return '""';
    return `"${escapeString(normalized)}"`;
}

function genSlot(node: SlotNode): string {
    if (node.name === null) return "slots.default";
    return `slots.${node.name}`;
}

function genElement(node: ElementNode): string {
    const loop = getLoopDirective(node);

    // Build the h() call for this element (without loop wrapping)
    const hCall = genElementHCall(node);

    // If the element has @each, wrap in .map()
    if (loop) {
        return `${loop.iterable}.map(function(${loop.variable}) {\n    return ${hCall};\n  })`;
    }

    return hCall;
}

/** Generate the h("tag", attrs, ...children) call for an element. */
function genElementHCall(node: ElementNode): string {
    const tag = `"${escapeString(node.tag)}"`;
    const attrs = genAttrs(node);
    const children = genChildren(node.children);

    const parts = [tag, attrs];
    if (children.length > 0) {
        parts.push(...children);
    }

    return `h(${parts.join(", ")})`;
}

function genAttrs(node: ElementNode): string {
    const entries: string[] = [];

    // Static and dynamic attributes
    for (const attr of node.attrs) {
        if (attr.dynamic) {
            // Dynamic: :name="expression" → name: expression
            entries.push(`${quoteAttrName(attr.name)}: ${attr.value ?? "true"}`);
        } else if (attr.value === null) {
            // Boolean: disabled → disabled: true
            entries.push(`${quoteAttrName(attr.name)}: true`);
        } else {
            // Static: class="foo" → class: "foo"
            entries.push(`${quoteAttrName(attr.name)}: "${escapeString(attr.value)}"`);
        }
    }

    // Event directives
    for (const dir of node.directives) {
        if (dir.kind === "event") {
            if (isComponentTag(node.tag)) {
                // Component event: @saved="handler" → "data-ease-on-saved": "handler"
                entries.push(`"data-ease-on-${dir.name}": "${escapeString(dir.value.trim())}"`);
            } else {
                // DOM event: @click="handler" → "data-ease-click": "handler"
                entries.push(`"data-ease-${dir.name}": "${escapeString(dir.value.trim())}"`);
            }
        }
        // conditional and loop directives are not emitted as attributes
    }

    if (entries.length === 0) return "null";
    return `{ ${entries.join(", ")} }`;
}

/** Quote an attribute name if it contains characters that aren't valid JS identifiers. */
function quoteAttrName(name: string): string {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;
    return `"${escapeString(name)}"`;
}

function genConditionalChain(chain: ElementNode[]): string {
    const parts: string[] = [];

    for (let i = 0; i < chain.length; i++) {
        const node = chain[i];
        const kind = getConditionalKind(node);
        const expr = getConditionalExpr(node);
        const hCall = genElementHCall(node);

        if (kind === "else") {
            parts.push(hCall);
        } else {
            parts.push(`${expr.trim()} ? ${hCall} : `);
        }
    }

    // If chain doesn't end with @else, terminate with null
    const lastKind = getConditionalKind(chain[chain.length - 1]);
    if (lastKind !== "else") {
        parts.push("null");
    }

    return parts.join("");
}

function genActions(analysis: ServerAnalysis): string {
    const clientActions = analysis.actions.filter((a) => a.kind === "client");

    if (clientActions.length === 0) {
        return "export var actions = {};";
    }

    const entries = clientActions.map((action) => {
        const params = buildActionParams(action);
        const body = formatActionBody(action.body);
        return `  ${action.name}: function(${params.join(", ")}) ${body}`;
    });

    return `export var actions = {\n${entries.join(",\n")}\n};`;
}

function buildActionParams(action: ActionInfo): string[] {
    const params = ["state"];
    if (action.hasEmit) params.push("emit");
    params.push(...action.params);
    return params;
}

function formatActionBody(body: string): string {
    // Block body starts with { — use as-is
    if (body.trimStart().startsWith("{")) return body;
    // Expression body — wrap in block
    return `{ ${body} }`;
}

function genServerActions(analysis: ServerAnalysis): string {
    const names = analysis.actions
        .filter((a) => a.kind === "server")
        .map((a) => `"${escapeString(a.name)}"`);

    return `export var serverActions = [${names.join(", ")}];`;
}

function genEmits(analysis: ServerAnalysis): string {
    const names = analysis.emits.map((e) => `"${escapeString(e.name)}"`);
    return `export var emits = [${names.join(", ")}];`;
}

function buildMeta(analysis: ServerAnalysis, template: TemplateNode[]): CompiledMeta {
    return {
        clientActions: analysis.actions.filter((a) => a.kind === "client").map((a) => a.name),
        serverActions: analysis.actions.filter((a) => a.kind === "server").map((a) => a.name),
        emits: analysis.emits.map((e) => e.name),
        hasProps: analysis.propsType !== null,
        hasSlots: templateContainsSlot(template),
    };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Generate a unified JS module from a resolved component.
 *
 * The generated module exports:
 * - `init(props, ctx)` — creates initial state from props and server context
 * - `render(state, slots)` — returns h() calls (vhtml on server, morphdom on client)
 * - `actions` — object of client-side action functions
 * - `serverActions` — array of server action names (no bodies)
 * - `emits` — array of event names this component can emit
 */
export function generate(component: ResolvedComponent): CodegenResult {
    const diagnostics: Diagnostic[] = [];
    const analysis = component.script.server;

    if (!analysis) {
        diagnostics.push(
            createDiagnostic(
                "error",
                CodegenDiagnostics.E400,
                "Cannot generate code without a server script analysis.",
                null,
                "Ensure the component has a <script server> block.",
            ),
        );
        const empty: CompiledOutput = {
            code: "",
            meta: {clientActions: [], serverActions: [], emits: [], hasProps: false, hasSlots: false},
        };
        return failure({output: empty, diagnostics});
    }

    const parts = [
        genImports(),
        genInit(analysis),
        genRender(component.template, analysis),
        genActions(analysis),
        genServerActions(analysis),
        genEmits(analysis),
    ];

    const code = parts.join("\n\n");
    const meta = buildMeta(analysis, component.template);

    return success({output: {code, meta}, diagnostics});
}

// Legacy export — kept for backward compatibility during migration
export type ServerOutput = CompiledOutput;
export const generateServer = generate;
