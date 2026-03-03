// Extracts top-level <template>, <script>, and <style> blocks from .ease source.

import {
  createDiagnostic,
  offsetToLocation,
  type Diagnostic,
  type SourceSpan,
} from "./diagnostics.js";

// ── Diagnostic Codes ────────────────────────────────────────────

export const SplitDiagnostics = {
  E001: "E001", // Unclosed block
  E002: "E002", // Duplicate <template>
  E003: "E003", // <script> missing server/client
  E004: "E004", // Duplicate <script server>
  E005: "E005", // Duplicate <script client>
} as const;

// ── Types ───────────────────────────────────────────────────────

/** A raw top-level block extracted from a `.ease` file before any parsing. */
export interface RawBlock {
  /** Which kind of block: template, script, or style */
  type: "template" | "script" | "style";
  /** Attributes on the opening tag, e.g. `{ server: true }` or `{ scoped: true }` */
  attrs: Record<string, string | true>;
  /** The raw text content between the opening and closing tags */
  content: string;
  /** Byte offset of the opening tag in the original source */
  start: number;
  /** Byte offset just past the closing tag in the original source */
  end: number;
}

/** The result of splitting a `.ease` file into its top-level blocks. */
export interface SplitResult {
  /** The single `<template>` block, or null if absent */
  template: RawBlock | null;
  /** The `<script server>` block, or null if absent */
  serverScript: RawBlock | null;
  /** The `<script client>` block, or null if absent */
  clientScript: RawBlock | null;
  /** Zero or more `<style>` blocks (with or without `scoped`) */
  styles: RawBlock[];
  /** Diagnostics collected during splitting */
  diagnostics: Diagnostic[];
}

// ── Internals ───────────────────────────────────────────────────

const BLOCK_OPEN_RE =
  /^<(template|script|style)(\s[^>]*)?\s*>/gm;

function parseAttrs(raw?: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  if (!raw) return attrs;

  const re = /(\w[\w-]*)(?:="([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[2] ?? true;
  }
  return attrs;
}

function spanAt(source: string, start: number, end: number): SourceSpan {
  return {
    start: offsetToLocation(source, start),
    end: offsetToLocation(source, end),
  };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Split a `.ease` file source string into its top-level blocks.
 *
 * Rules:
 * - At most one `<template>` block.
 * - `<script>` blocks must have `server` or `client` attribute.
 * - At most one `<script server>` and one `<script client>`.
 * - Multiple `<style>` blocks allowed (with or without `scoped`).
 * - Content between blocks is ignored (whitespace / comments).
 * - Nested tags of the same name are handled correctly.
 *
 * Errors are collected as diagnostics. Fatal errors also throw a
 * `SplitError` so callers can catch vs. inspect.
 */
export function split(source: string): SplitResult {
  const diagnostics: Diagnostic[] = [];
  const result: SplitResult = {
    template: null,
    serverScript: null,
    clientScript: null,
    styles: [],
    diagnostics,
  };

  // Reset regex
  BLOCK_OPEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BLOCK_OPEN_RE.exec(source)) !== null) {
    const tag = match[1] as RawBlock["type"];
    const attrsRaw = match[2];
    const contentStart = match.index + match[0].length;
    const closingTag = `</${tag}>`;

    // Find the matching closing tag, respecting nesting
    let depth = 1;
    let cursor = contentStart;
    const openPattern = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
    const closePattern = new RegExp(closingTag, "g");

    while (depth > 0) {
      openPattern.lastIndex = cursor;
      closePattern.lastIndex = cursor;

      const nextOpen = openPattern.exec(source);
      const nextClose = closePattern.exec(source);

      if (!nextClose) {
        const span = spanAt(source, match.index, match.index + match[0].length);
        const d = createDiagnostic(
          "error",
          SplitDiagnostics.E001,
          `Unclosed <${tag}> block`,
          span,
          `Add a closing </${tag}> tag`,
        );
        diagnostics.push(d);
        throw new SplitError(d);
      }

      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        cursor = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        if (depth === 0) {
          const content = source.slice(contentStart, nextClose.index);
          const block: RawBlock = {
            type: tag,
            attrs: parseAttrs(attrsRaw),
            content,
            start: match.index,
            end: nextClose.index + closingTag.length,
          };

          if (tag === "template") {
            if (result.template) {
              const span = spanAt(source, match.index, match.index + match[0].length);
              const d = createDiagnostic(
                "error",
                SplitDiagnostics.E002,
                "Only one <template> block is allowed",
                span,
                "Remove the duplicate <template> block",
              );
              diagnostics.push(d);
              throw new SplitError(d);
            }
            result.template = block;
          } else if (tag === "script") {
            validateAndAssignScript(block, match.index, match[0].length, source, result, diagnostics);
          } else {
            result.styles.push(block);
          }

          // Advance the main regex past this entire block
          BLOCK_OPEN_RE.lastIndex = block.end;
        } else {
          cursor = nextClose.index + closingTag.length;
        }
      }
    }
  }

  return result;
}

function validateAndAssignScript(
  block: RawBlock,
  matchIndex: number,
  matchLength: number,
  source: string,
  result: SplitResult,
  diagnostics: Diagnostic[],
): void {
  const isServer = block.attrs.server === true;
  const isClient = block.attrs.client === true;

  // E003: must specify server or client
  if (!isServer && !isClient) {
    const span = spanAt(source, matchIndex, matchIndex + matchLength);
    const d = createDiagnostic(
      "error",
      SplitDiagnostics.E003,
      "<script> must specify `server` or `client`",
      span,
      'Add `server` or `client` to your <script> tag, e.g. <script server>',
    );
    diagnostics.push(d);
    throw new SplitError(d);
  }

  if (isServer) {
    // E004: duplicate <script server>
    if (result.serverScript) {
      const span = spanAt(source, matchIndex, matchIndex + matchLength);
      const d = createDiagnostic(
        "error",
        SplitDiagnostics.E004,
        "Only one <script server> block is allowed",
        span,
        "Merge your server code into a single <script server> block",
      );
      diagnostics.push(d);
      throw new SplitError(d);
    }
    result.serverScript = block;
  } else {
    // E005: duplicate <script client>
    if (result.clientScript) {
      const span = spanAt(source, matchIndex, matchIndex + matchLength);
      const d = createDiagnostic(
        "error",
        SplitDiagnostics.E005,
        "Only one <script client> block is allowed",
        span,
        "Merge your client code into a single <script client> block",
      );
      diagnostics.push(d);
      throw new SplitError(d);
    }
    result.clientScript = block;
  }
}

/**
 * Error thrown by the splitter with an attached diagnostic.
 */
export class SplitError extends Error {
  diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "SplitError";
    this.diagnostic = diagnostic;
  }
}
