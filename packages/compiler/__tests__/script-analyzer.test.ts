import { describe, it, expect } from "vitest";
import {
  analyzeScript,
  AnalyzerDiagnostics,
  type AnalyzerResult,
  type ScriptAnalysis,
  type ServerAnalysis,
  type ClientAnalysis,
} from "../src/script-analyzer.js";
import type { StageOutput } from "../src/diagnostics.js";
import type { ResultSuccess, ResultFailure } from "@ease/shared";

// ── Helpers ─────────────────────────────────────────────────────

type AnalyzerOutput = StageOutput<ScriptAnalysis>;

function ok(r: AnalyzerResult): AnalyzerOutput {
  expect(r.ok).toBe(true);
  return (r as ResultSuccess<AnalyzerOutput>).data;
}

function err(r: AnalyzerResult): AnalyzerOutput {
  expect(r.ok).toBe(false);
  return (r as ResultFailure<AnalyzerOutput>).ctx;
}

function server(d: AnalyzerOutput): ServerAnalysis {
  expect(d.output.server).not.toBeNull();
  return d.output.server!;
}

function client(d: AnalyzerOutput): ClientAnalysis {
  expect(d.output.client).not.toBeNull();
  return d.output.client!;
}

// ── Server — basic extraction ──────────────────────────────────

describe("analyzeScript — server basic extraction", () => {
  it("extracts imports", () => {
    const source = `
import { something } from './util.js';
import { other } from '@ease/core';

export default define(function() {
  return {
    state: {},
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.imports).toHaveLength(2);
    expect(s.imports[0].source).toBe("./util.js");
    expect(s.imports[0].isTypeOnly).toBe(false);
    expect(s.imports[1].source).toBe("@ease/core");
  });

  it("extracts state fields", () => {
    const source = `
export default define(function() {
  return {
    state: {
      count: 0,
      name: "hello",
      items: []
    },
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.state).toHaveLength(3);
    expect(s.state[0]).toEqual({ name: "count", initializer: "0" });
    expect(s.state[1]).toEqual({ name: "name", initializer: '"hello"' });
    expect(s.state[2]).toEqual({ name: "items", initializer: "[]" });
  });

  it("extracts client actions", () => {
    const source = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      increment(state) {
        state.count++;
      }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.actions).toHaveLength(1);
    expect(s.actions[0].name).toBe("increment");
    expect(s.actions[0].kind).toBe("client");
    expect(s.actions[0].params).toEqual([]);
    expect(s.actions[0].isAsync).toBe(false);
  });

  it("extracts server actions", () => {
    const source = `
export default define(function() {
  return {
    state: { items: [] },
    actions: {
      async loadItems(state, ctx) {
        state.items = await ctx.db.query("SELECT * FROM items");
      }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.actions).toHaveLength(1);
    expect(s.actions[0].name).toBe("loadItems");
    expect(s.actions[0].kind).toBe("server");
    expect(s.actions[0].params).toEqual([]);
    expect(s.actions[0].isAsync).toBe(true);
  });

  it("detects async actions", () => {
    const source = `
export default define(function() {
  return {
    state: {},
    actions: {
      async doWork(state, ctx) {
        await ctx.db.save();
      },
      syncWork(state) {
        state.done = true;
      }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.actions[0].isAsync).toBe(true);
    expect(s.actions[1].isAsync).toBe(false);
  });

  it("extracts propsType", () => {
    const source = `
export default define(function(props: { label: string }) {
  return {
    state: { text: props.label },
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.propsType).toBe("{ label: string }");
  });
});

// ── Server — action classification ─────────────────────────────

describe("analyzeScript — action classification", () => {
  it("state-only param → client action", () => {
    const source = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      increment(state) { state.count++; }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    expect(server(d).actions[0].kind).toBe("client");
    expect(server(d).actions[0].params).toEqual([]);
  });

  it("state + ctx → server action", () => {
    const source = `
export default define(function() {
  return {
    state: {},
    actions: {
      save(state, ctx) { ctx.db.save(state); }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    expect(server(d).actions[0].kind).toBe("server");
    expect(server(d).actions[0].params).toEqual([]);
  });

  it("state + ctx + extra → server action with params", () => {
    const source = `
export default define(function() {
  return {
    state: {},
    actions: {
      updateItem(state, ctx, id, value) {
        ctx.db.update(id, value);
      }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const action = server(d).actions[0];
    expect(action.kind).toBe("server");
    expect(action.params).toEqual(["id", "value"]);
  });

  it("state + payload → client action with params", () => {
    const source = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      addAmount(state, amount) { state.count += amount; }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const action = server(d).actions[0];
    expect(action.kind).toBe("client");
    expect(action.params).toEqual(["amount"]);
  });
});

// ── Server — TS stripping ──────────────────────────────────────

describe("analyzeScript — TS stripping", () => {
  it("strips simple props type annotation", () => {
    const source = `
export default define(function(props: { count: number }) {
  return {
    state: { value: props.count },
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    expect(server(d).propsType).toBe("{ count: number }");
    expect(server(d).state[0].name).toBe("value");
  });

  it("strips nested object props type", () => {
    const source = `
export default define(function(props: { user: { name: string, age: number }, active: boolean }) {
  return {
    state: { name: props.user.name },
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    expect(server(d).propsType).toBe("{ user: { name: string, age: number }, active: boolean }");
  });

  it("handles no type annotation", () => {
    const source = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    expect(server(d).propsType).toBeNull();
  });

  it("strips type-only imports", () => {
    const source = `
import type { ServerContext } from '@ease/core';
import { define } from '@ease/core';

export default define(function() {
  return {
    state: {},
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);
    expect(s.imports).toHaveLength(2);
    // Type import comes first
    expect(s.imports[0].isTypeOnly).toBe(true);
    expect(s.imports[0].source).toBe("@ease/core");
    expect(s.imports[0].raw).toContain("import type");
    // Regular import
    expect(s.imports[1].isTypeOnly).toBe(false);
    expect(s.imports[1].source).toBe("@ease/core");
  });
});

// ── Client — basic extraction ──────────────────────────────────

describe("analyzeScript — client basic extraction", () => {
  it("extracts mounted hook", () => {
    const source = `
export default {
  mounted(el) {
    el.focus();
  }
};
`;
    const d = ok(analyzeScript(null, source));
    const c = client(d);
    expect(c.hooks).toHaveLength(1);
    expect(c.hooks[0].name).toBe("mounted");
    expect(c.hooks[0].params).toEqual(["el"]);
    expect(c.hooks[0].body).toContain("el.focus()");
  });

  it("extracts unmounted hook", () => {
    const source = `
export default {
  unmounted() {
    console.log("bye");
  }
};
`;
    const d = ok(analyzeScript(null, source));
    const c = client(d);
    expect(c.hooks).toHaveLength(1);
    expect(c.hooks[0].name).toBe("unmounted");
    expect(c.hooks[0].params).toEqual([]);
  });

  it("extracts multiple hooks with params", () => {
    const source = `
export default {
  mounted(el) {
    el.addEventListener("click", handler);
  },
  unmounted(el) {
    el.removeEventListener("click", handler);
  }
};
`;
    const d = ok(analyzeScript(null, source));
    const c = client(d);
    expect(c.hooks).toHaveLength(2);
    expect(c.hooks[0].name).toBe("mounted");
    expect(c.hooks[0].params).toEqual(["el"]);
    expect(c.hooks[1].name).toBe("unmounted");
    expect(c.hooks[1].params).toEqual(["el"]);
  });
});

// ── Combined ───────────────────────────────────────────────────

describe("analyzeScript — combined", () => {
  it("analyzes both server and client blocks", () => {
    const serverSrc = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {
      increment(state) { state.count++; }
    }
  };
});
`;
    const clientSrc = `
export default {
  mounted(el) { el.focus(); }
};
`;
    const d = ok(analyzeScript(serverSrc, clientSrc));
    expect(d.output.server).not.toBeNull();
    expect(d.output.client).not.toBeNull();
    expect(server(d).state).toHaveLength(1);
    expect(server(d).actions).toHaveLength(1);
    expect(client(d).hooks).toHaveLength(1);
  });

  it("handles server-only", () => {
    const source = `
export default define(function() {
  return {
    state: { count: 0 },
    actions: {}
  };
});
`;
    const d = ok(analyzeScript(source, null));
    expect(d.output.server).not.toBeNull();
    expect(d.output.client).toBeNull();
  });

  it("handles client-only", () => {
    const source = `
export default {
  mounted(el) { el.focus(); }
};
`;
    const d = ok(analyzeScript(null, source));
    expect(d.output.server).toBeNull();
    expect(d.output.client).not.toBeNull();
  });

  it("handles both null", () => {
    const d = ok(analyzeScript(null, null));
    expect(d.output.server).toBeNull();
    expect(d.output.client).toBeNull();
    expect(d.diagnostics).toHaveLength(0);
  });
});

// ── Error diagnostics ──────────────────────────────────────────

describe("analyzeScript — error diagnostics", () => {
  it("E200: no export default in server script", () => {
    const source = `const x = 1;`;
    const f = err(analyzeScript(source, null));
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E200)).toBe(true);
    expect(f.output.server).not.toBeNull();
  });

  it("E201: export default is not define()", () => {
    const source = `export default { state: {}, actions: {} };`;
    const f = err(analyzeScript(source, null));
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E201)).toBe(true);
  });

  it("E202: define() argument is not a function", () => {
    const source = `export default define({ state: {}, actions: {} });`;
    const f = err(analyzeScript(source, null));
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E202)).toBe(true);
  });

  it("E205: acorn parse error on server block", () => {
    const source = `export default define(function() { return {{{{ };`;
    const f = err(analyzeScript(source, null));
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E205)).toBe(true);
  });

  it("E210: no export default in client script", () => {
    const source = `const x = 1;`;
    const f = err(analyzeScript(null, source));
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E210)).toBe(true);
  });

  it("E211: client export default is not an object", () => {
    const source = `export default function() {}`;
    const f = err(analyzeScript(null, source));
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E211)).toBe(true);
  });

  it("collects multiple errors with partial results", () => {
    const serverSrc = `
import { something } from './util.js';
const x = 1;
`;
    const clientSrc = `const y = 2;`;
    const f = err(analyzeScript(serverSrc, clientSrc));
    // Should have E200 for server and E210 for client
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E200)).toBe(true);
    expect(f.diagnostics.some((d) => d.code === AnalyzerDiagnostics.E210)).toBe(true);
    // Partial results: server still has imports
    expect(f.output.server!.imports).toHaveLength(1);
    expect(f.output.server!.imports[0].source).toBe("./util.js");
  });
});

// ── Warnings ───────────────────────────────────────────────────

describe("analyzeScript — warnings", () => {
  it("W200: unknown lifecycle hook name", () => {
    const source = `
export default {
  mounted(el) { el.focus(); },
  created() { console.log("oops"); }
};
`;
    const d = ok(analyzeScript(null, source));
    expect(d.diagnostics).toHaveLength(1);
    expect(d.diagnostics[0].code).toBe(AnalyzerDiagnostics.W200);
    expect(d.diagnostics[0].severity).toBe("warning");
    expect(d.diagnostics[0].message).toContain("created");
    // Still extracted the hook despite warning
    const c = client(d);
    expect(c.hooks).toHaveLength(2);
  });
});

// ── Integration ────────────────────────────────────────────────

describe("analyzeScript — integration", () => {
  it("full counter component", () => {
    const source = `
import { define } from '@ease/core';

export default define(function(props: { initial: number }) {
  return {
    state: {
      count: props.initial,
      label: "Counter"
    },
    actions: {
      increment(state) {
        state.count++;
      },
      decrement(state) {
        state.count--;
      },
      async reset(state, ctx) {
        const val = await ctx.db.getDefault();
        state.count = val;
      }
    }
  };
});
`;
    const d = ok(analyzeScript(source, null));
    const s = server(d);

    expect(s.imports).toHaveLength(1);
    expect(s.imports[0].source).toBe("@ease/core");

    expect(s.propsType).toBe("{ initial: number }");

    expect(s.state).toHaveLength(2);
    expect(s.state[0].name).toBe("count");
    expect(s.state[1].name).toBe("label");
    expect(s.state[1].initializer).toBe('"Counter"');

    expect(s.actions).toHaveLength(3);
    expect(s.actions[0]).toMatchObject({ name: "increment", kind: "client", isAsync: false });
    expect(s.actions[1]).toMatchObject({ name: "decrement", kind: "client", isAsync: false });
    expect(s.actions[2]).toMatchObject({ name: "reset", kind: "server", isAsync: true });
  });

  it("full component with both scripts", () => {
    const serverSrc = `
import type { ServerContext } from '@ease/core';
import { define } from '@ease/core';
import { formatDate } from './utils.js';

export default define(function(props: { userId: string }) {
  return {
    state: {
      user: null,
      loading: true
    },
    actions: {
      async loadUser(state, ctx) {
        state.user = await ctx.db.findUser(props.userId);
        state.loading = false;
      },
      toggleActive(state) {
        state.user.active = !state.user.active;
      },
      async saveUser(state, ctx, field) {
        await ctx.db.updateUser(state.user.id, field, state.user[field]);
      }
    }
  };
});
`;
    const clientSrc = `
import { animate } from './animations.js';

export default {
  mounted(el) {
    animate(el, "fadeIn");
  },
  unmounted(el) {
    animate(el, "fadeOut");
  }
};
`;
    const d = ok(analyzeScript(serverSrc, clientSrc));
    const s = server(d);
    const c = client(d);

    // Server imports: type import + 2 regular
    expect(s.imports).toHaveLength(3);
    expect(s.imports[0].isTypeOnly).toBe(true);
    expect(s.imports[1].isTypeOnly).toBe(false);
    expect(s.imports[2].source).toBe("./utils.js");

    expect(s.propsType).toBe("{ userId: string }");
    expect(s.state).toHaveLength(2);
    expect(s.actions).toHaveLength(3);
    expect(s.actions[0]).toMatchObject({ name: "loadUser", kind: "server", isAsync: true, params: [] });
    expect(s.actions[1]).toMatchObject({ name: "toggleActive", kind: "client", isAsync: false, params: [] });
    expect(s.actions[2]).toMatchObject({ name: "saveUser", kind: "server", isAsync: true, params: ["field"] });

    // Client
    expect(c.imports).toHaveLength(1);
    expect(c.imports[0].source).toBe("./animations.js");
    expect(c.hooks).toHaveLength(2);
    expect(c.hooks[0].name).toBe("mounted");
    expect(c.hooks[1].name).toBe("unmounted");

    expect(d.diagnostics).toHaveLength(0);
  });
});
