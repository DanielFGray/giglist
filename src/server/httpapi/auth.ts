import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import * as Auth from "../services/auth"
import { withAuthContext } from "../db"
import {
  SetListApi,
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

const toUserEmail = (row: {
  id: string
  email: string
  is_verified: boolean
  is_primary: boolean
  created_at: Date | string
}) => ({
  id: row.id,
  email: row.email,
  is_verified: row.is_verified,
  is_primary: row.is_primary,
  created_at: String(row.created_at),
})

export const authHandlers = HttpApiBuilder.group(SetListApi, "auth", (handlers) =>
  handlers
    .handle("login", Effect.fnUntraced(function*({ payload }) {
        const result = yield* Auth.login(payload)
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { ok: true as const }
      },
        Effect.mapError((e) => new AuthError({ message: e.message })),
      ),
    )
    .handle("register", Effect.fnUntraced(function*({ payload }) {
        const result = yield* Auth.register(payload)
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { ok: true as const }
      },
        Effect.mapError((e) => new AuthError({ message: e.message })),
      ),
    )
    .handle("logout", Effect.fnUntraced(function*() {
        const session = yield* CurrentSession
        if (session.sessionId) {
          yield* Auth.logout(session.sessionId).pipe(Effect.orDie)
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
        return yield* Auth.getMe(session.sessionId).pipe(
          Effect.orElseSucceed(() => null),
        )
      }),
    )
    .handle("updateMe", Effect.fnUntraced(function*({ payload }) {
        const session = yield* requireSession()
        return yield* Auth.updateProfile(payload).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
      }),
    )
    .handle("changePassword", Effect.fnUntraced(function*({ payload }) {
        const session = yield* requireSession()
        yield* Auth.changePassword({
          oldPassword: payload.old_password,
          newPassword: payload.new_password,
        }).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
        return { ok: true as const }
      }),
    )
    .handle("listEmails", Effect.fnUntraced(function*() {
        const session = yield* requireSession()
        const rows = yield* Auth.listEmails().pipe(
          withAuthContext(session.sessionId),
          Effect.mapError(() => new AuthError({ message: "Could not load emails" })),
        )
        return rows.map(toUserEmail)
      }),
    )
    .handle("addEmail", Effect.fnUntraced(function*({ payload }) {
        const session = yield* requireSession()
        const row = yield* Auth.addEmail(payload.email).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
        return toUserEmail(row)
      }),
    )
    .handle("verifyEmail", Effect.fnUntraced(function*({ payload }) {
        yield* Auth.verifyEmail(payload).pipe(
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
        return { ok: true as const }
      }),
    )
    .handle("removeEmail", Effect.fnUntraced(function*({ params: { id } }) {
        const session = yield* requireSession()
        yield* Auth.removeEmail(id).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
        return { ok: true as const }
      }),
    )
    .handle("makeEmailPrimary", Effect.fnUntraced(function*({ params: { id } }) {
        const session = yield* requireSession()
        const row = yield* Auth.makeEmailPrimary(id).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
        return toUserEmail(row)
      }),
    )
    .handle("resendEmailVerification", Effect.fnUntraced(function*({ params: { id } }) {
        const session = yield* requireSession()
        yield* Auth.resendEmailVerification(id).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new AuthError({ message: e.message })),
        )
        return { ok: true as const }
      }),
    ),
)
