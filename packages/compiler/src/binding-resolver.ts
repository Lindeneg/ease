// Stage 4: Binding Resolver
// Merges template AST + script analysis to resolve bindings:
// - Which interpolations reference which state fields
// - Which event bindings map to which actions
// - Slot resolution

import type { TemplateNode } from "./template-parser.js";
import type { ScriptAnalysis } from "./script-analyzer.js";

export interface Binding {
  type: "text" | "event" | "attr";
  expression: string;
  target: string; // state field or action name
  nodePath: number[]; // path through the template AST
}

export interface ResolvedComponent {
  template: TemplateNode[];
  script: ScriptAnalysis;
  bindings: Binding[];
}

/**
 * Resolve bindings between template and script.
 * Stub — implementation coming later.
 */
export function resolveBindings(
  _template: TemplateNode[],
  _script: ScriptAnalysis,
): ResolvedComponent {
  throw new Error("resolveBindings not yet implemented");
}
