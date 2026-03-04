// @ease/runtime — server-side rendering and client-side hydration
//
// Provides h() for building HTML from hyperscript calls,
// renderToHtml() for server-side rendering, and
// hydrate() for client-side interactivity.

// ── VNode ───────────────────────────────────────────────────────

/** Opaque wrapper for HTML produced by h(). Prevents double-escaping of nested h() calls. */
export class VNode {
    readonly __html: string;
    constructor(html: string) {
        this.__html = html;
    }
}

// ── HTML Escaping ───────────────────────────────────────────────

const ESC_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

function escapeAttr(s: string): string {
    return s.replace(/[&"]/g, (ch) => ESC_MAP[ch]);
}

// ── Void Elements ───────────────────────────────────────────────

const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
]);

// ── h() — hyperscript to HTML ───────────────────────────────────

/**
 * Create an HTML string from a hyperscript call.
 *
 * Works identically on server (produces HTML string for response) and
 * client (produces HTML string for morphdom/innerHTML diffing).
 */
export function h(tag: string, attrs: Record<string, any> | null, ...children: any[]): VNode {
    let s = `<${tag}`;

    if (attrs) {
        for (const [key, val] of Object.entries(attrs)) {
            if (val === false || val == null) continue;
            if (val === true) {
                s += ` ${key}`;
                continue;
            }
            s += ` ${key}="${escapeAttr(String(val))}"`;
        }
    }

    if (VOID_ELEMENTS.has(tag)) {
        return new VNode(s + " />");
    }

    s += ">";
    s += renderChildren(children);
    s += `</${tag}>`;
    return new VNode(s);
}

function renderChildren(children: any[]): string {
    let s = "";
    for (const child of children) {
        if (child == null || child === false || child === true) continue;
        if (child instanceof VNode) {
            s += child.__html;
            continue;
        }
        if (Array.isArray(child)) {
            s += renderChildren(child);
            continue;
        }
        if (typeof child === "number") {
            s += String(child);
            continue;
        }
        s += escapeHtml(String(child));
    }
    return s;
}

// ── CompiledModule Interface ────────────────────────────────────

/** The shape of a compiled .ease component module (what generate() produces). */
export interface CompiledModule {
    init(props: Record<string, any>, ctx: Record<string, any>): Record<string, any>;
    render(state: Record<string, any>, slots: Record<string, any>): VNode;
    actions: Record<string, (state: Record<string, any>, ...args: any[]) => void>;
    serverActions: string[];
    emits: string[];
}

// ── Server-Side Rendering ───────────────────────────────────────

/** The result of server-side rendering — component HTML and serialized state. */
export interface RenderResult {
    /** The rendered component HTML (inner content, not a full document) */
    html: string;
    /** The component state after init(), for embedding in the HTML for client hydration */
    state: Record<string, any>;
}

/**
 * Render a compiled component to HTML on the server.
 *
 * Calls `component.init(props, ctx)` to produce initial state, then
 * `component.render(state, slots)` to produce HTML. Returns both the
 * HTML string and the state object for client-side hydration.
 */
export function renderToHtml(
    component: CompiledModule,
    props?: Record<string, any>,
    ctx?: Record<string, any>,
): RenderResult {
    const state = component.init(props ?? {}, ctx ?? {});
    const vnode = component.render(state, {});
    const html = vnode instanceof VNode ? vnode.__html : String(vnode);
    return {html, state};
}

// ── Client-Side Hydration ───────────────────────────────────────

/**
 * Hydrate a server-rendered component in the browser.
 *
 * Reads the embedded state from `data-ease-state`, wires event delegation
 * on the root element, and dispatches to the component's client actions.
 * After each action, the component is re-rendered via innerHTML replacement.
 */
export function hydrate(rootEl: Element, component: CompiledModule): void {
    const stateJson = rootEl.getAttribute("data-ease-state");
    if (!stateJson) throw new Error("No data-ease-state attribute found on root element");
    const state = JSON.parse(stateJson);

    function rerender(): void {
        const vnode = component.render(state, {});
        const html = vnode instanceof VNode ? vnode.__html : String(vnode);
        rootEl.innerHTML = html;
        rootEl.setAttribute("data-ease-state", JSON.stringify(state));
    }

    // Event delegation: click
    rootEl.addEventListener("click", (e) => {
        const target = (e.target as Element).closest("[data-ease-click]");
        if (!target) return;
        const actionName = target.getAttribute("data-ease-click");
        if (!actionName || !component.actions[actionName]) return;
        component.actions[actionName](state);
        rerender();
    });

    // Event delegation: submit
    rootEl.addEventListener("submit", (e) => {
        const target = (e.target as Element).closest("[data-ease-submit]");
        if (!target) return;
        e.preventDefault();
        const actionName = target.getAttribute("data-ease-submit");
        if (!actionName || !component.actions[actionName]) return;
        component.actions[actionName](state);
        rerender();
    });
}
