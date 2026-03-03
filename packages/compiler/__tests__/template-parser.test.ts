import { describe, it, expect } from "vitest";
import {
  parseTemplate,
  ParseDiagnostics,
  type ParseResult,
  type TemplateNode,
  type TextNode,
  type InterpolationNode,
  type ElementNode,
  type SlotNode,
} from "../src/template-parser.js";
import type { StageOutput } from "../src/diagnostics.js";
import type { ResultSuccess, ResultFailure } from "@ease/shared";

// ── Helpers ─────────────────────────────────────────────────────

type ParseOutput = StageOutput<TemplateNode[]>;

/** Assert ok: true, return the data */
function ok(r: ParseResult): ParseOutput {
  expect(r.ok).toBe(true);
  return (r as ResultSuccess<ParseOutput>).data;
}

/** Assert ok: false, return the failure context */
function err(r: ParseResult): ParseOutput {
  expect(r.ok).toBe(false);
  return (r as ResultFailure<ParseOutput>).ctx;
}

function el(data: ParseOutput, index: number = 0): ElementNode {
  return data.output[index] as ElementNode;
}

function text(data: ParseOutput, index: number = 0): TextNode {
  return data.output[index] as TextNode;
}

function interp(data: ParseOutput, index: number = 0): InterpolationNode {
  return data.output[index] as InterpolationNode;
}

function slot(data: ParseOutput, index: number = 0): SlotNode {
  return data.output[index] as SlotNode;
}

// ── Basics ──────────────────────────────────────────────────────

describe("parseTemplate — basics", () => {
  it("parses plain text", () => {
    const d = ok(parseTemplate("Hello world"));
    expect(d.output).toHaveLength(1);
    expect(text(d).type).toBe("text");
    expect(text(d).value).toBe("Hello world");
    expect(d.diagnostics).toHaveLength(0);
  });

  it("parses interpolation {{ expr }}", () => {
    const d = ok(parseTemplate("{{ count }}"));
    expect(d.output).toHaveLength(1);
    expect(interp(d).type).toBe("interpolation");
    expect(interp(d).expression).toBe("count");
  });

  it("trims whitespace inside interpolation", () => {
    const d = ok(parseTemplate("{{  foo + bar  }}"));
    expect(interp(d).expression).toBe("foo + bar");
  });

  it("parses a simple element", () => {
    const d = ok(parseTemplate("<div></div>"));
    expect(d.output).toHaveLength(1);
    expect(el(d).type).toBe("element");
    expect(el(d).tag).toBe("div");
    expect(el(d).children).toHaveLength(0);
  });

  it("parses nested elements", () => {
    const d = ok(parseTemplate("<div><span>hi</span></div>"));
    expect(el(d).tag).toBe("div");
    const span = el(d).children[0] as ElementNode;
    expect(span.tag).toBe("span");
    expect((span.children[0] as TextNode).value).toBe("hi");
  });

  it("parses mixed text and interpolation", () => {
    const d = ok(parseTemplate("Hello {{ name }}, welcome!"));
    expect(d.output).toHaveLength(3);
    expect(text(d, 0).value).toBe("Hello ");
    expect(interp(d, 1).expression).toBe("name");
    expect(text(d, 2).value).toBe(", welcome!");
  });

  it("parses text inside elements", () => {
    const d = ok(parseTemplate("<p>Hello {{ name }}</p>"));
    const p = el(d);
    expect(p.children).toHaveLength(2);
    expect((p.children[0] as TextNode).value).toBe("Hello ");
    expect((p.children[1] as InterpolationNode).expression).toBe("name");
  });
});

// ── Attributes ──────────────────────────────────────────────────

describe("parseTemplate — attributes", () => {
  it("parses static attributes", () => {
    const d = ok(parseTemplate('<div class="container"></div>'));
    expect(el(d).attrs).toHaveLength(1);
    expect(el(d).attrs[0]).toEqual({ name: "class", value: "container", dynamic: false });
  });

  it("parses dynamic attributes :prop", () => {
    const d = ok(parseTemplate('<input :value="name" />'));
    expect(el(d).attrs).toHaveLength(1);
    expect(el(d).attrs[0]).toEqual({ name: "value", value: "name", dynamic: true });
  });

  it("parses boolean attributes", () => {
    const d = ok(parseTemplate("<input disabled />"));
    expect(el(d).attrs).toHaveLength(1);
    expect(el(d).attrs[0]).toEqual({ name: "disabled", value: null, dynamic: false });
  });

  it("parses single-quoted attribute values", () => {
    const d = ok(parseTemplate("<div class='main'></div>"));
    expect(el(d).attrs[0]).toEqual({ name: "class", value: "main", dynamic: false });
  });

  it("parses multiple attributes", () => {
    const d = ok(parseTemplate('<div id="app" class="root" :data="val"></div>'));
    expect(el(d).attrs).toHaveLength(3);
    expect(el(d).attrs[0]).toEqual({ name: "id", value: "app", dynamic: false });
    expect(el(d).attrs[1]).toEqual({ name: "class", value: "root", dynamic: false });
    expect(el(d).attrs[2]).toEqual({ name: "data", value: "val", dynamic: true });
  });
});

// ── Directives ──────────────────────────────────────────────────

describe("parseTemplate — directives", () => {
  it("parses @click event directive", () => {
    const d = ok(parseTemplate('<button @click="increment">+</button>'));
    const btn = el(d);
    expect(btn.directives).toHaveLength(1);
    expect(btn.directives[0]).toEqual({
      name: "click",
      value: "increment",
      kind: "event",
    });
  });

  it("parses @if conditional directive", () => {
    const d = ok(parseTemplate('<div @if="show">visible</div>'));
    expect(el(d).directives[0]).toEqual({
      name: "if",
      value: "show",
      kind: "conditional",
    });
  });

  it("parses @else-if conditional directive", () => {
    const d = ok(parseTemplate('<div @else-if="other">alt</div>'));
    expect(el(d).directives[0]).toEqual({
      name: "else-if",
      value: "other",
      kind: "conditional",
    });
  });

  it("parses @else conditional directive", () => {
    const d = ok(parseTemplate("<div @else>fallback</div>"));
    expect(el(d).directives[0]).toEqual({
      name: "else",
      value: "",
      kind: "conditional",
    });
  });

  it("parses @each loop directive", () => {
    const d = ok(parseTemplate('<li @each="item in items">{{ item }}</li>'));
    expect(el(d).directives[0]).toEqual({
      name: "each",
      value: "item in items",
      kind: "loop",
    });
  });

  it("parses multiple directives on same element", () => {
    const d = ok(parseTemplate('<div @if="show" @click="toggle"></div>'));
    expect(el(d).directives).toHaveLength(2);
    expect(el(d).directives[0].kind).toBe("conditional");
    expect(el(d).directives[1].kind).toBe("event");
  });

  it("parses directives mixed with attributes", () => {
    const d = ok(parseTemplate('<button class="btn" @click="go" :disabled="loading">Go</button>'));
    const btn = el(d);
    expect(btn.attrs).toHaveLength(2);
    expect(btn.directives).toHaveLength(1);
    expect(btn.attrs[0].name).toBe("class");
    expect(btn.attrs[1].name).toBe("disabled");
    expect(btn.attrs[1].dynamic).toBe(true);
    expect(btn.directives[0].name).toBe("click");
  });
});

// ── Slots ───────────────────────────────────────────────────────

describe("parseTemplate — slots", () => {
  it("parses <slot /> default slot definition", () => {
    const d = ok(parseTemplate("<slot />"));
    expect(d.output).toHaveLength(1);
    expect(slot(d).type).toBe("slot");
    expect(slot(d).name).toBeNull();
  });

  it('parses <slot name="x" /> named slot definition', () => {
    const d = ok(parseTemplate('<slot name="header" />'));
    expect(slot(d).type).toBe("slot");
    expect(slot(d).name).toBe("header");
  });

  it("parses <slot:header> as an element (slot usage with children)", () => {
    const d = ok(parseTemplate("<slot:header><h2>Title</h2></slot:header>"));
    const node = el(d);
    expect(node.type).toBe("element");
    expect(node.tag).toBe("slot:header");
    expect(node.children).toHaveLength(1);
    expect((node.children[0] as ElementNode).tag).toBe("h2");
  });

  it("parses slot definitions inside elements", () => {
    const d = ok(parseTemplate('<div><slot name="content" /></div>'));
    expect(el(d).children).toHaveLength(1);
    expect((el(d).children[0] as SlotNode).type).toBe("slot");
    expect((el(d).children[0] as SlotNode).name).toBe("content");
  });
});

// ── Void & Self-Closing ─────────────────────────────────────────

describe("parseTemplate — void and self-closing", () => {
  it("parses <br> as void element (no closing tag needed)", () => {
    const d = ok(parseTemplate("<br>"));
    expect(el(d).tag).toBe("br");
    expect(el(d).children).toHaveLength(0);
  });

  it("parses <br /> self-closing void element", () => {
    const d = ok(parseTemplate("<br />"));
    expect(el(d).tag).toBe("br");
    expect(el(d).children).toHaveLength(0);
  });

  it("parses <img> with attributes", () => {
    const d = ok(parseTemplate('<img src="photo.jpg" />'));
    const img = el(d);
    expect(img.tag).toBe("img");
    expect(img.attrs[0]).toEqual({ name: "src", value: "photo.jpg", dynamic: false });
    expect(img.children).toHaveLength(0);
  });

  it("parses self-closing component", () => {
    const d = ok(parseTemplate('<Button label="Go" />'));
    const btn = el(d);
    expect(btn.tag).toBe("Button");
    expect(btn.attrs[0].value).toBe("Go");
    expect(btn.children).toHaveLength(0);
  });

  it("parses void element between other elements", () => {
    const d = ok(parseTemplate("<div>before<br>after</div>"));
    expect(el(d).children).toHaveLength(3);
    expect((el(d).children[0] as TextNode).value).toBe("before");
    expect((el(d).children[1] as ElementNode).tag).toBe("br");
    expect((el(d).children[2] as TextNode).value).toBe("after");
  });
});

// ── Comments ────────────────────────────────────────────────────

describe("parseTemplate — comments", () => {
  it("skips HTML comments (no AST node)", () => {
    const d = ok(parseTemplate("<!-- this is a comment -->"));
    expect(d.output).toHaveLength(0);
  });

  it("skips comments between elements", () => {
    const d = ok(parseTemplate("<div></div><!-- separator --><span></span>"));
    expect(d.output).toHaveLength(2);
    expect(el(d, 0).tag).toBe("div");
    expect(el(d, 1).tag).toBe("span");
  });

  it("skips comments inside elements", () => {
    const d = ok(parseTemplate("<div><!-- hidden --><span></span></div>"));
    expect(el(d).children).toHaveLength(1);
    expect((el(d).children[0] as ElementNode).tag).toBe("span");
  });
});

// ── Edge Cases ──────────────────────────────────────────────────

describe("parseTemplate — edge cases", () => {
  it("handles empty template", () => {
    const d = ok(parseTemplate(""));
    expect(d.output).toHaveLength(0);
    expect(d.diagnostics).toHaveLength(0);
  });

  it("handles whitespace-only template", () => {
    const d = ok(parseTemplate("   \n  \t  "));
    expect(d.output).toHaveLength(1);
    expect(text(d).value).toBe("   \n  \t  ");
  });

  it("parses deeply nested elements", () => {
    const d = ok(parseTemplate("<a><b><c><d>deep</d></c></b></a>"));
    const a = el(d);
    const b = a.children[0] as ElementNode;
    const c = b.children[0] as ElementNode;
    const dd = c.children[0] as ElementNode;
    expect(dd.tag).toBe("d");
    expect((dd.children[0] as TextNode).value).toBe("deep");
  });

  it("preserves whitespace as text nodes", () => {
    const d = ok(parseTemplate("<div>  <span></span>  </div>"));
    expect(el(d).children).toHaveLength(3);
    expect((el(d).children[0] as TextNode).value).toBe("  ");
    expect((el(d).children[1] as ElementNode).tag).toBe("span");
    expect((el(d).children[2] as TextNode).value).toBe("  ");
  });

  it("handles multiple root elements", () => {
    const d = ok(parseTemplate("<div></div><span></span>"));
    expect(d.output).toHaveLength(2);
    expect(el(d, 0).tag).toBe("div");
    expect(el(d, 1).tag).toBe("span");
  });
});

// ── Error Diagnostics ───────────────────────────────────────────

describe("parseTemplate — error diagnostics", () => {
  it("reports unclosed interpolation (E100) and recovers", () => {
    const f = err(parseTemplate("{{ oops"));
    expect(f.diagnostics).toHaveLength(1);
    expect(f.diagnostics[0].code).toBe(ParseDiagnostics.E100);
    expect(f.diagnostics[0].severity).toBe("error");
    expect(f.diagnostics[0].hint).toContain("}}");
    expect(f.diagnostics[0].span).not.toBeNull();
    // Returns partial interpolation node
    expect(f.output).toHaveLength(1);
    expect(interp(f).expression).toBe("oops");
  });

  it("reports unclosed element as non-fatal diagnostic (E104)", () => {
    const f = err(parseTemplate("<div>content"));
    expect(f.diagnostics).toHaveLength(1);
    expect(f.diagnostics[0].code).toBe(ParseDiagnostics.E104);
    expect(f.diagnostics[0].message).toContain("<div>");
    // Still returns partial AST
    expect(el(f).tag).toBe("div");
    expect((el(f).children[0] as TextNode).value).toBe("content");
  });

  it("reports unexpected closing tag as non-fatal diagnostic (E105)", () => {
    const f = err(parseTemplate("<div></span>"));
    expect(f.diagnostics).toHaveLength(1);
    expect(f.diagnostics[0].code).toBe(ParseDiagnostics.E105);
    expect(f.diagnostics[0].message).toContain("</span>");
  });

  it("reports mismatched closing tag", () => {
    const f = err(parseTemplate("<div><span>text</div>"));
    const codes = f.diagnostics.map((d) => d.code);
    expect(codes).toContain(ParseDiagnostics.E104);
  });

  it("includes source spans in diagnostics", () => {
    const f = err(parseTemplate("{{ x"));
    expect(f.diagnostics).toHaveLength(1);
    expect(f.diagnostics[0].span).not.toBeNull();
    expect(f.diagnostics[0].span!.start.line).toBe(1);
    expect(f.diagnostics[0].span!.start.column).toBe(1);
  });

  it("reports unclosed comment as warning (W100)", () => {
    // Warning only — still ok: true since no errors
    const d = ok(parseTemplate("<!-- no end"));
    expect(d.diagnostics).toHaveLength(1);
    expect(d.diagnostics[0].code).toBe(ParseDiagnostics.W100);
    expect(d.diagnostics[0].severity).toBe("warning");
  });

  it("reports unclosed attribute value (E103)", () => {
    const f = err(parseTemplate('<div class="oops></div>'));
    const codes = f.diagnostics.map((d) => d.code);
    expect(codes).toContain(ParseDiagnostics.E103);
  });

  it("collects multiple errors in a single pass", () => {
    // Two unclosed elements — both should be reported
    const f = err(parseTemplate("<div><span>text"));
    expect(f.diagnostics.length).toBeGreaterThanOrEqual(2);
    const codes = f.diagnostics.map((d) => d.code);
    // Both unclosed <span> and unclosed <div>
    expect(codes.filter((c) => c === ParseDiagnostics.E104)).toHaveLength(2);
    // Partial AST is still returned
    expect(el(f).tag).toBe("div");
  });
});

// ── Integration: Counter Component ──────────────────────────────

describe("parseTemplate — integration: counter component", () => {
  const template = `<div>
  <span>{{ count }}</span>
  <button @click="increment">+</button>
  <button @click="save">Save</button>
</div>`;

  it("parses the full counter template", () => {
    const d = ok(parseTemplate(template));
    expect(d.output).toHaveLength(1);

    const root = el(d);
    expect(root.tag).toBe("div");

    // Filter to element children (skip whitespace text nodes)
    const elements = root.children.filter(
      (c): c is ElementNode => c.type === "element",
    );
    expect(elements).toHaveLength(3);

    // <span>{{ count }}</span>
    const span = elements[0];
    expect(span.tag).toBe("span");
    expect((span.children[0] as InterpolationNode).expression).toBe("count");

    // <button @click="increment">+</button>
    const btn1 = elements[1];
    expect(btn1.tag).toBe("button");
    expect(btn1.directives[0].name).toBe("click");
    expect(btn1.directives[0].value).toBe("increment");
    expect(btn1.directives[0].kind).toBe("event");

    // <button @click="save">Save</button>
    const btn2 = elements[2];
    expect(btn2.directives[0].value).toBe("save");
  });
});

// ── Integration: Card with Slots ────────────────────────────────

describe("parseTemplate — integration: card slot component", () => {
  const definition = `<div class="card">
  <header><slot name="header" /></header>
  <main><slot /></main>
  <footer><slot name="footer" /></footer>
</div>`;

  it("parses slot definitions in a card component", () => {
    const d = ok(parseTemplate(definition));
    const root = el(d);
    expect(root.tag).toBe("div");
    expect(root.attrs[0].value).toBe("card");

    const elements = root.children.filter(
      (c): c is ElementNode => c.type === "element",
    );
    expect(elements).toHaveLength(3);

    // <header> contains <slot name="header" />
    const headerSlot = elements[0].children.find(
      (c): c is SlotNode => c.type === "slot",
    )!;
    expect(headerSlot.name).toBe("header");

    // <main> contains default <slot />
    const mainSlot = elements[1].children.find(
      (c): c is SlotNode => c.type === "slot",
    )!;
    expect(mainSlot.name).toBeNull();

    // <footer> contains <slot name="footer" />
    const footerSlot = elements[2].children.find(
      (c): c is SlotNode => c.type === "slot",
    )!;
    expect(footerSlot.name).toBe("footer");
  });

  const usage = `<Card elevated>
  <slot:header><h2>Title</h2></slot:header>
  <p>Default slot content</p>
  <slot:footer><Button label="Close" /></slot:footer>
</Card>`;

  it("parses slot usage with children", () => {
    const d = ok(parseTemplate(usage));
    const card = el(d);
    expect(card.tag).toBe("Card");
    expect(card.attrs[0]).toEqual({ name: "elevated", value: null, dynamic: false });

    const elements = card.children.filter(
      (c): c is ElementNode => c.type === "element",
    );
    expect(elements).toHaveLength(3);

    // <slot:header>
    expect(elements[0].tag).toBe("slot:header");
    expect((elements[0].children[0] as ElementNode).tag).toBe("h2");

    // <p>
    expect(elements[1].tag).toBe("p");

    // <slot:footer>
    expect(elements[2].tag).toBe("slot:footer");
    const footerBtn = elements[2].children[0] as ElementNode;
    expect(footerBtn.tag).toBe("Button");
    expect(footerBtn.attrs[0].value).toBe("Close");
  });
});
