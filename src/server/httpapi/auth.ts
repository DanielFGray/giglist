import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Auth } from "../services/auth"
import { withAuthContext } from "../db"
import {
  GigListApi,
  AuthError,
  CurrentSession,
  sessionCookie,
} from "../../api/contracts"

const isSecure = process.env.NODE_ENV === "production"

const requireSession = Effect.fnUntraced(function* () {
  const session = yield* CurrentSession
  if (!session.sessionId || !session.userId) {
    return yield* new AuthError({ message: "You must be signed in" })
  }
  return session
})

const setSessionCookie = Effect.fnUntraced(function* (sessionId: string) {
  yield* HttpApiBuilder.securitySetCookie(sessionCookie, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: "30 days",
  })
})

const toUserEmail = (row: { id: string; email: string; is_verified: boolean; is_primary: boolean; created_at: Date }) => ({
  id: row.id,
  email: row.email,
  is_verified: row.is_verified,
  is_primary: row.is_primary,
  created_at: row.created_at,
})

export const authHandlers = HttpApiBuilder.group(GigListApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth
    return handlers
      .handle("login", Effect.fnUntraced(function*({ payload }) {
          const result = yield* auth.login(payload)
          yield* setSessionCookie(result.sessionId)
          return { ok: true as const }
        },
          Effect.mapError((e) => new AuthError({ message: e.message })),
        ),
      )
      .handle("register", Effect.fnUntraced(function*({ payload }) {
          const result = yield* auth.register(payload)
          yield* setSessionCookie(result.sessionId)
          return { ok: true as const }
        },
          Effect.mapError((e) => new AuthError({ message: e.message })),
        ),
      )
      .handle("forgotPassword", Effect.fnUntraced(function* ({ payload }) {
        yield* auth.forgotPassword(payload.email).pipe(Effect.orDie)
        return { ok: true as const }
      }))
      .handle("resetPassword", Effect.fnUntraced(function* ({ payload }) {
        const result = yield* auth.resetPassword(payload).pipe(
          Effect.mapError((error) => new AuthError({ message: error.message })),
        )
        yield* setSessionCookie(result.sessionId)
        return { ok: true as const }
      }))
      .handle("logout", Effect.fnUntraced(function*() {
          const session = yield* CurrentSession
          if (session.sessionId) {
            yield* auth.logout(session.sessionId).pipe(Effect.orDie)
          }
          yield* HttpApiBuilder.securitySetCookie(sessionCookie, "", {
            httpOnly: true,
            sameSite: "lax",
            secure: isSecure,
            path: "/",
            maxAge: "0 seconds",
          })
          return { ok: true as const }
        }),
      )
      .handle("me", Effect.fnUntraced(function*() {
          const session = yield* CurrentSession
          if (!session.sessionId || !session.userId) return null
          return yield* auth.getMe().pipe(withAuthContext)
        }),
      )
      .handle("updateMe", Effect.fnUntraced(function*({ payload }) {
          yield* requireSession()
          return yield* auth.updateProfile(payload).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
        }),
      )
      .handle("changePassword", Effect.fnUntraced(function*({ payload }) {
          yield* requireSession()
          yield* auth.changePassword({
            oldPassword: payload.old_password,
            newPassword: payload.new_password,
          }).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return { ok: true as const }
        }),
      )
      .handle("listEmails", Effect.fnUntraced(function*() {
          yield* requireSession()
          const rows = yield* auth.listEmails().pipe(
            withAuthContext,
            Effect.mapError(() => new AuthError({ message: "Could not load emails" })),
          )
          return rows.map(toUserEmail)
        }),
      )
      .handle("addEmail", Effect.fnUntraced(function*({ payload }) {
          yield* requireSession()
          const row = yield* auth.addEmail(payload.email).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return toUserEmail(row)
        }),
      )
      .handle("verifyEmail", Effect.fnUntraced(function*({ payload }) {
          yield* auth.verifyEmail(payload).pipe(
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return { ok: true as const }
        }),
      )
      .handle("removeEmail", Effect.fnUntraced(function*({ params: { id } }) {
          yield* requireSession()
          yield* auth.removeEmail(id).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return { ok: true as const }
        }),
      )
      .handle("makeEmailPrimary", Effect.fnUntraced(function*({ params: { id } }) {
          yield* requireSession()
          const row = yield* auth.makeEmailPrimary(id).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return toUserEmail(row)
        }),
      )
      .handle("resendEmailVerification", Effect.fnUntraced(function*({ params: { id } }) {
          yield* requireSession()
          yield* auth.resendEmailVerification(id).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return { ok: true as const }
        }),
      )
      .handle("requestAccountDeletion", Effect.fnUntraced(function*() {
          yield* requireSession()
          yield* auth.requestAccountDeletion().pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          return { ok: true as const }
        }),
      )
      .handle("confirmAccountDeletion", Effect.fnUntraced(function*({ payload }) {
          yield* requireSession()
          yield* auth.confirmAccountDeletion(payload.token).pipe(
            withAuthContext,
            Effect.mapError((e) => new AuthError({ message: e.message })),
          )
          // The user row is gone; drop the cookie so the browser is signed out.
          yield* HttpApiBuilder.securitySetCookie(sessionCookie, "", {
            httpOnly: true,
            sameSite: "lax",
            secure: isSecure,
            path: "/",
            maxAge: "0 seconds",
          })
          return { ok: true as const }
        }),
      )
  })
)
