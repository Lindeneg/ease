// Parses <script server> and <script client> blocks, extracts structured data
// for binding resolution and code generation.

import * as acorn from "acorn";
import {
  createDiagnostic,
  type Diagnostic,
  type StageOutput,
} from "./diagnostics.js";
import { success, failure, type Result } from "@ease/shared";

// ── Named Character Constants ─────────────────────────────────

const Chars = {
  OPEN_BRACE: "{",
  CLOSE_BRACE: "}",
  OPEN_PAREN: "(",
  CLOSE_PAREN: ")",
  OPEN_ANGLE: "<",
  CLOSE_ANGLE: ">",
  COMMA: ",",
  COLON: ":",
  SEMICOLON: ";",
  DOUBLE_QUOTE: '"',
  SINGLE_QUOTE: "'",
} as const;

// ── Types ──────────────────────────────────────────────────────

/** A single reactive state property declared in the `state` object of a define() return. */
export interface StateField {
  /** Identifier name of the state property, e.g. "count" */
  name: string;
  /** Raw JS expression from the source, e.g. "0", "[]", "props.initial" */
  initializer: string;
}

/** A user-defined action from the `actions` object, auto-classified as client or server. */
export interface ActionInfo {
  /** Identifier name of the action, e.g. "increment" */
  name: string;
  /** Auto-detected from params: second param named "ctx" → "server", otherwise → "client" */
  kind: "client" | "server";
  /** Extra parameter names beyond state (and ctx for server actions).
   *  e.g. for `save(state, ctx, id)` → ["id"] */
  params: string[];
  /** Whether the function is declared async */
  isAsync: boolean;
  /** Raw function body source, including braces for block bodies */
  body: string;
}

/** A single import statement extracted from a script block (regular or type-only). */
export interface ImportInfo {
  /** Full import statement text without trailing semicolon,
   *  e.g. "import { define } from '@ease/core'" */
  raw: string;
  /** Module specifier, e.g. "@ease/core", "./button.ease" */
  source: string;
  /** True for `import type { ... }` statements */
  isTypeOnly: boolean;
}

/** Everything extracted from a `<script server>` block: imports, state, actions, and props type. */
export interface ServerAnalysis {
  /** All imports from the server script block (type-only imports listed first) */
  imports: ImportInfo[];
  /** State fields from the `state` property of the define() return object */
  state: StateField[];
  /** Actions from the `actions` property, classified as client or server */
  actions: ActionInfo[];
  /** Raw TS type annotation string from the props parameter, or null if no props.
   *  e.g. "{ label: string, count: number }" */
  propsType: string | null;
}

/** Everything extracted from a `<script client>` block: imports and lifecycle hooks. */
export interface ClientAnalysis {
  /** All imports from the client script block */
  imports: ImportInfo[];
  /** Lifecycle hooks (mounted, unmounted) from the default export object */
  hooks: LifecycleHook[];
}

/** A lifecycle hook (e.g. mounted, unmounted) from a client script's default export object. */
export interface LifecycleHook {
  /** Hook name: "mounted" or "unmounted" (unknown names still extracted, with W200 warning) */
  name: string;
  /** Parameter names, e.g. ["el"] */
  params: string[];
  /** Raw function body source, including braces for block bodies */
  body: string;
}

/** Combined analysis result for both script blocks of a component. */
export interface ScriptAnalysis {
  /** Null when no <script server> block is present */
  server: ServerAnalysis | null;
  /** Null when no <script client> block is present */
  client: ClientAnalysis | null;
}

// ── Result Types ───────────────────────────────────────────────

export type AnalyzerResult = Result<StageOutput<ScriptAnalysis>, StageOutput<ScriptAnalysis>>;

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

// ── Scanner Primitives ────────────────────────────────────────

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r";
}

function skipWhitespace(source: string, pos: number): number {
  while (pos < source.length && isWhitespace(source[pos])) pos++;
  return pos;
}

function isIdentChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90)   // A-Z
      || (c >= 97 && c <= 122)  // a-z
      || (c >= 48 && c <= 57)   // 0-9
      || c === 95 || c === 36;  // _ $
}

// ── TypeScript Stripping ───────────────────────────────────────

interface StrippedScript {
  cleaned: string;
  propsType: string | null;
  typeImports: ImportInfo[];
}

/**
 * Detect whether a line is an `import type` statement.
 */
function isTypeImportLine(line: string): boolean {
  let i = skipWhitespace(line, 0);
  if (!line.startsWith("import", i)) return false;
  i += 6;
  if (i >= line.length || !isWhitespace(line[i])) return false;
  i = skipWhitespace(line, i);
  if (!line.startsWith("type", i)) return false;
  i += 4;
  return i >= line.length || isWhitespace(line[i]);
}

/**
 * Extract the module specifier from an import line.
 * e.g. `import { foo } from './bar'` → `./bar`
 */
function extractModuleSpecifier(line: string): string {
  const fromIdx = line.indexOf("from");
  if (fromIdx === -1) return "";
  let i = skipWhitespace(line, fromIdx + 4);
  const quote = line[i];
  if (quote !== Chars.DOUBLE_QUOTE && quote !== Chars.SINGLE_QUOTE) return "";
  i++;
  const start = i;
  while (i < line.length && line[i] !== quote) i++;
  return line.slice(start, i);
}

/**
 * Strip a trailing semicolon if present.
 */
function stripTrailingSemicolon(s: string): string {
  return s.endsWith(Chars.SEMICOLON) ? s.slice(0, -1) : s;
}

/**
 * Find the opening `(` of define()'s inner param list.
 * Handles both `define(function name(` and `define((`.
 * Skips non-matching occurrences of "define" (e.g. in `import { define }`).
 * Returns the position immediately after the `(`, or -1 if not found.
 */
function findParamListOpen(source: string): number {
  let searchFrom = 0;
  while (true) {
    const defineIdx = source.indexOf("define", searchFrom);
    if (defineIdx === -1) return -1;
    let i = skipWhitespace(source, defineIdx + 6);
    if (i >= source.length || source[i] !== Chars.OPEN_PAREN) {
      searchFrom = defineIdx + 6;
      continue;
    }
    i = skipWhitespace(source, i + 1);
    if (source.startsWith("function", i)) {
      i += 8;
      while (i < source.length && isIdentChar(source[i])) i++;  // skip optional name
      i = skipWhitespace(source, i);
    }
    if (i >= source.length || source[i] !== Chars.OPEN_PAREN) {
      searchFrom = defineIdx + 6;
      continue;
    }
    return i + 1;
  }
}

/**
 * Strip TypeScript annotations from source before acorn parsing.
 * Handles: import type, props type annotation.
 */
function stripTypeScript(source: string): StrippedScript {
  const typeImports: ImportInfo[] = [];
  let propsType: string | null = null;

  // 1. Strip `import type` lines, record them, preserve line count
  const lines = source.split("\n");
  const cleanedLines: string[] = [];
  for (const line of lines) {
    if (isTypeImportLine(line)) {
      const trimmed = line.trim();
      typeImports.push({
        raw: stripTrailingSemicolon(trimmed),
        source: extractModuleSpecifier(trimmed),
        isTypeOnly: true,
      });
      cleanedLines.push("");
    } else {
      cleanedLines.push(line);
    }
  }
  let cleaned = cleanedLines.join("\n");

  // 2. Find define()'s param list, strip props type annotation
  const paramStart = findParamListOpen(cleaned);
  if (paramStart !== -1) {
    let i = skipWhitespace(cleaned, paramStart);
    const identStart = i;
    while (i < cleaned.length && isIdentChar(cleaned[i])) i++;
    const identEnd = i;
    if (identEnd > identStart) {
      i = skipWhitespace(cleaned, i);
      if (i < cleaned.length && cleaned[i] === Chars.COLON) {
        i = skipWhitespace(cleaned, i + 1);
        const typeResult = scanTypeAnnotation(cleaned, i);
        if (typeResult) {
          propsType = typeResult.type;
          cleaned = cleaned.slice(0, identEnd) + cleaned.slice(typeResult.end);
        }
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
    if (ch === Chars.OPEN_BRACE || ch === Chars.OPEN_PAREN || ch === Chars.OPEN_ANGLE) {
      depth++;
      started = true;
    } else if (ch === Chars.CLOSE_BRACE || ch === Chars.CLOSE_PAREN || ch === Chars.CLOSE_ANGLE) {
      if (depth === 0) {
        // We've hit closing paren or similar at depth 0 — end of type
        const type = source.slice(start, i).trim();
        return type.length > 0 ? { type, end: i } : null;
      }
      depth--;
    } else if (ch === Chars.COMMA && depth === 0 && started) {
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
        raw: stripTrailingSemicolon(source.slice(node.start, node.end)),
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

// ── Shared AST Helpers ────────────────────────────────────────

/**
 * Get the key name from a Property node's key (Identifier or Literal).
 */
function getPropertyKeyName(prop: AcornNode): string | null {
  const key = prop.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  return null;
}

/**
 * Extract parameter names from a function node.
 */
function getParamNames(fn: AcornNode, source: string): string[] {
  return fn.params.map(
    (p: AcornNode) => p.type === "Identifier" ? p.name : source.slice(p.start, p.end),
  );
}

/**
 * Check if a node is a function expression or arrow function.
 */
function isFunctionNode(node: AcornNode): boolean {
  return node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
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
  if (!arg || !isFunctionNode(arg)) {
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
    const name = getPropertyKeyName(prop);
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
    const name = getPropertyKeyName(prop);
    if (!name) continue;

    const value = prop.value;
    if (!isFunctionNode(value)) {
      diagnostics.push(createDiagnostic(
        "error",
        AnalyzerDiagnostics.E206,
        `Action '${name}' is not a function.`,
        null,
        `Define '${name}' as a function expression.`,
      ));
      continue;
    }

    const params = getParamNames(value, source);

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
    const name = getPropertyKeyName(prop);
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
    if (isFunctionNode(value)) {
      const params = getParamNames(value, cleaned);
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

  const output: ScriptAnalysis = { server, client };

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return failure({ output, diagnostics });
  }
  return success({ output, diagnostics });
}
