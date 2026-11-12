import { Schema as S } from "effect"

/**
 * Broad HTTP errors. Each class owns one status via `httpApiStatus`; message-only
 * variants that shared a status are discriminated by a typed `reason` literal.
 */

/** A defect. The body carries a fixed message and the trace id that finds the logged cause. */
export class InternalError extends S.TaggedError<InternalError, { readonly brand: unique symbol }>()(
  "InternalError",
  {
    message: S.String,
    /** Finds the request in the traces and logs. */
    traceId: S.String,
  },
  { httpApiStatus: 500 },
) {}

/** A request whose session or credentials do not allow it. */
export class Unauthorized extends S.TaggedError<Unauthorized, { readonly brand: unique symbol }>()(
  "Unauthorized",
  {
    message: S.String,
    reason: S.Literals(["authentication_required", "invalid_credentials"]),
  },
  { httpApiStatus: 401 },
) {}

/** A request the signed-in user may not make. */
export class Forbidden extends S.TaggedError<Forbidden, { readonly brand: unique symbol }>()(
  "Forbidden",
  {
    message: S.String,
    reason: S.Literals(["access_denied"]),
  },
  { httpApiStatus: 403 },
) {}

export class NotFound extends S.TaggedError<NotFound, { readonly brand: unique symbol }>()(
  "NotFound",
  { message: S.String },
  { httpApiStatus: 404 },
) {}

/** The request conflicts with data that exists now. `reason` says which kind of conflict. */
export class Conflict extends S.TaggedError<Conflict, { readonly brand: unique symbol }>()(
  "Conflict",
  {
    message: S.String,
    reason: S.Literals([
      "username_taken",
      "email_taken",
      "already_member",
      "account_already_linked",
      "owns_organization",
      "slug_taken",
      "already_exists",
      "related_data",
    ]),
  },
  { httpApiStatus: 409 },
) {}

export class Locked extends S.TaggedError<Locked, { readonly brand: unique symbol }>()(
  "Locked",
  { message: S.String },
  { httpApiStatus: 423 },
) {}

/** One rejected request value. `path` starts with the request part (`payload`, `params`, `query`, `headers`). */
export const InputIssue = S.Struct({
  path: S.Array(S.Union([S.String, S.Int])),
  message: S.String,
})

/** A request the server cannot accept as sent. `issues` names each rejected value when the request failed its schema. */
export class InvalidOperation extends S.TaggedError<InvalidOperation, { readonly brand: unique symbol }>()(
  "InvalidOperation",
  {
    message: S.String,
    reason: S.Literals([
      "cannot_delete_last_email",
      "email_not_verified",
      "invalid_token",
      "weak_password",
      "missing_data",
      "invalid_input",
    ]),
    field: S.optional(S.Literals(["email", "password", "username"])),
    requirements: S.optional(S.Array(S.String)),
    /** For `invalid_input`: each value the request schema rejected. */
    issues: S.optional(S.Array(InputIssue)),
  },
  { httpApiStatus: 400 },
) {}

/**
 * The server could not finish the request now: a conflict with a concurrent
 * transaction (`busy`), a statement timeout (`timed_out`), or a fault in the
 * server's settings (`misconfigured`, such as a database role it cannot switch
 * to). The same request may succeed if the client sends it again later.
 */
export class ServiceUnavailable extends S.TaggedError<ServiceUnavailable, { readonly brand: unique symbol }>()(
  "ServiceUnavailable",
  {
    message: S.String,
    reason: S.Literals(["busy", "timed_out", "misconfigured"]),
  },
  { httpApiStatus: 503 },
) {}

/**
 * Every class a refused database call can be answered with (see
 * src/server/dbErrors.ts). Any endpoint that queries can answer any of them.
 */
export const DatabaseRefusals = [
  Unauthorized,
  Forbidden,
  NotFound,
  Conflict,
  Locked,
  InvalidOperation,
  ServiceUnavailable,
] as const
export type DatabaseRefusal = (typeof DatabaseRefusals)[number]["Type"]
