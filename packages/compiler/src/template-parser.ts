// Stage 2: Template Parser (recursive descent)
// Parses template HTML into an AST with directives, slots, and bindings.

import {
  createDiagnostic,
  offsetToLocation,
  type Diagnostic,
  type SourceSpan,
} from "./diagnostics.js";
import { success, failure, Tokens, type Result } from "@ease/shared";

// ── AST Node Types ──────────────────────────────────────────────

export interface TextNode {
  type: "text";
  value: string;
}

export interface InterpolationNode {
  type: "interpolation";
  expression: string;
}

export interface ElementNode {
  type: "element";
  tag: string;
  attrs: AttrNode[];
  directives: DirectiveNode[];
  children: TemplateNode[];
}

export interface AttrNode {
  name: string;
  value: string | null;
  dynamic: boolean; // :prop="expr" → dynamic
}

export interface DirectiveNode {
  name: string; // "if", "each", "click", etc.
  value: string;
  kind: "event" | "conditional" | "loop";
}

export interface SlotNode {
  type: "slot";
  name: string | null; // null = default slot
}

export type TemplateNode =
  | TextNode
  | InterpolationNode
  | ElementNode
  | SlotNode;

// ── Result Types ────────────────────────────────────────────────

export interface ParseData {
  nodes: TemplateNode[];
  diagnostics: Diagnostic[]; // warnings only when ok: true
}

export interface ParseFailure {
  nodes: TemplateNode[];       // partial AST for tooling/IDE
  diagnostics: Diagnostic[];   // contains at least one error
}

export type ParseResult = Result<ParseData, ParseFailure>;

// ── Diagnostic Codes ────────────────────────────────────────────

export const ParseDiagnostics = {
  E100: "E100", // Unclosed interpolation
  E101: "E101", // Expected tag name
  E102: "E102", // Expected attribute name
  E103: "E103", // Unclosed attribute value
  E104: "E104", // Unclosed element
  E105: "E105", // Unexpected closing tag
  E106: "E106", // Expected > or />
  W100: "W100", // Unclosed HTML comment
} as const;

// ── Constants ───────────────────────────────────────────────────

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const CONDITIONAL_DIRECTIVES = new Set(["if", "else-if", "else"]);

// ── Internal Parser Class ───────────────────────────────────────

class Parser {
  source: string;
  pos: number;
  diagnostics: Diagnostic[];

  constructor(source: string) {
    this.source = source;
    this.pos = 0;
    this.diagnostics = [];
  }

  // ── Helpers ─────────────────────────────────────────────────

  private peek(): string {
    return this.source[this.pos] ?? "";
  }

  private eof(): boolean {
    return this.pos >= this.source.length;
  }

  private match(str: string): boolean {
    return this.source.startsWith(str, this.pos);
  }

  private advance(n: number = 1): void {
    this.pos += n;
  }

  private spanAt(start: number, end: number): SourceSpan {
    return {
      start: offsetToLocation(this.source, start),
      end: offsetToLocation(this.source, end),
    };
  }

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  // ── Main Parse ──────────────────────────────────────────────

  parse(): TemplateNode[] {
    return this.parseChildren(null);
  }

  private parseChildren(parentTag: string | null): TemplateNode[] {
    const children: TemplateNode[] = [];

    while (!this.eof()) {
      // Check for closing tag of parent
      if (parentTag !== null && this.match(Tokens.CLOSING_TAG_OPEN)) {
        break;
      }

      if (this.match(Tokens.INTERPOLATION_OPEN)) {
        children.push(this.parseInterpolation());
      } else if (this.match(Tokens.COMMENT_OPEN)) {
        this.parseComment();
      } else if (this.match(Tokens.TAG_OPEN)) {
        children.push(this.parseElement(parentTag));
      } else {
        children.push(this.parseText());
      }
    }

    return children;
  }

  // ── Text ────────────────────────────────────────────────────

  private parseText(): TextNode {
    const start = this.pos;
    while (
      !this.eof() &&
      !this.match(Tokens.TAG_OPEN) &&
      !this.match(Tokens.INTERPOLATION_OPEN)
    ) {
      this.advance();
    }
    return { type: "text", value: this.source.slice(start, this.pos) };
  }

  // ── Interpolation ──────────────────────────────────────────

  private parseInterpolation(): InterpolationNode {
    const start = this.pos;
    this.advance(Tokens.INTERPOLATION_OPEN.length);

    const exprStart = this.pos;
    while (!this.eof() && !this.match(Tokens.INTERPOLATION_CLOSE)) {
      this.advance();
    }

    if (this.eof()) {
      const span = this.spanAt(start, this.pos);
      this.diagnostics.push(
        createDiagnostic(
          "error",
          ParseDiagnostics.E100,
          "Unclosed interpolation",
          span,
          `Add a closing \`${Tokens.INTERPOLATION_CLOSE}\``,
        ),
      );
      // Recover: treat everything consumed as the expression
      const expression = this.source.slice(exprStart, this.pos).trim();
      return { type: "interpolation", expression };
    }

    const expression = this.source.slice(exprStart, this.pos).trim();
    this.advance(Tokens.INTERPOLATION_CLOSE.length);
    return { type: "interpolation", expression };
  }

  // ── Comment ─────────────────────────────────────────────────

  private parseComment(): void {
    const start = this.pos;
    this.advance(Tokens.COMMENT_OPEN.length);

    while (!this.eof() && !this.match(Tokens.COMMENT_CLOSE)) {
      this.advance();
    }

    if (this.eof()) {
      const span = this.spanAt(start, this.pos);
      this.diagnostics.push(
        createDiagnostic(
          "warning",
          ParseDiagnostics.W100,
          "Unclosed HTML comment",
          span,
          `Add a closing \`${Tokens.COMMENT_CLOSE}\``,
        ),
      );
      return;
    }

    this.advance(Tokens.COMMENT_CLOSE.length);
  }

  // ── Element ─────────────────────────────────────────────────

  private parseElement(parentTag: string | null): ElementNode | SlotNode | TextNode {
    const elStart = this.pos;
    this.advance(Tokens.TAG_OPEN.length);

    const tag = this.parseTagName(elStart);

    // Recovery: no valid tag name — emit `<` as text
    if (tag === "") {
      return { type: "text", value: Tokens.TAG_OPEN };
    }

    const { attrs, directives } = this.parseAttributes();
    const selfClosing = this.parseSelfClose(elStart);

    // Slot definition: <slot /> or <slot name="x" />
    if (tag === "slot" && !tag.includes(Tokens.DYNAMIC_ATTR_PREFIX)) {
      return this.buildSlotNode(attrs);
    }

    const isVoid = VOID_ELEMENTS.has(tag.toLowerCase());

    if (selfClosing || isVoid) {
      return {
        type: "element",
        tag,
        attrs,
        directives,
        children: [],
      };
    }

    // Parse children and expect closing tag
    const children = this.parseChildren(tag);
    this.parseClosingTag(tag, elStart, parentTag);

    return {
      type: "element",
      tag,
      attrs,
      directives,
      children,
    };
  }

  private parseTagName(elStart: number): string {
    const start = this.pos;

    // Tag name can contain letters, digits, hyphens, and colons (for slot:name)
    while (
      !this.eof() &&
      /[a-zA-Z0-9\-_:]/.test(this.peek())
    ) {
      this.advance();
    }

    const name = this.source.slice(start, this.pos);

    if (name.length === 0) {
      const span = this.spanAt(elStart, this.pos);
      this.diagnostics.push(
        createDiagnostic(
          "error",
          ParseDiagnostics.E101,
          "Expected tag name",
          span,
          `Add a valid tag name after \`${Tokens.TAG_OPEN}\``,
        ),
      );
      // Recover: return empty string — caller will treat `<` as text
      return "";
    }

    return name;
  }

  private parseAttributes(): {
    attrs: AttrNode[];
    directives: DirectiveNode[];
  } {
    const attrs: AttrNode[] = [];
    const directives: DirectiveNode[] = [];

    while (!this.eof()) {
      this.skipWhitespace();

      const ch = this.peek();
      if (ch === Tokens.TAG_CLOSE || ch === "/" || this.eof()) break;

      if (ch === Tokens.DIRECTIVE_PREFIX) {
        const dir = this.parseDirective();
        if (dir.name !== "") directives.push(dir);
      } else if (ch === Tokens.DYNAMIC_ATTR_PREFIX) {
        const attr = this.parseDynamicAttr();
        if (attr.name !== "") attrs.push(attr);
      } else {
        const attr = this.parseStaticAttr();
        if (attr.name !== "") attrs.push(attr);
      }
    }

    return { attrs, directives };
  }

  private parseDirective(): DirectiveNode {
    this.advance(); // skip @
    const name = this.parseAttrName();

    let value = "";
    if (this.peek() === Tokens.ATTR_ASSIGN) {
      this.advance();
      value = this.parseAttrValue();
    }

    let kind: DirectiveNode["kind"];
    if (CONDITIONAL_DIRECTIVES.has(name)) {
      kind = "conditional";
    } else if (name === "each") {
      kind = "loop";
    } else {
      kind = "event";
    }

    return { name, value, kind };
  }

  private parseDynamicAttr(): AttrNode {
    this.advance(); // skip :
    const name = this.parseAttrName();

    let value: string | null = null;
    if (this.peek() === Tokens.ATTR_ASSIGN) {
      this.advance();
      value = this.parseAttrValue();
    }

    return { name, value, dynamic: true };
  }

  private parseStaticAttr(): AttrNode {
    const name = this.parseAttrName();

    if (this.peek() === Tokens.ATTR_ASSIGN) {
      this.advance();
      const value = this.parseAttrValue();
      return { name, value, dynamic: false };
    }

    // Boolean attribute (no value)
    return { name, value: null, dynamic: false };
  }

  private parseAttrName(): string {
    const start = this.pos;
    while (
      !this.eof() &&
      /[a-zA-Z0-9\-_]/.test(this.peek())
    ) {
      this.advance();
    }
    const name = this.source.slice(start, this.pos);
    if (name.length === 0) {
      const span = this.spanAt(start, this.pos + 1);
      this.diagnostics.push(
        createDiagnostic(
          "error",
          ParseDiagnostics.E102,
          "Expected attribute name",
          span,
          "Provide a valid attribute name",
        ),
      );
      // Recover: skip the bad character so the attribute loop can continue
      this.advance();
      return "";
    }
    return name;
  }

  private parseAttrValue(): string {
    const quote = this.peek();
    if (quote === Tokens.DOUBLE_QUOTE || quote === Tokens.SINGLE_QUOTE) {
      this.advance(); // skip opening quote
      const start = this.pos;

      while (!this.eof() && this.peek() !== quote) {
        this.advance();
      }

      if (this.eof()) {
        const span = this.spanAt(start - 1, this.pos);
        this.diagnostics.push(
          createDiagnostic(
            "error",
            ParseDiagnostics.E103,
            "Unclosed attribute value",
            span,
            `Add a closing \`${quote}\``,
          ),
        );
        return this.source.slice(start, this.pos);
      }

      const value = this.source.slice(start, this.pos);
      this.advance(); // skip closing quote
      return value;
    }

    // Unquoted attribute value — consume until whitespace, >, or /
    const start = this.pos;
    while (!this.eof() && !/[\s>\/]/.test(this.peek())) {
      this.advance();
    }
    return this.source.slice(start, this.pos);
  }

  private parseSelfClose(elStart: number): boolean {
    this.skipWhitespace();

    if (this.match(Tokens.SELF_CLOSE)) {
      this.advance(Tokens.SELF_CLOSE.length);
      return true;
    }

    if (this.peek() === Tokens.TAG_CLOSE) {
      this.advance();
      return false;
    }

    // Missing > or />
    const span = this.spanAt(elStart, this.pos);
    this.diagnostics.push(
      createDiagnostic(
        "error",
        ParseDiagnostics.E106,
        `Expected \`${Tokens.TAG_CLOSE}\` or \`${Tokens.SELF_CLOSE}\``,
        span,
        `Close the tag with \`${Tokens.TAG_CLOSE}\` or \`${Tokens.SELF_CLOSE}\` for self-closing`,
      ),
    );
    // Recover: assume `>` and continue parsing children
    return false;
  }

  private buildSlotNode(attrs: AttrNode[]): SlotNode {
    const nameAttr = attrs.find((a) => a.name === "name");
    return {
      type: "slot",
      name: nameAttr?.value ?? null,
    };
  }

  private parseClosingTag(
    expectedTag: string,
    elStart: number,
    parentTag: string | null,
  ): void {
    if (!this.match(Tokens.CLOSING_TAG_OPEN)) {
      // EOF without closing tag
      const span = this.spanAt(elStart, this.pos);
      this.diagnostics.push(
        createDiagnostic(
          "error",
          ParseDiagnostics.E104,
          `Unclosed element \`<${expectedTag}>\``,
          span,
          `Add a closing \`</${expectedTag}>\` tag`,
        ),
      );
      return;
    }

    const closeStart = this.pos;
    this.advance(Tokens.CLOSING_TAG_OPEN.length);
    const closingName = this.parseClosingTagName();

    this.skipWhitespace();
    if (this.peek() === Tokens.TAG_CLOSE) {
      this.advance();
    }

    if (closingName !== expectedTag) {
      const span = this.spanAt(closeStart, this.pos);

      // Is this actually the parent's closing tag? If so, report unclosed child and don't consume.
      if (closingName === parentTag) {
        this.diagnostics.push(
          createDiagnostic(
            "error",
            ParseDiagnostics.E104,
            `Unclosed element \`<${expectedTag}>\``,
            span,
            `Add a closing \`</${expectedTag}>\` tag before \`</${closingName}>\``,
          ),
        );
        // Rewind so the parent can consume its closing tag
        this.pos = closeStart;
        return;
      }

      this.diagnostics.push(
        createDiagnostic(
          "error",
          ParseDiagnostics.E105,
          `Unexpected closing tag \`</${closingName}>\``,
          span,
          `Expected \`</${expectedTag}>\` but found \`</${closingName}>\``,
        ),
      );
    }
  }

  private parseClosingTagName(): string {
    const start = this.pos;
    while (
      !this.eof() &&
      /[a-zA-Z0-9\-_:]/.test(this.peek())
    ) {
      this.advance();
    }
    return this.source.slice(start, this.pos);
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Parse a template string into an AST.
 *
 * Returns `ok: true` with nodes and diagnostics (warnings only) on success.
 * Returns `ok: false` with partial nodes and all diagnostics (including errors) on failure.
 */
export function parseTemplate(source: string): ParseResult {
  const parser = new Parser(source);
  const nodes = parser.parse();
  const { diagnostics } = parser;

  const hasErrors = diagnostics.some((d) => d.severity === "error");

  if (hasErrors) {
    return failure({ nodes, diagnostics });
  }

  return success({ nodes, diagnostics });
}
