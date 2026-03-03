// @ease/shared — cross-package utilities

// ── Result Pattern ──────────────────────────────────────────────

export type ResultSuccess<TData> = {
  data: TData;
  ok: true;
};

export interface ResultFailure<TCtx> {
  ctx: TCtx;
  ok: false;
}

export type Result<TData, TErrorCtx = string> =
  | ResultSuccess<TData>
  | ResultFailure<TErrorCtx>;

export type EmptyResult<TErrorCtx = string> = Result<void, TErrorCtx>;

export function success<TData>(data: TData): ResultSuccess<TData> {
  return { data, ok: true };
}

export function emptySuccess(): ResultSuccess<void> {
  return { data: undefined, ok: true };
}

export function failure<TCtx>(ctx: TCtx): ResultFailure<TCtx> {
  return { ok: false, ctx };
}

/**
 * Unwrap a Result, throwing if it's a failure.
 * Use sparingly — prefer checking `ok` directly.
 */
export function unwrap<T extends Result<any, any>>(
  r: T,
): [T] extends [Result<infer TData, any>] ? TData : never {
  if (!r.ok) throw new Error(typeof r.ctx === "string" ? r.ctx : JSON.stringify(r.ctx));
  return r.data;
}

// ── Syntax Tokens ───────────────────────────────────────────────

export const Tokens = {
  INTERPOLATION_OPEN: "{{",
  INTERPOLATION_CLOSE: "}}",
  COMMENT_OPEN: "<!--",
  COMMENT_CLOSE: "-->",
  TAG_OPEN: "<",
  TAG_CLOSE: ">",
  CLOSING_TAG_OPEN: "</",
  SELF_CLOSE: "/>",
  DIRECTIVE_PREFIX: "@",
  DYNAMIC_ATTR_PREFIX: ":",
  ATTR_ASSIGN: "=",
  DOUBLE_QUOTE: '"',
  SINGLE_QUOTE: "'",
} as const;
