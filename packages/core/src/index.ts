/**
 * Single object that flows through the entire request pipeline.
 *
 * Base fields (`request`, `params`, `query`) are set by the framework.
 * Middleware adds custom fields (user, db, permissions, etc.) via the index signature.
 * The same ctx object is available in both component factories and server actions.
 */
export interface ServerContext<TRequest = unknown> {
    /** The normalized HTTP request object */
    request: TRequest;
    /** Route parameters extracted from URL, e.g. `{ id: "123" }` */
    params: Record<string, string>;
    /** Query string parameters */
    query: Record<string, string>;
    /** Middleware-provided data (user, db, permissions, etc.) */
    [key: string]: unknown;
}

/** The emit function signature, injected into actions that declare an `emit` parameter. */
export type EmitFn = (event: string, ...payload: any[]) => void;

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

/** The shape returned by a component factory inside define(). */
export interface ComponentDef<S, A extends Actions<S> = Actions<S>> {
    /** Reactive state object — each property becomes an observable field. */
    state: S;
    /** Named action functions that modify state and/or interact with the server. */
    actions: A;
    /** Event names this component can emit to its parent. Optional — omit if no events emitted. */
    emits?: string[];
}

/** The return type of define() — what the compiler receives. */
export interface DefinedComponent<P, S, A extends Actions<S> = Actions<S>> {
    factory: (props: P, ctx?: ServerContext) => ComponentDef<S, A>;
}

/**
 * `define()` wraps a component factory for type safety.
 *
 * The factory receives route params as `props` and the middleware-populated
 * server context as `ctx`. The `ctx` parameter is optional for components
 * that don't need server data at initialization.
 *
 * Usage in .ease files:
 * ```ts
 * export default define(function(props: { initial: number }, ctx) {
 *   return {
 *     state: { count: props.initial, user: ctx?.user },
 *     actions: {
 *       increment(state) { state.count++ },
 *       async save(state, ctx) { await ctx.db.save(state) }
 *     }
 *   }
 * })
 * ```
 */
export function define<P, S, A extends Actions<S>>(
    factory: (props: P, ctx?: ServerContext) => ComponentDef<S, A>
): DefinedComponent<P, S, A> {
    return {factory};
}
