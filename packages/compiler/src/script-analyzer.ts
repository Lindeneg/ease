// Stage 3: Script Analyzer (acorn-based)
// Parses the <script server> block, extracts state shape and action signatures,
// and classifies actions as client vs server based on ctx parameter usage.

export interface StateField {
  name: string;
  initializer: string; // raw JS expression
}

export interface ActionInfo {
  name: string;
  kind: "client" | "server"; // auto-detected: has ctx → server
  params: string[]; // parameter names beyond state (and ctx for server)
  isAsync: boolean;
  body: string; // raw function body
}

export interface ScriptAnalysis {
  imports: string[];
  state: StateField[];
  actions: ActionInfo[];
  propsType: string | null; // raw TS type string if present
}

/**
 * Analyze a `<script server>` block using acorn.
 * Stub — implementation coming next.
 */
export function analyzeScript(_source: string): ScriptAnalysis {
  throw new Error("analyzeScript not yet implemented");
}
