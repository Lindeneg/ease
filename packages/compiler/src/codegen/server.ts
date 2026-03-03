// Generates the server-side render function from a resolved component.

import type { ResolvedComponent } from "../binding-resolver.js";

/** The generated server-side rendering module for a component. */
export interface ServerOutput {
  /** The full generated JS module source code */
  code: string;
  /** The exported render function name, e.g. "render" */
  renderFunctionName: string;
}

/**
 * Generate server-side rendering code.
 * Stub — implementation after resolver is done.
 */
export function generateServer(_component: ResolvedComponent): ServerOutput {
  throw new Error("generateServer not yet implemented");
}
