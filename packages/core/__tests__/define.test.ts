import { describe, it, expect, expectTypeOf, assertType } from "vitest";
import { define } from "../src/index.js";
import type { ComponentDef, DefinedComponent } from "../src/index.js";

describe("define()", () => {
  it("returns a DefinedComponent wrapping the factory", () => {
    const component = define(function (props: { label: string }) {
      return {
        state: { count: 0 },
        actions: {
          increment(state) {
            state.count++;
          },
        },
      };
    });

    expect(component).toHaveProperty("factory");
    expect(typeof component.factory).toBe("function");
  });

  it("factory produces correct state", () => {
    const component = define(function (props: { initial: number }) {
      return {
        state: { count: props.initial },
        actions: {
          increment(state) {
            state.count++;
          },
        },
      };
    });

    const def = component.factory({ initial: 5 });
    expect(def.state.count).toBe(5);
  });

  it("factory produces callable actions", () => {
    const component = define(function (_props: {}) {
      return {
        state: { value: "hello" },
        actions: {
          update(state) {
            state.value = "updated";
          },
        },
      };
    });

    const def = component.factory({});
    const state = { ...def.state };
    def.actions.update(state);
    expect(state.value).toBe("updated");
  });
});

describe("define() type safety", () => {
  it("infers the DefinedComponent type", () => {
    const component = define(function (_props: { x: number }) {
      return {
        state: { n: 0 },
        actions: {
          inc(state) {
            state.n++;
          },
        },
      };
    });

    expectTypeOf(component).toMatchTypeOf<
      DefinedComponent<{ x: number }, any, any>
    >();
  });

  it("factory return type matches ComponentDef shape", () => {
    const component = define(function (_props: {}) {
      return {
        state: { count: 0 },
        actions: {
          inc(state) {
            state.count++;
          },
        },
      };
    });

    const def = component.factory({});
    expectTypeOf(def).toMatchTypeOf<ComponentDef<any>>();
    expectTypeOf(def.state).toHaveProperty("count");
    expectTypeOf(def.actions).toHaveProperty("inc");
  });

  it("rejects missing state", () => {
    // @ts-expect-error — state is required
    define(function (_props: {}) {
      return { actions: {} };
    });
  });

  it("rejects missing actions", () => {
    // @ts-expect-error — actions is required
    define(function (_props: {}) {
      return { state: {} };
    });
  });
});
