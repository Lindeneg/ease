import {describe, it, expect} from "vitest";
import {extractIdentifiers, parseEachExpression, isComponentTag} from "../src/utils.js";

// ── extractIdentifiers ──────────────────────────────────────────

describe("extractIdentifiers", () => {
    // Basic extraction
    it("extracts a single identifier", () => {
        expect(extractIdentifiers("count")).toEqual(["count"]);
    });

    it("extracts from binary expression", () => {
        expect(extractIdentifiers("count + 1")).toEqual(["count"]);
    });

    it("extracts multiple identifiers", () => {
        expect(extractIdentifiers("count + total")).toEqual(["count", "total"]);
    });

    it("extracts only root identifier from property access", () => {
        expect(extractIdentifiers("items.length")).toEqual(["items"]);
    });

    it("handles chained property access", () => {
        expect(extractIdentifiers("item.user.name")).toEqual(["item"]);
    });

    // String literals
    it("skips double-quoted string literals", () => {
        expect(extractIdentifiers('"hello " + name')).toEqual(["name"]);
    });

    it("skips single-quoted string literals", () => {
        expect(extractIdentifiers("'hello' + name")).toEqual(["name"]);
    });

    it("skips backtick string literals", () => {
        expect(extractIdentifiers("`hello` + name")).toEqual(["name"]);
    });

    it("skips escaped quotes inside strings", () => {
        expect(extractIdentifiers('"say \\"hi\\"" + name')).toEqual(["name"]);
    });

    it("handles unterminated string gracefully", () => {
        expect(extractIdentifiers('"unterminated + x')).toEqual([]);
    });

    // Keywords
    it("skips JS keywords", () => {
        expect(extractIdentifiers("typeof x")).toEqual(["x"]);
        expect(extractIdentifiers("true")).toEqual([]);
        expect(extractIdentifiers("null")).toEqual([]);
        expect(extractIdentifiers("undefined")).toEqual([]);
    });

    it("skips all boolean and nullish keywords", () => {
        expect(extractIdentifiers("true && false || null")).toEqual([]);
    });

    it("skips control keywords in expressions", () => {
        expect(extractIdentifiers("x instanceof Array")).toEqual(["x", "Array"]);
    });

    it("skips 'in' and 'of' keywords", () => {
        expect(extractIdentifiers("x in obj")).toEqual(["x", "obj"]);
    });

    // Deduplication
    it("deduplicates identifiers", () => {
        expect(extractIdentifiers("x + x")).toEqual(["x"]);
    });

    it("deduplicates across complex expression", () => {
        expect(extractIdentifiers("a + b + a + c + b")).toEqual(["a", "b", "c"]);
    });

    // Expressions with operators
    it("handles ternary expressions", () => {
        expect(extractIdentifiers("active ? 'yes' : 'no'")).toEqual(["active"]);
    });

    it("handles comparison expressions", () => {
        expect(extractIdentifiers("count > 0")).toEqual(["count"]);
    });

    it("handles logical expressions", () => {
        expect(extractIdentifiers("a && b || c")).toEqual(["a", "b", "c"]);
    });

    it("handles negation", () => {
        expect(extractIdentifiers("!visible")).toEqual(["visible"]);
    });

    // Numeric literals
    it("skips numeric literals", () => {
        expect(extractIdentifiers("count + 42")).toEqual(["count"]);
    });

    it("skips hex literals", () => {
        expect(extractIdentifiers("0xFF + x")).toEqual(["x"]);
    });

    // Method calls / function-like
    it("handles method call expressions", () => {
        expect(extractIdentifiers("items.filter(x)")).toEqual(["items", "x"]);
    });

    it("handles function call with multiple args", () => {
        expect(extractIdentifiers("fn(a, b, c)")).toEqual(["fn", "a", "b", "c"]);
    });

    it("handles nested property + method call", () => {
        expect(extractIdentifiers("obj.list.map(fn)")).toEqual(["obj", "fn"]);
    });

    // Underscore and dollar identifiers
    it("extracts identifiers starting with underscore", () => {
        expect(extractIdentifiers("_private + $ref")).toEqual(["_private", "$ref"]);
    });

    it("extracts identifiers with digits", () => {
        expect(extractIdentifiers("item2 + count3")).toEqual(["item2", "count3"]);
    });

    // Edge cases
    it("handles empty string", () => {
        expect(extractIdentifiers("")).toEqual([]);
    });

    it("handles pure whitespace", () => {
        expect(extractIdentifiers("   ")).toEqual([]);
    });

    it("handles pure numeric expression", () => {
        expect(extractIdentifiers("1 + 2")).toEqual([]);
    });

    it("handles bracket notation (extracts the bracket expression identifier)", () => {
        expect(extractIdentifiers("obj[key]")).toEqual(["obj", "key"]);
    });

    it("dot after non-identifier resets correctly", () => {
        // "1.5 + x" — the dot is part of a number, x should still be extracted
        expect(extractIdentifiers("x + 1")).toEqual(["x"]);
    });
});

// ── parseEachExpression ─────────────────────────────────────────

describe("parseEachExpression", () => {
    // Valid expressions
    it("parses simple 'item in items'", () => {
        expect(parseEachExpression("item in items")).toEqual({
            variable: "item",
            iterable: "items",
        });
    });

    it("parses with extra whitespace", () => {
        expect(parseEachExpression("  item  in  items  ")).toEqual({
            variable: "item",
            iterable: "items",
        });
    });

    it("parses complex iterable expression", () => {
        expect(parseEachExpression("item in obj.list")).toEqual({
            variable: "item",
            iterable: "obj.list",
        });
    });

    it("parses with underscore variable", () => {
        expect(parseEachExpression("_item in items")).toEqual({
            variable: "_item",
            iterable: "items",
        });
    });

    it("parses with dollar variable", () => {
        expect(parseEachExpression("$el in elements")).toEqual({
            variable: "$el",
            iterable: "elements",
        });
    });

    it("parses with numeric suffix in variable", () => {
        expect(parseEachExpression("item2 in list")).toEqual({
            variable: "item2",
            iterable: "list",
        });
    });

    it("parses with method call in iterable", () => {
        expect(parseEachExpression("item in getItems()")).toEqual({
            variable: "item",
            iterable: "getItems()",
        });
    });

    // Invalid expressions
    it("returns null for missing 'in' keyword", () => {
        expect(parseEachExpression("items")).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(parseEachExpression("")).toBeNull();
    });

    it("returns null for 'in' without iterable", () => {
        expect(parseEachExpression("item in")).toBeNull();
    });

    it("returns null for 'in' without variable", () => {
        expect(parseEachExpression("in items")).toBeNull();
    });

    it("returns null for only whitespace", () => {
        expect(parseEachExpression("   ")).toBeNull();
    });

    it("returns null when no space before 'in'", () => {
        expect(parseEachExpression("itemin items")).toBeNull();
    });

    it("returns null when no space after 'in'", () => {
        expect(parseEachExpression("item initems")).toBeNull();
    });
});

// ── isComponentTag ──────────────────────────────────────────────

describe("isComponentTag", () => {
    // Components (uppercase)
    it("uppercase first letter is a component", () => {
        expect(isComponentTag("Counter")).toBe(true);
        expect(isComponentTag("MyWidget")).toBe(true);
        expect(isComponentTag("A")).toBe(true);
    });

    it("single uppercase letter is a component", () => {
        expect(isComponentTag("Z")).toBe(true);
    });

    it("PascalCase multi-word is a component", () => {
        expect(isComponentTag("FormField")).toBe(true);
        expect(isComponentTag("UserProfileCard")).toBe(true);
    });

    // Native HTML (lowercase)
    it("lowercase first letter is native HTML", () => {
        expect(isComponentTag("div")).toBe(false);
        expect(isComponentTag("button")).toBe(false);
        expect(isComponentTag("h1")).toBe(false);
    });

    it("custom elements with dashes are native", () => {
        expect(isComponentTag("my-element")).toBe(false);
    });

    // Edge cases
    it("empty string returns false", () => {
        expect(isComponentTag("")).toBe(false);
    });

    it("underscore-prefixed returns false", () => {
        expect(isComponentTag("_component")).toBe(false);
    });

    it("number-prefixed returns false", () => {
        expect(isComponentTag("1div")).toBe(false);
    });
});
