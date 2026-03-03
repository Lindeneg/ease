// Stage 3: Script Analyzer (acorn-based)
// Parses <script server> and <script client> blocks, extracts structured data
// for binding resolution and code generation.

import * as acorn from "acorn";
import {
  createDiagnostic,
  type Diagnostic,
} from "./diagnostics.js";
import { success, failure, type Result } from "@ease/shared";

// ── Types ──────────────────────────────────────────────────────

export interface StateField {
  name: string;
  initializer: string; // raw JS expression
}

export interface ActionInfo {
  name: string;
  kind: "client" | "server"; // auto-detected: has ctx → server
  params: string[];           // parameter names beyond state (and ctx for server)
  isAsync: boolean;
  body: string;               // raw function body
}

export interface ImportInfo {
  raw: string;           // full import statement
  source: string;        // module specifier e.g. './button.ease'
  isTypeOnly: boolean;   // import type { ... } → true
}

export interface ServerAnalysis {
  imports: ImportInfo[];
  state: StateField[];
  actions: ActionInfo[];
  propsType: string | null; // raw TS type string
}

export interface ClientAnalysis {
  imports: ImportInfo[];
  hooks: LifecycleHook[];
}

export interface LifecycleHook {
  name: string;      // "mounted", "unmounted"
  params: string[];  // e.g. ["el"]
  body: string;      // raw function body
}

export interface ScriptAnalysis {
  server: ServerAnalysis | null;
  client: ClientAnalysis | null;
}

// ── Result Types ───────────────────────────────────────────────

export interface AnalyzerData {
  analysis: ScriptAnalysis;
  diagnostics: Diagnostic[];
}

export interface AnalyzerFailure {
  analysis: ScriptAnalysis;
  diagnostics: Diagnostic[];
}

export type AnalyzerResult = Result<AnalyzerData, AnalyzerFailure>;

// ── Diagnostic Codes ───────────────────────────────────────────

export const AnalyzerDiagnostics = {
  // Server errors
  E200: "E200", // No export default in server script
  E201: "E201", // Export default is not a define() call
  E202: "E202", // define() argument is not a function
  E203: "E203", // Return value missing 'state' property
  E204: "E204", // Return value missing 'actions' property
  E205: "E205", // Acorn parse error (server)
  E206: "E206", // Action is not a function

  // Client errors
  E210: "E210", // No export default in client script
  E211: "E211", // Client export default is not an object
  E212: "E212", // Acorn parse error (client)

  // Warnings
  W200: "W200", // Unknown lifecycle hook name
} as const;

const KNOWN_HOOKS = new Set(["mounted", "unmounted"]);

// ── TypeScript Stripping ───────────────────────────────────────

interface StrippedScript {
  cleaned: string;
  propsType: string | null;
  typeImports: ImportInfo[];
}

/**
 * Strip TypeScript annotations from source before acorn parsing.
 * Handles: import type, props type annotation, as casts.
 */
function stripTypeScript(source: string): StrippedScript {
  const typeImports: ImportInfo[] = [];
  let propsType: string | null = null;

  // 1. Strip `import type` lines and record them
  const lines = source.split("\n");
  const cleanedLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^import\s+type\s+/.test(trimmed)) {
      // Extract source from import type statement
      const srcMatch = trimmed.match(/from\s+["']([^"']+)["']/);
      typeImports.push({
        raw: trimmed.replace(/;$/, ""),
        source: srcMatch ? srcMatch[1] : "",
        isTypeOnly: true,
      });
      cleanedLines.push(""); // preserve line numbers
    } else {
      cleanedLines.push(line);
    }
  }

  let cleaned = cleanedLines.join("\n");

  // 2. Strip props type annotation from define(function(props: { ... }) or define((props: { ... }) =>
  // Find the define( call, then locate the param list
  const defineMatch = cleaned.match(/define\s*\(\s*(?:function\s*\w*\s*)?\(/);
  if (defineMatch && defineMatch.index !== undefined) {
    const paramStart = defineMatch.index + defineMatch[0].length;
    // Find props identifier followed by ':'
    const afterParams = cleaned.slice(paramStart);
    const propsColonMatch = afterParams.match(/^(\s*\w+)\s*:\s*/);
    if (propsColonMatch) {
      const colonEnd = paramStart + propsColonMatch[0].length;
      // Use bracket-depth scanner to capture the type annotation
      const typeResult = scanTypeAnnotation(cleaned, colonEnd);
      if (typeResult) {
        propsType = typeResult.type;
        // Strip the ": Type" part, keep just the param name
        const stripStart = paramStart + propsColonMatch[1].length;
        cleaned = cleaned.slice(0, stripStart) + cleaned.slice(typeResult.end);
      }
    }
  }

  return { cleaned, propsType, typeImports };
}

/**
 * Bracket-depth scanner for type annotations.
 * Starts at the beginning of the type expression, scans until depth returns to 0
 * and we hit `)` or `,` at depth 0.
 */
function scanTypeAnnotation(
  source: string,
  start: number,
): { type: string; end: number } | null {
  let depth = 0;
  let i = start;
  let started = false;

  while (i < source.length) {
    const ch = source[i];
    if (ch === "{" || ch === "(" || ch === "<") {
      depth++;
      started = true;
    } else if (ch === "}" || ch === ")" || ch === ">") {
      if (depth === 0) {
        // We've hit closing paren or similar at depth 0 — end of type
        const type = source.slice(start, i).trim();
        return type.length > 0 ? { type, end: i } : null;
      }
      depth--;
    } else if (ch === "," && depth === 0 && started) {
      const type = source.slice(start, i).trim();
      return type.length > 0 ? { type, end: i } : null;
    }

    // If we've started a bracketed type and returned to depth 0, check next non-whitespace
    if (started && depth === 0) {
      const type = source.slice(start, i + 1).trim();
      if (type.length > 0) {
        return { type, end: i + 1 };
      }
    }

    i++;
  }

  return null;
}

// ── Acorn Helpers ──────────────────────────────────────────────

type AcornNode = acorn.Node & { [key: string]: any };

function parseWithAcorn(
  source: string,
  diagnostics: Diagnostic[],
  errorCode: string,
): AcornNode | null {
  try {
    return acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as AcornNode;
  } catch (e: any) {
    diagnostics.push(createDiagnostic(
      "error",
      errorCode,
      `Parse error: ${e.message}`,
      null,
      "Check for syntax errors in the script block.",
    ));
    return null;
  }
}

/**
 * Extract ImportInfo[] from acorn AST ImportDeclaration nodes.
 */
function extractImports(ast: AcornNode, source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      imports.push({
        raw: source.slice(node.start, node.end).replace(/;$/, ""),
        source: node.source.value as string,
        isTypeOnly: false,
      });
    }
  }
  return imports;
}

/**
 * Find the ExportDefaultDeclaration in the AST body.
 */
function findExportDefault(ast: AcornNode): AcornNode | null {
  for (const node of ast.body) {
    if (node.type === "ExportDefaultDeclaration") {
      return node;
    }
  }
  return null;
}

// ── Server Block Analysis ──────────────────────────────────────

function analyzeServerBlock(
  source: string,
  diagnostics: Diagnostic[],
): ServerAnalysis {
  const empty: ServerAnalysis = {
    imports: [],
    state: [],
    actions: [],
    propsType: null,
  };

  // Strip TS annotations
  const stripped = stripTypeScript(source);
  const { cleaned, propsType, typeImports } = stripped;

  // Parse with acorn
  const ast = parseWithAcorn(cleaned, diagnostics, AnalyzerDiagnostics.E205);
  if (!ast) return { ...empty, propsType };

  // Extract JS imports + prepend type imports
  const jsImports = extractImports(ast, cleaned);
  const imports = [...typeImports, ...jsImports];

  // Find export default
  const exportDefault = findExportDefault(ast);
  if (!exportDefault) {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E200,
      "Server script must have a default export.",
      null,
      "Add: export default define(function() { ... })",
    ));
    return { imports, state: [], actions: [], propsType };
  }

  // Check it's a define() call
  const decl = exportDefault.declaration;
  if (
    decl.type !== "CallExpression" ||
    !(decl.callee.type === "Identifier" && decl.callee.name === "define")
  ) {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E201,
      "Default export must be a define() call.",
      null,
      "Use: export default define(function() { ... })",
    ));
    return { imports, state: [], actions: [], propsType };
  }

  // Check define() argument is a function
  const arg = decl.arguments[0];
  if (
    !arg ||
    (arg.type !== "FunctionExpression" && arg.type !== "ArrowFunctionExpression")
  ) {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E202,
      "define() argument must be a function.",
      null,
      "Use: define(function() { return { state: {}, actions: {} } })",
    ));
    return { imports, state: [], actions: [], propsType };
  }

  // Navigate to the return value (ObjectExpression)
  const fn = arg;
  const returnObj = getReturnObject(fn, cleaned);
  if (!returnObj) {
    // No return object found — report missing both state and actions
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E203,
      "Return value is missing the 'state' property.",
      null,
    ));
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E204,
      "Return value is missing the 'actions' property.",
      null,
    ));
    return { imports, state: [], actions: [], propsType };
  }

  // Extract state and actions from the return object
  const stateProp = findProperty(returnObj, "state");
  const actionsProp = findProperty(returnObj, "actions");

  let state: StateField[] = [];
  let actions: ActionInfo[] = [];

  if (!stateProp) {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E203,
      "Return value is missing the 'state' property.",
      null,
    ));
  } else if (stateProp.value.type === "ObjectExpression") {
    state = extractStateFields(stateProp.value, cleaned);
  }

  if (!actionsProp) {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E204,
      "Return value is missing the 'actions' property.",
      null,
    ));
  } else if (actionsProp.value.type === "ObjectExpression") {
    actions = extractActions(actionsProp.value, cleaned, diagnostics);
  }

  return { imports, state, actions, propsType };
}

/**
 * Get the return object from a function body.
 * Handles both block bodies (ReturnStatement) and expression bodies (arrow).
 */
function getReturnObject(fn: AcornNode, _source: string): AcornNode | null {
  // Arrow with expression body: define(() => ({ state: {}, actions: {} }))
  if (fn.type === "ArrowFunctionExpression" && fn.expression) {
    const expr = fn.body;
    if (expr.type === "ObjectExpression") return expr;
    return null;
  }

  // Block body — find ReturnStatement
  const body = fn.body;
  if (body.type !== "BlockStatement") return null;

  for (const stmt of body.body) {
    if (stmt.type === "ReturnStatement" && stmt.argument) {
      if (stmt.argument.type === "ObjectExpression") return stmt.argument;
    }
  }

  return null;
}

/**
 * Find a property by key name in an ObjectExpression.
 */
function findProperty(obj: AcornNode, name: string): AcornNode | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const key = prop.key;
    if (
      (key.type === "Identifier" && key.name === name) ||
      (key.type === "Literal" && key.value === name)
    ) {
      return prop;
    }
  }
  return null;
}

/**
 * Extract StateField[] from a state ObjectExpression.
 */
function extractStateFields(obj: AcornNode, source: string): StateField[] {
  const fields: StateField[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const key = prop.key;
    const name =
      key.type === "Identifier"
        ? key.name
        : key.type === "Literal"
          ? String(key.value)
          : null;
    if (!name) continue;

    const initializer = source.slice(prop.value.start, prop.value.end);
    fields.push({ name, initializer });
  }
  return fields;
}

/**
 * Extract ActionInfo[] from an actions ObjectExpression.
 */
function extractActions(
  obj: AcornNode,
  source: string,
  diagnostics: Diagnostic[],
): ActionInfo[] {
  const actions: ActionInfo[] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const key = prop.key;
    const name =
      key.type === "Identifier"
        ? key.name
        : key.type === "Literal"
          ? String(key.value)
          : null;
    if (!name) continue;

    const value = prop.value;
    if (
      value.type !== "FunctionExpression" &&
      value.type !== "ArrowFunctionExpression"
    ) {
      diagnostics.push(createDiagnostic(
        "error",
        AnalyzerDiagnostics.E206,
        `Action '${name}' is not a function.`,
        null,
        `Define '${name}' as a function expression.`,
      ));
      continue;
    }

    const params: string[] = value.params.map(
      (p: AcornNode) => (p.type === "Identifier" ? p.name : source.slice(p.start, p.end)),
    );

    // Classify: first param is always state.
    // If second param is "ctx" → server action.
    const isServer = params.length >= 2 && params[1] === "ctx";
    const kind: "client" | "server" = isServer ? "server" : "client";

    // Extra params: skip state (and ctx for server)
    const extraStart = isServer ? 2 : 1;
    const extraParams = params.slice(extraStart);

    const isAsync = value.async === true;
    const body = extractFunctionBody(value, source);

    actions.push({ name, kind, params: extraParams, isAsync, body });
  }
  return actions;
}

/**
 * Extract the raw function body string.
 */
function extractFunctionBody(fn: AcornNode, source: string): string {
  if (fn.type === "ArrowFunctionExpression" && fn.expression) {
    // Expression body
    return source.slice(fn.body.start, fn.body.end);
  }
  // Block body — include the braces
  return source.slice(fn.body.start, fn.body.end);
}

// ── Client Block Analysis ──────────────────────────────────────

function analyzeClientBlock(
  source: string,
  diagnostics: Diagnostic[],
): ClientAnalysis {
  const empty: ClientAnalysis = { imports: [], hooks: [] };

  // Parse with acorn (no TS stripping needed for client — no define() or props)
  // But we should still strip import type lines
  const stripped = stripTypeScript(source);
  const { cleaned, typeImports } = stripped;

  const ast = parseWithAcorn(cleaned, diagnostics, AnalyzerDiagnostics.E212);
  if (!ast) return empty;

  const jsImports = extractImports(ast, cleaned);
  const imports = [...typeImports, ...jsImports];

  // Find export default
  const exportDefault = findExportDefault(ast);
  if (!exportDefault) {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E210,
      "Client script must have a default export.",
      null,
      "Add: export default { mounted(el) { ... } }",
    ));
    return { imports, hooks: [] };
  }

  // Check it's an object literal
  const decl = exportDefault.declaration;
  if (decl.type !== "ObjectExpression") {
    diagnostics.push(createDiagnostic(
      "error",
      AnalyzerDiagnostics.E211,
      "Client default export must be an object literal.",
      null,
      "Use: export default { mounted(el) { ... } }",
    ));
    return { imports, hooks: [] };
  }

  // Extract lifecycle hooks
  const hooks: LifecycleHook[] = [];
  for (const prop of decl.properties) {
    if (prop.type !== "Property") continue;
    const key = prop.key;
    const name =
      key.type === "Identifier"
        ? key.name
        : key.type === "Literal"
          ? String(key.value)
          : null;
    if (!name) continue;

    if (!KNOWN_HOOKS.has(name)) {
      diagnostics.push(createDiagnostic(
        "warning",
        AnalyzerDiagnostics.W200,
        `Unknown lifecycle hook '${name}'.`,
        null,
        `Known hooks: ${[...KNOWN_HOOKS].join(", ")}`,
      ));
    }

    const value = prop.value;
    if (
      value.type === "FunctionExpression" ||
      value.type === "ArrowFunctionExpression"
    ) {
      const params = value.params.map(
        (p: AcornNode) => (p.type === "Identifier" ? p.name : cleaned.slice(p.start, p.end)),
      );
      const body = extractFunctionBody(value, cleaned);
      hooks.push({ name, params, body });
    }
  }

  return { imports, hooks };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Analyze `<script server>` and `<script client>` blocks.
 * Takes both block contents (or null if absent), returns combined result.
 */
export function analyzeScript(
  serverSource: string | null,
  clientSource: string | null,
): AnalyzerResult {
  const diagnostics: Diagnostic[] = [];

  const server = serverSource !== null
    ? analyzeServerBlock(serverSource, diagnostics)
    : null;

  const client = clientSource !== null
    ? analyzeClientBlock(clientSource, diagnostics)
    : null;

  const analysis: ScriptAnalysis = { server, client };

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return failure({ analysis, diagnostics });
  }
  return success({ analysis, diagnostics });
}
