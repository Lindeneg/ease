// Build script — compiles counter.ease into dist/counter.js
//
// Usage: node build.js

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { compile, formatDiagnostic } from "@ease/compiler";

const source = readFileSync(new URL("./counter.ease", import.meta.url), "utf-8");
const result = compile(source, { filename: "counter.ease", timing: true });

// Report diagnostics
for (const d of result.diagnostics.diagnostics) {
    console.log(formatDiagnostic(d));
}

// Check for errors
const errors = result.diagnostics.diagnostics.filter(d => d.severity === "error");
if (errors.length > 0) {
    console.error(`\nCompilation failed with ${errors.length} error(s).`);
    process.exit(1);
}

// Write compiled output
const distDir = new URL("./dist/", import.meta.url);
mkdirSync(distDir, { recursive: true });
writeFileSync(new URL("./dist/counter.js", import.meta.url), result.output.code);

console.log("\nCompiled counter.ease → dist/counter.js");
console.log(`  meta: ${JSON.stringify(result.output.meta)}`);

// Report timings
if (result.diagnostics.timings.length > 0) {
    console.log("\nTimings:");
    for (const t of result.diagnostics.timings) {
        console.log(`  ${t.stage.padEnd(20)} ${t.durationMs.toFixed(1)}ms`);
    }
    console.log(`  ${"total".padEnd(20)} ${result.diagnostics.totalMs.toFixed(1)}ms`);
}
