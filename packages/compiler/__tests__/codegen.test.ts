import {describe, it, expect} from "vitest";
import {generate, CodegenDiagnostics} from "../src/codegen/server.js";
import {resolveBindings} from "../src/binding-resolver.js";
import {parseTemplate} from "../src/template-parser.js";
import {analyzeScript} from "../src/script-analyzer.js";
import {unwrap} from "@ease/shared";
import type {CompiledOutput} from "../src/codegen/server.js";
import type {TemplateNode} from "../src/template-parser.js";
import type {ScriptAnalysis} from "../src/script-analyzer.js";
import type {CodegenResult} from "../src/codegen/server.js";
import type {ResultSuccess, ResultFailure} from "@ease/shared";
import type {StageOutput} from "../src/diagnostics.js";

// ── Helpers ─────────────────────────────────────────────────────

type CodegenOutput = StageOutput<CompiledOutput>;

function ok(r: CodegenResult): CodegenOutput {
    expect(r.ok).toBe(true);
    return (r as ResultSuccess<CodegenOutput>).data;
}

function err(r: CodegenResult): CodegenOutput {
    expect(r.ok).toBe(false);
    return (r as ResultFailure<CodegenOutput>).ctx;
}

function tpl(source: string): TemplateNode[] {
    return unwrap(parseTemplate(source)).output;
}

function script(serverSrc: string): ScriptAnalysis {
    return unwrap(analyzeScript(serverSrc, null)).output;
}

/** Run full pipeline: parse template + analyze script + resolve bindings + generate. */
function gen(templateSrc: string, serverSrc: string): CompiledOutput {
    const template = tpl(templateSrc);
    const analysis = script(serverSrc);
    const resolved = unwrap(resolveBindings(template, analysis)).output;
    const result = generate(resolved);
    return ok(result).output;
}

/** Minimal script block with given state fields and actions. */
function minScript(
    state: Record<string, string> = {},
    actions: Record<string, string> = {},
    extras?: {emits?: string[]; propsType?: boolean},
): string {
    const stateEntries = Object.entries(state)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
    const actionEntries = Object.entries(actions)
        .map(([name, body]) => `${name}${body}`)
        .join(",\n      ");
    const emitsLine = extras?.emits ? `, emits: [${extras.emits.map((e) => `"${e}"`).join(", ")}]` : "";
    const propsParam = extras?.propsType ? "props: { label: string }" : "";

    return `
import { define } from '@ease/core';
export default define(function(${propsParam}) {
  return {
    state: { ${stateEntries} },
    actions: { ${actionEntries} }${emitsLine}
  };
});`;
}

const COUNTER_SCRIPT = minScript(
    {count: "0", show: "true", items: "[]"},
    {
        increment: "(state) { state.count++; }",
        toggle: "(state) { state.show = !state.show; }",
    },
);

const COUNTER_WITH_SERVER = `
import { define } from '@ease/core';
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      increment(state) { state.count++; },
      async save(state, ctx) { await ctx.db.save(state); }
    }
  };
});`;

// ── 1. Basic structure ──────────────────────────────────────────

describe("codegen — basic structure", () => {
    it("generates import statement for h", () => {
        const output = gen("<div></div>", COUNTER_SCRIPT);
        expect(output.code).toContain('import { h } from "@ease/runtime";');
    });

    it("generates init() with state field initializers", () => {
        const output = gen("<div></div>", minScript({count: "0", name: '"hello"'}));
        expect(output.code).toContain("export function init(props, ctx)");
        expect(output.code).toContain('count: 0, name: "hello"');
    });

    it("generates render() with state destructuring", () => {
        const output = gen("<div>{{ count }}</div>", COUNTER_SCRIPT);
        expect(output.code).toContain("export function render(state, slots)");
        expect(output.code).toContain("var { count, show, items } = state;");
    });

    it("generates empty actions/serverActions/emits when none exist", () => {
        const output = gen("<div></div>", minScript({x: "0"}));
        expect(output.code).toContain("export var actions = {};");
        expect(output.code).toContain("export var serverActions = [];");
        expect(output.code).toContain("export var emits = [];");
    });

    it("returns correct CompiledMeta", () => {
        const output = gen("<div></div>", COUNTER_WITH_SERVER);
        expect(output.meta).toEqual({
            clientActions: ["increment"],
            serverActions: ["save"],
            emits: [],
            hasProps: false,
            hasSlots: false,
        });
    });
});

// ── 2. Text and interpolation ───────────────────────────────────

describe("codegen — text and interpolation", () => {
    it("static text becomes string literal child", () => {
        const output = gen("<div>Hello world</div>", COUNTER_SCRIPT);
        expect(output.code).toContain('"Hello world"');
    });

    it("interpolation becomes bare expression child", () => {
        const output = gen("<div>{{ count }}</div>", COUNTER_SCRIPT);
        // Should contain count as a bare expression, not wrapped in quotes
        expect(output.code).toMatch(/h\("div", null, count\)/);
    });

    it("mixed text and interpolation become separate children", () => {
        const output = gen("<h1>Count: {{ count }}</h1>", COUNTER_SCRIPT);
        expect(output.code).toContain('"Count:"');
        expect(output.code).toContain("count");
    });

    it("empty interpolation handled gracefully", () => {
        // The template parser produces an interpolation node with empty expression
        // The script analyzer won't complain, but codegen should still work
        const output = gen("<div>{{ }}</div>", minScript({x: "0"}));
        expect(output.code).toContain("h(");
    });
});

// ── 3. Elements and attributes ──────────────────────────────────

describe("codegen — elements and attributes", () => {
    it("static element with no attrs", () => {
        const output = gen("<div></div>", COUNTER_SCRIPT);
        expect(output.code).toContain('h("div", null)');
    });

    it("static attributes", () => {
        const output = gen('<div class="foo" id="bar"></div>', COUNTER_SCRIPT);
        expect(output.code).toContain('class: "foo"');
        expect(output.code).toContain('id: "bar"');
    });

    it("dynamic attribute", () => {
        const output = gen('<input :value="count" />', COUNTER_SCRIPT);
        expect(output.code).toContain("value: count");
    });

    it("boolean attribute", () => {
        const output = gen("<input disabled />", COUNTER_SCRIPT);
        expect(output.code).toContain("disabled: true");
    });

    it("mixed static and dynamic attrs", () => {
        const output = gen('<div class="wrapper" :id="count"></div>', COUNTER_SCRIPT);
        expect(output.code).toContain('class: "wrapper"');
        expect(output.code).toContain("id: count");
    });
});

// ── 4. Events ───────────────────────────────────────────────────

describe("codegen — events", () => {
    it("click event becomes data-ease-click attribute", () => {
        const output = gen('<button @click="increment">Click</button>', COUNTER_SCRIPT);
        expect(output.code).toContain('"data-ease-click": "increment"');
    });

    it("submit event becomes data-ease-submit attribute", () => {
        const scriptSrc = minScript({x: "0"}, {save: "(state) { }"});
        const output = gen('<form @submit="save"></form>', scriptSrc);
        expect(output.code).toContain('"data-ease-submit": "save"');
    });

    it("component event uses data-ease-on- prefix", () => {
        const scriptSrc = minScript({x: "0"}, {handleSave: "(state) { }"});
        const output = gen('<MyComponent @saved="handleSave" />', scriptSrc);
        expect(output.code).toContain('"data-ease-on-saved": "handleSave"');
    });

    it("multiple events on same element", () => {
        const scriptSrc = minScript({x: "0"}, {
            handleClick: "(state) { }",
            handleHover: "(state) { }",
        });
        const output = gen('<button @click="handleClick" @mouseover="handleHover">btn</button>', scriptSrc);
        expect(output.code).toContain('"data-ease-click": "handleClick"');
        expect(output.code).toContain('"data-ease-mouseover": "handleHover"');
    });
});

// ── 5. Conditionals ─────────────────────────────────────────────

describe("codegen — conditionals", () => {
    it("@if alone becomes ternary with null", () => {
        const output = gen(
            '<div><p @if="show">Visible</p></div>',
            COUNTER_SCRIPT,
        );
        expect(output.code).toContain("show ? ");
        expect(output.code).toContain(": null");
    });

    it("@if + @else becomes ternary", () => {
        const output = gen(
            '<div><p @if="show">Yes</p><p @else>No</p></div>',
            COUNTER_SCRIPT,
        );
        expect(output.code).toContain("show ? ");
        expect(output.code).toContain(' : h("p"');
        // Should NOT have trailing null
        expect(output.code).not.toMatch(/: null/);
    });

    it("@if + @else-if + @else becomes nested ternary", () => {
        const output = gen(
            '<div><p @if="count > 0">Positive</p><p @else-if="count < 0">Negative</p><p @else>Zero</p></div>',
            COUNTER_SCRIPT,
        );
        expect(output.code).toContain("count > 0 ? ");
        expect(output.code).toContain("count < 0 ? ");
    });

    it("whitespace between conditional siblings is skipped", () => {
        // Template with whitespace between @if and @else
        const output = gen(
            `<div>
  <p @if="show">Yes</p>
  <p @else>No</p>
</div>`,
            COUNTER_SCRIPT,
        );
        // Should still produce a single ternary, not separate expressions
        expect(output.code).toContain("show ? ");
        expect(output.code).toContain(' : h("p"');
    });

    it("two separate @if chains in same parent", () => {
        const output = gen(
            '<div><p @if="show">A</p><p @else>B</p><span @if="count > 0">C</span></div>',
            COUNTER_SCRIPT,
        );
        // Should have two separate ternary expressions
        expect(output.code).toContain("show ? ");
        expect(output.code).toContain("count > 0 ? ");
    });
});

// ── 6. Loops ────────────────────────────────────────────────────

describe("codegen — loops", () => {
    it("@each generates .map() call", () => {
        const output = gen(
            '<ul><li @each="item in items">{{ item.name }}</li></ul>',
            COUNTER_SCRIPT,
        );
        expect(output.code).toContain("items.map(function(item)");
        expect(output.code).toContain("return h(");
    });

    it("loop with dynamic attrs referencing loop var", () => {
        const output = gen(
            '<ul><li @each="item in items" :class="item.active">{{ item.name }}</li></ul>',
            COUNTER_SCRIPT,
        );
        expect(output.code).toContain("items.map(function(item)");
        expect(output.code).toContain("class: item.active");
    });

    it("loop with interpolation referencing loop var", () => {
        const output = gen(
            '<ul><li @each="item in items">{{ item.label }}</li></ul>',
            COUNTER_SCRIPT,
        );
        expect(output.code).toContain("item.label");
    });

    it("loop element generates correct h() inside map", () => {
        const output = gen(
            '<ul><li @each="item in items">text</li></ul>',
            COUNTER_SCRIPT,
        );
        // The li should be inside the .map callback
        expect(output.code).toContain('return h("li", null, "text")');
    });
});

// ── 7. Slots ────────────────────────────────────────────────────

describe("codegen — slots", () => {
    it("default slot becomes slots.default", () => {
        const output = gen(
            "<div><slot /></div>",
            minScript({x: "0"}),
        );
        expect(output.code).toContain("slots.default");
    });

    it("named slot becomes slots.name", () => {
        const output = gen(
            '<div><slot name="header" /></div>',
            minScript({x: "0"}),
        );
        expect(output.code).toContain("slots.header");
    });

    it("hasSlots meta flag set correctly", () => {
        const withSlot = gen("<div><slot /></div>", minScript({x: "0"}));
        expect(withSlot.meta.hasSlots).toBe(true);

        const withoutSlot = gen("<div>text</div>", minScript({x: "0"}));
        expect(withoutSlot.meta.hasSlots).toBe(false);
    });
});

// ── 8. Actions and server actions ───────────────────────────────

describe("codegen — actions and server actions", () => {
    it("client action appears in actions with body", () => {
        const output = gen("<div></div>", COUNTER_SCRIPT);
        expect(output.code).toContain("export var actions = {");
        expect(output.code).toContain("increment: function(state)");
        expect(output.code).toContain("state.count++");
    });

    it("server action appears in serverActions array, body excluded", () => {
        const output = gen("<div></div>", COUNTER_WITH_SERVER);
        expect(output.code).toContain('export var serverActions = ["save"]');
        // Server action body should NOT appear in the actions object
        expect(output.code).not.toContain("ctx.db.save");
    });

    it("async server action excluded from client actions", () => {
        const output = gen("<div></div>", COUNTER_WITH_SERVER);
        // "save" should be in serverActions, not in actions
        expect(output.code).toContain('serverActions = ["save"]');
        expect(output.code).not.toMatch(/actions\s*=\s*\{[^}]*save/);
    });

    it("action with emit parameter includes emit in signature", () => {
        const scriptSrc = `
import { define } from '@ease/core';
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      notify(state, emit) { emit("change", state.count); }
    },
    emits: ["change"]
  };
});`;
        const output = gen("<div></div>", scriptSrc);
        expect(output.code).toContain("notify: function(state, emit)");
        expect(output.code).toContain('emits = ["change"]');
    });
});

// ── 9. Full components ──────────────────────────────────────────

describe("codegen — full components", () => {
    it("counter component with text + interpolation + event + conditional", () => {
        const output = gen(
            `<div>
  <h1>Count: {{ count }}</h1>
  <button @click="increment">+1</button>
  <p @if="show">Visible!</p>
</div>`,
            COUNTER_SCRIPT,
        );

        // Imports
        expect(output.code).toContain('import { h } from "@ease/runtime"');
        // Init
        expect(output.code).toContain("export function init(props, ctx)");
        // Render with h() calls
        expect(output.code).toContain('h("div"');
        expect(output.code).toContain('h("h1"');
        expect(output.code).toContain('h("button"');
        expect(output.code).toContain('"data-ease-click": "increment"');
        // Conditional
        expect(output.code).toContain("show ? ");
        // Actions
        expect(output.code).toContain("increment: function(state)");
    });

    it("list component with loop + dynamic attrs", () => {
        const output = gen(
            `<ul>
  <li @each="item in items" :class="item.active ? 'on' : 'off'">{{ item.name }}</li>
</ul>`,
            COUNTER_SCRIPT,
        );

        expect(output.code).toContain("items.map(function(item)");
        expect(output.code).toContain("class: item.active ? 'on' : 'off'");
        expect(output.code).toContain("item.name");
    });

    it("layout component with slot + static structure", () => {
        const output = gen(
            `<div class="layout">
  <header>My App</header>
  <main><slot /></main>
  <footer>2026</footer>
</div>`,
            minScript({x: "0"}),
        );

        expect(output.code).toContain('h("div"');
        expect(output.code).toContain('h("header"');
        expect(output.code).toContain('h("main"');
        expect(output.code).toContain("slots.default");
        expect(output.code).toContain('h("footer"');
        expect(output.meta.hasSlots).toBe(true);
    });
});

// ── 10. Error handling ──────────────────────────────────────────

describe("codegen — error handling", () => {
    it("returns error when no server script analysis", () => {
        const template = tpl("<div></div>");
        const analysis: ScriptAnalysis = {server: null, client: null};
        const resolved = unwrap(resolveBindings(template, analysis)).output;
        const result = generate(resolved);

        const output = err(result);
        expect(output.diagnostics).toHaveLength(1);
        expect(output.diagnostics[0].code).toBe(CodegenDiagnostics.E400);
    });

    it("handles empty template", () => {
        const output = gen("", minScript({x: "0"}));
        expect(output.code).toContain("return null");
    });

    it("handles props type in meta", () => {
        const output = gen("<div></div>", minScript({x: "0"}, {}, {propsType: true}));
        expect(output.meta.hasProps).toBe(true);
    });
});
