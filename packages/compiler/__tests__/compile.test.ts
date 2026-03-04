import {describe, it, expect} from "vitest";
import {compile} from "../src/index.js";

const COUNTER_SOURCE = `
<template>
  <div>
    <h1>Count: {{ count }}</h1>
    <button @click="increment">+1</button>
  </div>
</template>

<script server>
import { define } from '@ease/core';
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      increment(state) { state.count++; }
    }
  };
});
</script>
`;

describe("compile() — full pipeline", () => {
    it("compiles a counter component successfully", () => {
        const result = compile(COUNTER_SOURCE);
        const errors = result.diagnostics.diagnostics.filter((d) => d.severity === "error");
        expect(errors).toHaveLength(0);
    });

    it("returns split result with template and server script", () => {
        const result = compile(COUNTER_SOURCE);
        expect(result.split.template).not.toBeNull();
        expect(result.split.serverScript).not.toBeNull();
    });

    it("returns resolved component with template, script, and bindings", () => {
        const result = compile(COUNTER_SOURCE);
        expect(result.resolved.template.length).toBeGreaterThan(0);
        expect(result.resolved.script.server).not.toBeNull();
        expect(result.resolved.bindings.length).toBeGreaterThan(0);
    });

    it("returns generated code with h() calls", () => {
        const result = compile(COUNTER_SOURCE);
        expect(result.output.code).toContain('import { h } from "@ease/runtime"');
        expect(result.output.code).toContain("export function init(");
        expect(result.output.code).toContain("export function render(");
        expect(result.output.code).toContain("export var actions = ");
        expect(result.output.code).toContain('"data-ease-click": "increment"');
    });

    it("returns correct meta", () => {
        const result = compile(COUNTER_SOURCE);
        expect(result.output.meta.clientActions).toEqual(["increment"]);
        expect(result.output.meta.serverActions).toEqual([]);
        expect(result.output.meta.hasSlots).toBe(false);
    });

    it("collects diagnostics from all stages", () => {
        // Bad source — has template errors and script errors
        const badSource = `
<template>
  <div>{{ unknownVar }}</div>
</template>

<script server>
import { define } from '@ease/core';
export default define(function() {
  return {
    state: {},
    actions: {}
  };
});
</script>
`;
        const result = compile(badSource);
        // Should have a warning about unknownVar from the binding resolver
        const warnings = result.diagnostics.diagnostics.filter((d) => d.severity === "warning");
        expect(warnings.length).toBeGreaterThan(0);
    });

    it("includes timing data when option is enabled", () => {
        const result = compile(COUNTER_SOURCE, {timing: true});
        expect(result.diagnostics.timings.length).toBeGreaterThan(0);
        expect(result.diagnostics.timings.map((t) => t.stage)).toContain("split");
        expect(result.diagnostics.timings.map((t) => t.stage)).toContain("codegen");
        expect(result.diagnostics.totalMs).toBeGreaterThanOrEqual(0);
    });

    it("omits timing data by default", () => {
        const result = compile(COUNTER_SOURCE);
        expect(result.diagnostics.timings).toHaveLength(0);
    });
});
