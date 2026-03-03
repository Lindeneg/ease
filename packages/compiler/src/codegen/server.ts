// Stage 5: Server Codegen
// Generates the server-side render function from a resolved component.

import type { ResolvedComponent } from "../binding-resolver.js";

export interface ServerOutput {
  code: string;
  renderFunctionName: string;
}

/**
 * Generate server-side rendering code.
 * Stub — implementation after resolver is done.
 */
export function generateServer(_component: ResolvedComponent): ServerOutput {
  throw new Error("generateServer not yet implemented");
}
