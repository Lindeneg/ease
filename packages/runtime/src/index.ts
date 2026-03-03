// @ease/runtime — browser-side runtime (stub)

import type { ComponentDef } from "@ease/core";

export interface RuntimeComponent {
  el: HTMLElement;
  update(patch: Record<string, unknown>): void;
  destroy(): void;
}

/**
 * Register a compiled component for client-side hydration.
 * Stub — will be fleshed out after the compiler is working.
 */
export function register(
  _id: string,
  _def: ComponentDef<unknown>,
): RuntimeComponent {
  throw new Error("@ease/runtime is not yet implemented");
}
