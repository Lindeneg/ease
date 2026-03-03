// Shared compiler utilities — reusable across pipeline stages.

const JS_KEYWORDS = new Set([
  "true", "false", "null", "undefined",
  "typeof", "instanceof", "new", "in", "of",
  "this", "void", "delete", "throw",
  "await", "async", "yield",
]);

/**
 * Check whether a character is a valid JS identifier start (letter, `_`, or `$`).
 */
function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90)   // A-Z
      || (c >= 97 && c <= 122)  // a-z
      || c === 95 || c === 36;  // _ $
}

/**
 * Check whether a character can continue a JS identifier (letter, digit, `_`, or `$`).
 */
function isIdentChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90)   // A-Z
      || (c >= 97 && c <= 122)  // a-z
      || (c >= 48 && c <= 57)   // 0-9
      || c === 95 || c === 36;  // _ $
}

/**
 * Extract all bare JS identifiers from an expression string.
 *
 * Scans the expression character-by-character, skipping string literals and
 * property accesses (after `.`). Returns a deduplicated array of identifier names,
 * excluding JS keywords like `true`, `false`, `null`, `typeof`, etc.
 *
 * Examples:
 * - `"count"` → `["count"]`
 * - `"count + 1"` → `["count"]`
 * - `"items.length"` → `["items"]`
 * - `'"hello " + name'` → `["name"]`
 */
export function extractIdentifiers(expression: string): string[] {
  const seen = new Set<string>();
  let i = 0;
  let afterDot = false;

  while (i < expression.length) {
    const ch = expression[i];

    // Skip string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(expression, i);
      afterDot = false;
      continue;
    }

    // Track dot access — next identifier is a property, not a root reference
    if (ch === ".") {
      afterDot = true;
      i++;
      continue;
    }

    // Identifier
    if (isIdentStart(ch)) {
      const start = i;
      while (i < expression.length && isIdentChar(expression[i])) i++;
      if (!afterDot) {
        const name = expression.slice(start, i);
        if (!JS_KEYWORDS.has(name)) {
          seen.add(name);
        }
      }
      afterDot = false;
      continue;
    }

    // Digits — skip number literals, don't let them trigger identifier logic
    if (ch >= "0" && ch <= "9") {
      while (i < expression.length && isIdentChar(expression[i])) i++;
      afterDot = false;
      continue;
    }

    // Any other character — reset afterDot
    afterDot = false;
    i++;
  }

  return [...seen];
}

/**
 * Skip past a string literal starting at `pos`.
 * Handles `"..."`, `'...'`, and `` `...` `` (without template expression nesting).
 * Returns the position after the closing quote.
 */
function skipString(source: string, pos: number): number {
  const quote = source[pos];
  pos++;
  while (pos < source.length) {
    if (source[pos] === "\\") {
      pos += 2; // skip escaped character
      continue;
    }
    if (source[pos] === quote) {
      return pos + 1;
    }
    pos++;
  }
  return pos; // unterminated string — return end
}

/** Parsed result of an `@each` directive expression. */
export interface EachExpression {
  /** The loop variable name, e.g. "item" in `item in items` */
  variable: string;
  /** The iterable expression, e.g. "items" or "obj.list" */
  iterable: string;
}

/**
 * Parse an `@each` directive value of the form `"item in items"`.
 *
 * Returns the loop variable and iterable expression, or `null` if the
 * expression doesn't match the expected `variable in expression` pattern.
 */
export function parseEachExpression(expr: string): EachExpression | null {
  const trimmed = expr.trim();

  // Find the loop variable (must be a simple identifier)
  let i = 0;
  while (i < trimmed.length && isIdentChar(trimmed[i])) i++;
  if (i === 0) return null;
  const variable = trimmed.slice(0, i);

  // Expect whitespace + "in" + whitespace
  if (i >= trimmed.length || trimmed[i] !== " ") return null;
  while (i < trimmed.length && trimmed[i] === " ") i++;
  if (!trimmed.startsWith("in", i)) return null;
  i += 2;
  if (i >= trimmed.length || trimmed[i] !== " ") return null;
  while (i < trimmed.length && trimmed[i] === " ") i++;

  const iterable = trimmed.slice(i).trim();
  if (iterable.length === 0) return null;

  return { variable, iterable };
}
