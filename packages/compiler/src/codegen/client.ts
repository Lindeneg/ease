// Generates the tiny client-side module (pure actions + DOM updaters).

import type { ResolvedComponent } from "../binding-resolver.js";

/** The generated client-side module containing pure actions and DOM updaters. */
export interface ClientOutput {
  /** The full generated JS module source code */
  code: string;
  /** Names of client-side actions included in this module */
  actions: string[];
}

/**
 * Generate client-side module code.
 * Stub — implementation after resolver is done.
 */
export function generateClient(_component: ResolvedComponent): ClientOutput {
  throw new Error("generateClient not yet implemented");
}
