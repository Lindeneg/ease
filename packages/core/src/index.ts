// @ease/core — types and define() function for .ease components

// ----- Server Context -----

export interface ServerContext {
  db: unknown;
  auth: unknown;
  request: unknown;
  response: unknown;
}

// ----- Actions -----

/** A pure/client action — no ctx parameter, runs instantly on client. */
export type ClientAction<S> = (state: S, ...args: any[]) => void;

/** A server action — has ctx parameter, round-trips to server. */
export type ServerAction<S> = (
  state: S,
  ctx: ServerContext,
  ...args: any[]
) => void | Promise<void>;

/** Any action — compiler determines which kind based on ctx usage. */
export type Action<S> = ClientAction<S> | ServerAction<S>;

/** Map of action name → action function. */
export type Actions<S> = Record<string, Action<S>>;

// ----- Component Definition -----

export interface ComponentDef<S, A extends Actions<S> = Actions<S>> {
  state: S;
  actions: A;
}

/** The return type of define() — what the compiler receives. */
export interface DefinedComponent<
  P,
  S,
  A extends Actions<S> = Actions<S>,
> {
  factory: (props: P) => ComponentDef<S, A>;
}

/**
 * `define()` wraps a component factory for type safety.
 *
 * Usage in .ease files:
 * ```ts
 * export default define(function(props: { initial: number }) {
 *   return {
 *     state: { count: props.initial },
 *     actions: {
 *       increment(state) { state.count++ },
 *       async save(state, ctx) { await ctx.db.save(state) }
 *     }
 *   }
 * })
 * ```
 */
export function define<P, S, A extends Actions<S>>(
  factory: (props: P) => ComponentDef<S, A>,
): DefinedComponent<P, S, A> {
  return { factory };
}
