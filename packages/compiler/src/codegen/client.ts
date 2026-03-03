// Stage 6: Client Codegen
// Generates the tiny client-side module (pure actions + DOM updaters).

import type { ResolvedComponent } from "../binding-resolver.js";

export interface ClientOutput {
  code: string;
  actions: string[]; // names of client-side actions included
}

/**
 * Generate client-side module code.
 * Stub — implementation after resolver is done.
 */
export function generateClient(_component: ResolvedComponent): ClientOutput {
  throw new Error("generateClient not yet implemented");
}
