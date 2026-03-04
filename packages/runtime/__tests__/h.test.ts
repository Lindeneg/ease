import {describe, it, expect} from "vitest";
import {h, VNode, renderToHtml} from "../src/index.js";

// ── h() basics ──────────────────────────────────────────────────

describe("h() — basic elements", () => {
    it("renders an empty div", () => {
        const vnode = h("div", null);
        expect(vnode).toBeInstanceOf(VNode);
        expect(vnode.__html).toBe("<div></div>");
    });

    it("renders with static attributes", () => {
        const vnode = h("div", {class: "foo", id: "bar"});
        expect(vnode.__html).toBe('<div class="foo" id="bar"></div>');
    });

    it("renders boolean attribute (true)", () => {
        const vnode = h("input", {disabled: true});
        expect(vnode.__html).toBe("<input disabled />");
    });

    it("skips boolean attribute (false)", () => {
        const vnode = h("input", {disabled: false});
        expect(vnode.__html).toBe("<input />");
    });

    it("skips null/undefined attributes", () => {
        const vnode = h("div", {class: null, id: undefined});
        expect(vnode.__html).toBe("<div></div>");
    });

    it("renders void elements self-closing", () => {
        expect(h("br", null).__html).toBe("<br />");
        expect(h("img", {src: "a.png"}).__html).toBe('<img src="a.png" />');
        expect(h("input", {type: "text"}).__html).toBe('<input type="text" />');
        expect(h("hr", null).__html).toBe("<hr />");
    });
});

// ── h() children ────────────────────────────────────────────────

describe("h() — children", () => {
    it("renders text children", () => {
        const vnode = h("p", null, "hello");
        expect(vnode.__html).toBe("<p>hello</p>");
    });

    it("renders multiple text children", () => {
        const vnode = h("p", null, "hello", " ", "world");
        expect(vnode.__html).toBe("<p>hello world</p>");
    });

    it("renders number children", () => {
        const vnode = h("span", null, 42);
        expect(vnode.__html).toBe("<span>42</span>");
    });

    it("renders nested h() calls", () => {
        const vnode = h("div", null, h("span", null, "inner"));
        expect(vnode.__html).toBe("<div><span>inner</span></div>");
    });

    it("renders deeply nested elements", () => {
        const vnode = h("div", null, h("ul", null, h("li", null, "item")));
        expect(vnode.__html).toBe("<div><ul><li>item</li></ul></div>");
    });

    it("renders array children (from .map())", () => {
        const items = ["a", "b", "c"];
        const vnode = h("ul", null, items.map((item) => h("li", null, item)));
        expect(vnode.__html).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
    });

    it("skips null children", () => {
        const vnode = h("div", null, "a", null, "b");
        expect(vnode.__html).toBe("<div>ab</div>");
    });

    it("skips false children", () => {
        const vnode = h("div", null, false, "text");
        expect(vnode.__html).toBe("<div>text</div>");
    });

    it("skips undefined children", () => {
        const vnode = h("div", null, undefined, "text");
        expect(vnode.__html).toBe("<div>text</div>");
    });

    it("skips true children", () => {
        const vnode = h("div", null, true, "text");
        expect(vnode.__html).toBe("<div>text</div>");
    });
});

// ── h() HTML escaping ───────────────────────────────────────────

describe("h() — HTML escaping", () => {
    it("escapes text children for XSS safety", () => {
        const vnode = h("p", null, "<script>alert(1)</script>");
        expect(vnode.__html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    });

    it("escapes & in text", () => {
        const vnode = h("p", null, "a & b");
        expect(vnode.__html).toBe("<p>a &amp; b</p>");
    });

    it("escapes quotes in attributes", () => {
        const vnode = h("div", {title: 'say "hello"'});
        expect(vnode.__html).toBe('<div title="say &quot;hello&quot;"></div>');
    });

    it("does NOT double-escape nested h() output", () => {
        const inner = h("span", null, "safe");
        const outer = h("div", null, inner);
        // The inner <span> should NOT be escaped
        expect(outer.__html).toBe("<div><span>safe</span></div>");
    });
});

// ── renderToHtml() ──────────────────────────────────────────────

describe("renderToHtml()", () => {
    const mockComponent = {
        init(props: Record<string, any>, _ctx: Record<string, any>) {
            return {count: props.initial ?? 0};
        },
        render(state: Record<string, any>, _slots: Record<string, any>) {
            return h("div", null, h("span", null, state.count));
        },
        actions: {},
        serverActions: [],
        emits: [],
    };

    it("returns html and state", () => {
        const result = renderToHtml(mockComponent);
        expect(result.html).toBe("<div><span>0</span></div>");
        expect(result.state).toEqual({count: 0});
    });

    it("passes props to init", () => {
        const result = renderToHtml(mockComponent, {initial: 5});
        expect(result.state).toEqual({count: 5});
        expect(result.html).toBe("<div><span>5</span></div>");
    });

    it("passes ctx to init", () => {
        const comp = {
            ...mockComponent,
            init(props: Record<string, any>, ctx: Record<string, any>) {
                return {count: 0, user: ctx.user};
            },
        };
        const result = renderToHtml(comp, {}, {user: "Ada"});
        expect(result.state.user).toBe("Ada");
    });
});
