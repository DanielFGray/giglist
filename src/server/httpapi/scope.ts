import { Effect } from "effect"
import { withAuthContext } from "../db"
import { toHttpError } from "../dbErrors"
import { isDatabaseError } from "../databaseError"
import { CurrentSession } from "../../api/session"

/**
 * Runs `effect` only for a signed-in request; a signed-out one gets
 * `signedOut` instead. A session always names a user (`sessions.user_id` is
 * not null), so the session id alone decides.
 */
export const ifSignedIn =
  <B, E2, R2>(signedOut: Effect.Effect<B, E2, R2>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      if (!session.sessionId) return yield* signedOut
      return yield* effect
    })

/**
 * Runs `effect` only for a signed-in request; one with no session fails with
 * `unauthorized()` (each API group has its own 403 error).
 */
export const requireSession = <E2>(unauthorized: () => E2) => ifSignedIn(Effect.failSync(unauthorized))

/**
 * Runs `effect` as the request's user, in one transaction. A request with no
 * session fails with `unauthorized()` before it opens one. A refused query is
 * answered outside the transaction, so a failed COMMIT is answered too.
 */
export const asSignedIn =
  <E2>(unauthorized: () => E2) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    withAuthContext(effect).pipe(Effect.catchIf(isDatabaseError, toHttpError), requireSession(unauthorized))
