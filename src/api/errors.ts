import { Schema as S } from "effect"

/**
 * Broad HTTP errors that any endpoint can answer. Each class sets its own
 * status with `httpApiStatus`, so the status travels with the class.
 */

/** A defect. The body carries a fixed message and the trace id that finds the logged cause. */
export class InternalError extends S.TaggedError<InternalError, { readonly brand: unique symbol }>()(
  "InternalError",
  {
    message: S.String,
    traceId: S.String,
  },
  { httpApiStatus: 500 },
) {}

/** One rejected request value. `path` starts with the request part (`payload`, `params`, `query`, `headers`). */
export const InputIssue = S.Struct({
  path: S.Array(S.Union([S.String, S.Int])),
  message: S.String,
})

/** A request that fails its endpoint's schema. Every rejected value is listed in `issues`. */
export class InvalidOperation extends S.TaggedError<InvalidOperation, { readonly brand: unique symbol }>()(
  "InvalidOperation",
  {
    message: S.String,
    reason: S.Literal("invalid_input"),
    issues: S.Array(InputIssue),
  },
  { httpApiStatus: 400 },
) {}

/** A request whose session or credentials do not allow it. The body carries the service's message. */
export class Unauthorized extends S.TaggedError<Unauthorized, { readonly brand: unique symbol }>()(
  "Unauthorized",
  {
    message: S.String,
  },
  { httpApiStatus: 401 },
) {}
