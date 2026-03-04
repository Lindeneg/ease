// Client codegen is unified with server codegen — a single module per component.
// This file re-exports from server.ts for backward compatibility.

export type { CompiledOutput as ClientOutput } from "./server.js";
export { generate as generateClient } from "./server.js";
