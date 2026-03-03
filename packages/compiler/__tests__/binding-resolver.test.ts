import {describe, it, expect} from "vitest";
import {
    resolveBindings,
    ResolverDiagnostics,
    type ResolverResult,
    type ResolvedComponent,
    type Binding,
} from "../src/binding-resolver.js";
import {parseTemplate} from "../src/template-parser.js";
import {analyzeScript, AnalyzerDiagnostics} from "../src/script-analyzer.js";
import type {StageOutput} from "../src/diagnostics.js";
import type {TemplateNode} from "../src/template-parser.js";
import type {ScriptAnalysis} from "../src/script-analyzer.js";
import type {ResultSuccess, ResultFailure} from "@ease/shared";
import {unwrap} from "@ease/shared";

// ── Helpers ─────────────────────────────────────────────────────

type ResolverOutput = StageOutput<ResolvedComponent>;

function ok(r: ResolverResult): ResolverOutput {
    expect(r.ok).toBe(true);
    return (r as ResultSuccess<ResolverOutput>).data;
}

function err(r: ResolverResult): ResolverOutput {
    expect(r.ok).toBe(false);
    return (r as ResultFailure<ResolverOutput>).ctx;
}

function tpl(source: string): TemplateNode[] {
    const r = parseTemplate(source);
    return unwrap(r).output;
}

function script(serverSrc: string): ScriptAnalysis {
    const r = analyzeScript(serverSrc, null);
    return unwrap(r).output;
}

/** Parse template + analyze script + resolve, returning the resolver result. */
function resolve(templateSrc: string, serverSrc: string): ResolverResult {
    return resolveBindings(tpl(templateSrc), script(serverSrc));
}

const COUNTER_SCRIPT = `
export default define(function() {
  return {
    state: { count: 0, show: true, items: [], loading: false },
    actions: {
      increment(state) { state.count++; },
      async save(state, ctx) { await ctx.db.save(state); }
    }
  };
});
`;

// ── extractIdentifiers (utility) ────────────────────────────────

// ── Text interpolation bindings ─────────────────────────────────

describe("resolveBindings — text interpolation", () => {
    it("resolves {{ count }} to a text binding", () => {
        const d = ok(resolve("{{ count }}", COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(1);
        expect(d.output.bindings[0]).toMatchObject({
            type: "text",
            expression: "count",
            target: "count",
            referencedNames: ["count"],
            nodePath: [0],
        });
    });

    it("resolves {{ count + 1 }} with identifier extraction", () => {
        const d = ok(resolve("{{ count + 1 }}", COUNTER_SCRIPT));
        expect(d.output.bindings[0]).toMatchObject({
            type: "text",
            referencedNames: ["count"],
        });
    });

    it("resolves {{ items.length }} extracting only root identifier", () => {
        const d = ok(resolve("{{ items.length }}", COUNTER_SCRIPT));
        expect(d.output.bindings[0]).toMatchObject({
            type: "text",
            referencedNames: ["items"],
        });
    });

    it("resolves nested interpolation with correct nodePath", () => {
        const d = ok(resolve("<div><span>{{ count }}</span></div>", COUNTER_SCRIPT));
        // div[0] → span is child 0 → interpolation is child 0 of span
        const binding = d.output.bindings[0];
        expect(binding.type).toBe("text");
        expect(binding.nodePath).toEqual([0, 0, 0]);
    });

    it("resolves multiple interpolations", () => {
        const d = ok(resolve("<div>{{ count }} and {{ show }}</div>", COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(2);
        expect(d.output.bindings[0].target).toBe("count");
        expect(d.output.bindings[1].target).toBe("show");
    });
});

// ── Event bindings ──────────────────────────────────────────────

describe("resolveBindings — event bindings", () => {
    it("resolves @click='increment' to an event binding", () => {
        const d = ok(resolve('<button @click="increment">+</button>', COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(1);
        expect(d.output.bindings[0]).toMatchObject({
            type: "event",
            expression: "increment",
            target: "increment",
            referencedNames: ["increment"],
            nodePath: [0],
        });
    });

    it("resolves multiple event bindings on different elements", () => {
        const d = ok(
            resolve(
                '<button @click="increment">+</button><button @click="save">Save</button>',
                COUNTER_SCRIPT
            )
        );
        expect(d.output.bindings).toHaveLength(2);
        expect(d.output.bindings[0].target).toBe("increment");
        expect(d.output.bindings[1].target).toBe("save");
    });

    it("errors E300 for unknown action name", () => {
        const f = err(resolve('<button @click="nonexistent">x</button>', COUNTER_SCRIPT));
        expect(f.diagnostics.some((d) => d.code === ResolverDiagnostics.E300)).toBe(true);
        // Still produces a binding (partial result)
        expect(f.output.bindings).toHaveLength(1);
        expect(f.output.bindings[0].target).toBe("nonexistent");
    });

    it("resolves event binding alongside other attributes", () => {
        const d = ok(
            resolve(
                '<button class="btn" @click="increment" :disabled="loading">Go</button>',
                COUNTER_SCRIPT
            )
        );
        const event = d.output.bindings.find((b) => b.type === "event");
        const attr = d.output.bindings.find((b) => b.type === "attr");
        expect(event!.target).toBe("increment");
        expect(attr!.target).toBe("loading");
    });
});

// ── Dynamic attribute bindings ──────────────────────────────────

describe("resolveBindings — dynamic attributes", () => {
    it("resolves :disabled='loading' to an attr binding", () => {
        const d = ok(resolve('<button :disabled="loading">Go</button>', COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(1);
        expect(d.output.bindings[0]).toMatchObject({
            type: "attr",
            expression: "loading",
            target: "loading",
            referencedNames: ["loading"],
        });
    });

    it("resolves :value='count' with correct referencedNames", () => {
        const d = ok(resolve('<input :value="count" />', COUNTER_SCRIPT));
        expect(d.output.bindings[0].referencedNames).toEqual(["count"]);
    });

    it("skips static attributes (no binding created)", () => {
        const d = ok(resolve('<div class="foo"></div>', COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(0);
    });

    it("warns W302 for empty dynamic attribute value", () => {
        const d = ok(resolve('<div :class=""></div>', COUNTER_SCRIPT));
        expect(d.diagnostics.some((diag) => diag.code === ResolverDiagnostics.W302)).toBe(true);
    });
});

// ── Conditional bindings ────────────────────────────────────────

describe("resolveBindings — conditional directives", () => {
    it("resolves @if='show' to a conditional binding", () => {
        const d = ok(resolve('<div @if="show">visible</div>', COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(1);
        expect(d.output.bindings[0]).toMatchObject({
            type: "conditional",
            expression: "show",
            target: "show",
            referencedNames: ["show"],
        });
    });

    it("resolves @else-if to a conditional binding", () => {
        const d = ok(resolve('<div @else-if="loading">loading...</div>', COUNTER_SCRIPT));
        expect(d.output.bindings[0].type).toBe("conditional");
        expect(d.output.bindings[0].referencedNames).toEqual(["loading"]);
    });

    it("resolves @else with empty expression and no W303", () => {
        const d = ok(resolve("<div @else>fallback</div>", COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(1);
        expect(d.output.bindings[0].type).toBe("conditional");
        expect(d.output.bindings[0].expression).toBe("");
        expect(d.diagnostics.some((diag) => diag.code === ResolverDiagnostics.W303)).toBe(false);
    });

    it("warns W303 for empty @if expression", () => {
        const d = ok(resolve('<div @if="">visible</div>', COUNTER_SCRIPT));
        expect(d.diagnostics.some((diag) => diag.code === ResolverDiagnostics.W303)).toBe(true);
    });
});

// ── Loop bindings ───────────────────────────────────────────────

describe("resolveBindings — loop directives", () => {
    it("resolves @each='item in items' to a loop binding", () => {
        const d = ok(resolve('<li @each="item in items">{{ item }}</li>', COUNTER_SCRIPT));
        const loop = d.output.bindings.find((b) => b.type === "loop");
        expect(loop).toMatchObject({
            type: "loop",
            expression: "item in items",
            target: "items",
            referencedNames: ["items"],
        });
    });

    it("loop variable is recognized in child expressions (no W300)", () => {
        const d = ok(resolve('<li @each="item in items">{{ item }}</li>', COUNTER_SCRIPT));
        // No W300 for "item" — it's a loop variable
        expect(
            d.diagnostics.some(
                (diag) => diag.code === ResolverDiagnostics.W300 && diag.message.includes("'item'")
            )
        ).toBe(false);
    });

    it("errors E301 for malformed @each expression", () => {
        const f = err(resolve('<li @each="items">x</li>', COUNTER_SCRIPT));
        expect(f.diagnostics.some((d) => d.code === ResolverDiagnostics.E301)).toBe(true);
    });

    it("loop variable does not leak to siblings", () => {
        const d = ok(
            resolve(
                '<div><li @each="item in items">{{ item }}</li><span>{{ item }}</span></div>',
                COUNTER_SCRIPT
            )
        );
        // The {{ item }} in <span> is a sibling, not a child of the @each element
        // It should produce W300 since "item" is not known outside the loop
        expect(
            d.diagnostics.some(
                (diag) => diag.code === ResolverDiagnostics.W300 && diag.message.includes("'item'")
            )
        ).toBe(true);
    });
});

// ── nodePath computation ────────────────────────────────────────

describe("resolveBindings — nodePath", () => {
    it("assigns [0] for first root-level node", () => {
        const d = ok(resolve("{{ count }}", COUNTER_SCRIPT));
        expect(d.output.bindings[0].nodePath).toEqual([0]);
    });

    it("assigns [0, 0] for first child of first root element", () => {
        const d = ok(resolve("<div>{{ count }}</div>", COUNTER_SCRIPT));
        expect(d.output.bindings[0].nodePath).toEqual([0, 0]);
    });

    it("assigns correct paths for deeply nested structures", () => {
        const d = ok(resolve("<a><b><c>{{ count }}</c></b></a>", COUNTER_SCRIPT));
        expect(d.output.bindings[0].nodePath).toEqual([0, 0, 0, 0]);
    });

    it("accounts for text nodes in sibling indices", () => {
        const d = ok(resolve("<div>text{{ count }}</div>", COUNTER_SCRIPT));
        // "text" is child 0, interpolation is child 1
        expect(d.output.bindings[0].nodePath).toEqual([0, 1]);
    });
});

// ── Validation and warnings ─────────────────────────────────────

describe("resolveBindings — validation", () => {
    it("warns W300 for unknown identifier in interpolation", () => {
        const d = ok(resolve("{{ unknown }}", COUNTER_SCRIPT));
        expect(d.diagnostics).toHaveLength(1);
        expect(d.diagnostics[0].code).toBe(ResolverDiagnostics.W300);
        expect(d.diagnostics[0].message).toContain("'unknown'");
    });

    it("does not warn for known state fields", () => {
        const d = ok(resolve("{{ count }}", COUNTER_SCRIPT));
        expect(d.diagnostics).toHaveLength(0);
    });

    it("warns W301 for empty interpolation", () => {
        const d = ok(resolve("{{  }}", COUNTER_SCRIPT));
        expect(d.diagnostics.some((diag) => diag.code === ResolverDiagnostics.W301)).toBe(true);
    });

    it("collects multiple warnings in one pass", () => {
        const d = ok(resolve("{{ a }} {{ b }} {{ c }}", COUNTER_SCRIPT));
        const w300s = d.diagnostics.filter((diag) => diag.code === ResolverDiagnostics.W300);
        expect(w300s).toHaveLength(3);
    });

    it("does not warn for JS keywords in expressions", () => {
        const d = ok(resolve("{{ typeof count }}", COUNTER_SCRIPT));
        // Only W300 would be for unknown identifiers. "typeof" is a keyword, not warned.
        expect(
            d.diagnostics.some(
                (diag) =>
                    diag.code === ResolverDiagnostics.W300 && diag.message.includes("'typeof'")
            )
        ).toBe(false);
    });
});

// ── Edge cases ──────────────────────────────────────────────────

describe("resolveBindings — edge cases", () => {
    it("returns empty bindings for template with no expressions", () => {
        const d = ok(resolve("<div>hello</div>", COUNTER_SCRIPT));
        expect(d.output.bindings).toHaveLength(0);
        expect(d.diagnostics).toHaveLength(0);
    });

    it("handles empty template array", () => {
        const empty: ScriptAnalysis = {server: null, client: null};
        const d = ok(resolveBindings([], empty));
        expect(d.output.bindings).toHaveLength(0);
    });

    it("handles null server analysis", () => {
        const empty: ScriptAnalysis = {server: null, client: null};
        const nodes = tpl("{{ count }}");
        const d = ok(resolveBindings(nodes, empty));
        // count is unknown since no server analysis
        expect(d.diagnostics.some((diag) => diag.code === ResolverDiagnostics.W300)).toBe(true);
    });

    it("handles string literals in expressions without false positives", () => {
        const d = ok(resolve('{{ "hello " + count }}', COUNTER_SCRIPT));
        expect(d.output.bindings[0].referencedNames).toEqual(["count"]);
        // No W300 for "hello"
        expect(d.diagnostics).toHaveLength(0);
    });
});

// ── Integration ─────────────────────────────────────────────────

describe("resolveBindings — integration", () => {
    it("full counter component", () => {
        const d = ok(
            resolve(
                '<div><span>{{ count }}</span><button @click="increment">+</button><button @click="save">Save</button></div>',
                COUNTER_SCRIPT
            )
        );
        expect(d.output.bindings).toHaveLength(3);

        const text = d.output.bindings.find((b) => b.type === "text")!;
        expect(text.target).toBe("count");

        const events = d.output.bindings.filter((b) => b.type === "event");
        expect(events).toHaveLength(2);
        expect(events[0].target).toBe("increment");
        expect(events[1].target).toBe("save");

        expect(d.diagnostics).toHaveLength(0);
    });

    it("component with all binding types", () => {
        const d = ok(
            resolve(
                '<div @if="show"><ul><li @each="item in items" :class="item.active">{{ item.name }}</li></ul></div>',
                COUNTER_SCRIPT
            )
        );

        const types = d.output.bindings.map((b) => b.type);
        expect(types).toContain("conditional");
        expect(types).toContain("loop");
        expect(types).toContain("attr");
        expect(types).toContain("text");

        // Loop variable "item" should not produce warnings
        expect(
            d.diagnostics.some(
                (diag) => diag.code === ResolverDiagnostics.W300 && diag.message.includes("'item'")
            )
        ).toBe(false);
    });
});

// ── Result pattern ──────────────────────────────────────────────

describe("resolveBindings — result pattern", () => {
    it("returns ok: true with no diagnostics", () => {
        const r = resolve("{{ count }}", COUNTER_SCRIPT);
        expect(r.ok).toBe(true);
    });

    it("returns ok: false with errors and partial bindings", () => {
        const r = resolve('<button @click="nonexistent">x</button>', COUNTER_SCRIPT);
        expect(r.ok).toBe(false);
        const f = err(r);
        expect(f.output.bindings).toHaveLength(1);
        expect(f.diagnostics.some((d) => d.severity === "error")).toBe(true);
    });

    it("returns ok: true with warnings only", () => {
        const r = resolve("{{ unknownVar }}", COUNTER_SCRIPT);
        expect(r.ok).toBe(true);
        const d = ok(r);
        expect(d.diagnostics.some((diag) => diag.severity === "warning")).toBe(true);
    });
});

// ── Component event bindings ───────────────────────────────────

describe("resolveBindings — component event bindings", () => {
    const PARENT_WITH_HANDLER = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      increment(state) { state.count++; },
      handleChildChange(state, value) { state.count = value; }
    }
  };
});`;

    it("resolves @change on component element as component-event binding", () => {
        const d = ok(resolve(
            '<Counter @change="handleChildChange" />',
            PARENT_WITH_HANDLER,
        ));
        const binding = d.output.bindings.find(b => b.type === "component-event");
        expect(binding).toBeDefined();
        expect(binding!.target).toBe("handleChildChange");
        expect(binding!.expression).toBe("handleChildChange");
        expect(binding!.referencedNames).toEqual(["handleChildChange"]);
    });

    it("resolves @click on native element as regular event binding", () => {
        const d = ok(resolve(
            '<button @click="increment">+</button>',
            PARENT_WITH_HANDLER,
        ));
        const binding = d.output.bindings.find(b => b.type === "event");
        expect(binding).toBeDefined();
        expect(binding!.target).toBe("increment");
    });

    it("E302: component event handler is not a known action", () => {
        const f = err(resolve(
            '<Counter @change="nonexistent" />',
            PARENT_WITH_HANDLER,
        ));
        expect(f.diagnostics.some(d => d.code === ResolverDiagnostics.E302)).toBe(true);
        expect(f.output.bindings).toHaveLength(1);
        expect(f.output.bindings[0].type).toBe("component-event");
    });

    it("mixed native events and component events in same template", () => {
        const d = ok(resolve(
            '<div><button @click="increment">+</button><Counter @change="handleChildChange" /></div>',
            PARENT_WITH_HANDLER,
        ));
        const types = d.output.bindings.map(b => b.type);
        expect(types).toContain("event");
        expect(types).toContain("component-event");
    });
});

// ── Multi-layer A→B→C emit propagation ─────────────────────────

describe("resolveBindings — multi-layer emit propagation (A→B→C)", () => {
    // Component C: emits "validated"
    const COMPONENT_C_SCRIPT = `
export default define(function() {
  return {
    state: { isValid: false },
    actions: {
      validate(state, emit) {
        state.isValid = true;
        emit("validated", state.isValid);
      }
    },
    emits: ["validated"]
  };
});`;

    // Component B: listens to C's "validated", does pre-processing, re-emits "submitted"
    const COMPONENT_B_SCRIPT = `
export default define(function() {
  return {
    state: { data: null },
    actions: {
      onChildValidated(state, emit, isValid) {
        if (isValid) {
          state.data = "processed";
          emit("submitted", state.data);
        }
      }
    },
    emits: ["submitted"]
  };
});`;

    // Component A: listens to B's "submitted" — leaf consumer, no emits
    const COMPONENT_A_SCRIPT = `
export default define(function() {
  return {
    state: { result: null },
    actions: {
      onSubmit(state, value) {
        state.result = value;
      }
    }
  };
});`;

    it("Component C: analyzer extracts emits and emit-capable action", () => {
        const r = analyzeScript(COMPONENT_C_SCRIPT, null);
        expect(r.ok).toBe(true);
        const s = (r as any).data.output.server;
        expect(s.emits).toEqual([{name: "validated"}]);
        expect(s.actions[0].hasEmit).toBe(true);
    });

    it("Component B: analyzer extracts emits and action with emit + extra params", () => {
        const r = analyzeScript(COMPONENT_B_SCRIPT, null);
        expect(r.ok).toBe(true);
        const s = (r as any).data.output.server;
        expect(s.emits).toEqual([{name: "submitted"}]);
        expect(s.actions[0].name).toBe("onChildValidated");
        expect(s.actions[0].hasEmit).toBe(true);
        expect(s.actions[0].params).toEqual(["isValid"]);
    });

    it("Component B template: resolver wires C's emit to B's action", () => {
        const d = ok(resolve(
            '<div><FormField @validated="onChildValidated" /></div>',
            COMPONENT_B_SCRIPT,
        ));
        const binding = d.output.bindings.find(b => b.type === "component-event");
        expect(binding).toBeDefined();
        expect(binding!.target).toBe("onChildValidated");
    });

    it("Component A template: resolver wires B's emit to A's action", () => {
        const d = ok(resolve(
            '<div><FormSection @submitted="onSubmit" /></div>',
            COMPONENT_A_SCRIPT,
        ));
        const binding = d.output.bindings.find(b => b.type === "component-event");
        expect(binding).toBeDefined();
        expect(binding!.target).toBe("onSubmit");
    });

    it("Component A: has no emits (leaf consumer)", () => {
        const r = analyzeScript(COMPONENT_A_SCRIPT, null);
        expect(r.ok).toBe(true);
        const s = (r as any).data.output.server;
        expect(s.emits).toEqual([]);
    });
});
