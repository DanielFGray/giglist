import { Effect } from "effect"
import { withAuthContext } from "../db"
import { CurrentSession, type SessionData } from "../../api/contracts"

/**
 * Runs `effect` only for a signed-in request; one with no session fails with
 * `unauthorized()` (each API group has its own 403 error).
 */
export const requireSession =
  <E2>(unauthorized: () => E2) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      if (!session.sessionId) return yield* Effect.fail(unauthorized())
      return yield* effect
    })

/**
 * Runs `effect` as the request's user, in one transaction. A request with no
 * session fails with `unauthorized()` before it opens one.
 */
export const asSignedIn =
  <E2>(unauthorized: () => E2) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    withAuthContext(effect).pipe(requireSession(unauthorized))

/**
 * Run `query` as the session's user. With no session, fail with `unauthorized()`
 * (each API group has its own 403 error).
 */
export const asSessionOr = <A, E, E2, R>(
  unauthorized: () => E2,
  query: (session: SessionData) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    if (!session.sessionId) {
      return yield* Effect.fail(unauthorized())
    }
    return yield* query(session).pipe(withAuthContext)
  })
