import { describe, it, expect } from "vitest";
import { split, SplitError, SplitDiagnostics } from "../src/splitter.js";

// ── Basic Extraction ────────────────────────────────────────────

describe("splitter — basic extraction", () => {
  it("extracts a basic template + script + style", () => {
    const source = `
<template>
  <div>hello</div>
</template>

<script server>
  import { define } from 'ease'
  export default define(function() {
    return { state: {}, actions: {} }
  })
</script>

<style scoped>
  div { color: red; }
</style>
`;

    const result = split(source);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.template).not.toBeNull();
    expect(result.template!.content).toContain("<div>hello</div>");
    expect(result.serverScript).not.toBeNull();
    expect(result.serverScript!.attrs).toEqual({ server: true });
    expect(result.serverScript!.content).toContain("define");
    expect(result.clientScript).toBeNull();
    expect(result.styles).toHaveLength(1);
    expect(result.styles[0].attrs).toEqual({ scoped: true });
  });

  it("extracts both server and client scripts", () => {
    const source = `
<template><div></div></template>

<script server>
  // server code
</script>

<script client>
  // client code
</script>
`;

    const result = split(source);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.serverScript).not.toBeNull();
    expect(result.serverScript!.attrs).toEqual({ server: true });
    expect(result.clientScript).not.toBeNull();
    expect(result.clientScript!.attrs).toEqual({ client: true });
  });

  it("handles nested tags of the same name", () => {
    const source = `
<template>
  <div>
    <template v-if="show">
      <span>nested</span>
    </template>
  </div>
</template>
`;

    const result = split(source);

    expect(result.template).not.toBeNull();
    expect(result.template!.content).toContain("<template v-if");
    expect(result.template!.content).toContain("nested");
  });

  it("returns null template when no template block exists", () => {
    const source = `
<script server>
  // just a script
</script>
`;

    const result = split(source);

    expect(result.template).toBeNull();
    expect(result.serverScript).not.toBeNull();
  });

  it("preserves block positions (start/end offsets)", () => {
    const source = `<template><p>hi</p></template>`;
    const result = split(source);

    expect(result.template!.start).toBe(0);
    expect(result.template!.end).toBe(source.length);
    expect(source.slice(result.template!.start, result.template!.end)).toBe(
      source,
    );
  });

  it("parses key=value attributes", () => {
    const source = `<script server lang="ts">const x = 1;</script>`;
    const result = split(source);

    expect(result.serverScript!.attrs).toEqual({ server: true, lang: "ts" });
  });
});

// ── Script Validation ───────────────────────────────────────────

describe("splitter — script validation", () => {
  it("throws E003 when <script> has no server or client attribute", () => {
    const source = `
<template><div></div></template>
<script>
  // ambiguous — where does this run?
</script>
`;

    try {
      split(source);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      const err = e as SplitError;
      expect(err.diagnostic.code).toBe(SplitDiagnostics.E003);
      expect(err.diagnostic.message).toContain("server");
      expect(err.diagnostic.message).toContain("client");
      expect(err.diagnostic.hint).toBeDefined();
      expect(err.diagnostic.span).not.toBeNull();
    }
  });

  it("throws E004 on duplicate <script server>", () => {
    const source = `
<template><div></div></template>
<script server>
  // first server block
</script>
<script server>
  // second server block
</script>
`;

    try {
      split(source);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      const err = e as SplitError;
      expect(err.diagnostic.code).toBe(SplitDiagnostics.E004);
      expect(err.diagnostic.message).toContain("<script server>");
      expect(err.diagnostic.hint).toContain("Merge");
    }
  });

  it("throws E005 on duplicate <script client>", () => {
    const source = `
<template><div></div></template>
<script client>
  // first client block
</script>
<script client>
  // second client block
</script>
`;

    try {
      split(source);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      const err = e as SplitError;
      expect(err.diagnostic.code).toBe(SplitDiagnostics.E005);
      expect(err.diagnostic.message).toContain("<script client>");
      expect(err.diagnostic.hint).toContain("Merge");
    }
  });

  it("allows one server + one client script", () => {
    const source = `
<script server>export default {}</script>
<script client>export default {}</script>
`;

    const result = split(source);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.serverScript).not.toBeNull();
    expect(result.clientScript).not.toBeNull();
  });

  it("allows server-only (no client script)", () => {
    const source = `<script server>export default {}</script>`;
    const result = split(source);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.serverScript).not.toBeNull();
    expect(result.clientScript).toBeNull();
  });

  it("allows client-only (no server script)", () => {
    const source = `<script client>export default {}</script>`;
    const result = split(source);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.clientScript).not.toBeNull();
    expect(result.serverScript).toBeNull();
  });
});

// ── Style Handling ──────────────────────────────────────────────

describe("splitter — style handling", () => {
  it("parses <style scoped> with scoped attr", () => {
    const source = `<style scoped>.card { border: 1px solid; }</style>`;
    const result = split(source);

    expect(result.styles).toHaveLength(1);
    expect(result.styles[0].attrs).toEqual({ scoped: true });
    expect(result.styles[0].content).toContain(".card");
  });

  it("parses bare <style> as global (no attrs)", () => {
    const source = `<style>body { margin: 0; }</style>`;
    const result = split(source);

    expect(result.styles).toHaveLength(1);
    expect(result.styles[0].attrs).toEqual({});
    expect(result.styles[0].content).toContain("body");
  });

  it("allows multiple style blocks", () => {
    const source = `
<style scoped>.card { border: 1px solid; }</style>
<style>body { margin: 0; }</style>
`;
    const result = split(source);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.styles).toHaveLength(2);
    expect(result.styles[0].attrs).toEqual({ scoped: true });
    expect(result.styles[1].attrs).toEqual({});
  });

  it("allows multiple scoped style blocks", () => {
    const source = `
<style scoped>.layout { display: grid; }</style>
<style scoped>.theme { color: blue; }</style>
`;
    const result = split(source);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.styles).toHaveLength(2);
  });

  it("allows mixed scoped and global style blocks", () => {
    const source = `
<template><div></div></template>
<script server>export default {}</script>
<style scoped>.comp { padding: 8px; }</style>
<style>:root { --primary: blue; }</style>
<style scoped>.comp:hover { opacity: 0.8; }</style>
`;
    const result = split(source);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.styles).toHaveLength(3);
    expect(result.styles[0].attrs.scoped).toBe(true);
    expect(result.styles[1].attrs.scoped).toBeUndefined();
    expect(result.styles[2].attrs.scoped).toBe(true);
  });
});

// ── Existing Error Cases ────────────────────────────────────────

describe("splitter — existing errors", () => {
  it("throws E001 on unclosed block", () => {
    const source = `<template><div>oops</div>`;

    try {
      split(source);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      const err = e as SplitError;
      expect(err.diagnostic.code).toBe(SplitDiagnostics.E001);
      expect(err.diagnostic.message).toContain("Unclosed <template>");
      expect(err.diagnostic.hint).toBeDefined();
      expect(err.diagnostic.span).not.toBeNull();
      expect(err.diagnostic.span!.start.line).toBe(1);
    }
  });

  it("throws E002 on duplicate template", () => {
    const source = `
<template><div>one</div></template>
<template><div>two</div></template>
`;

    try {
      split(source);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      const err = e as SplitError;
      expect(err.diagnostic.code).toBe(SplitDiagnostics.E002);
      expect(err.diagnostic.message).toContain("Only one <template>");
    }
  });
});

// ── Integration ─────────────────────────────────────────────────

describe("splitter — integration: full component", () => {
  it("parses a complete .ease file with all block types", () => {
    const source = `
<template>
  <div class="card">
    <slot name="header" />
    <slot />
  </div>
</template>

<script server>
  import { define } from 'ease'
  export default define(function(props: { title: string }) {
    return { state: { expanded: false }, actions: {} }
  })
</script>

<script client>
  export default {
    mounted(el) { el.focus() }
  }
</script>

<style scoped>
  .card { border: 1px solid #ccc; border-radius: 8px; }
</style>

<style>
  :root { --card-radius: 8px; }
</style>
`;

    const result = split(source);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.template).not.toBeNull();
    expect(result.template!.content).toContain("slot");
    expect(result.serverScript).not.toBeNull();
    expect(result.serverScript!.content).toContain("define");
    expect(result.clientScript).not.toBeNull();
    expect(result.clientScript!.content).toContain("mounted");
    expect(result.styles).toHaveLength(2);
    expect(result.styles[0].attrs.scoped).toBe(true);
    expect(result.styles[1].attrs.scoped).toBeUndefined();
  });
});
