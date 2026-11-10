import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Auth } from "../services/auth"
import { withAuthContext } from "../db"
import { asSignedIn, ifSignedIn } from "./scope"
import { AuthError } from "../../api/auth"
import { GigListApi } from "../../api/contracts"
import { CurrentSession, sessionCookie } from "../../api/session"

const isSecure = process.env.NODE_ENV === "production"

const ok = { ok: true as const }

/** Answers a service failure with its message, as the 4xx the browser shows. */
const asAuthError = Effect.mapError((e: { readonly message: string }) => new AuthError({ message: e.message }))

const asUser = asSignedIn(() => new AuthError({ message: "You must be signed in" }))

export const AuthApiGroupLive = HttpApiBuilder.group(GigListApi, "auth", (handlers) =>
  handlers
    .handle("login", ({ payload }) =>
      Auth.use((auth) => auth.login(payload)).pipe(
        Effect.flatMap((result) => setSessionCookie(result.sessionId)),
        Effect.as(ok),
        asAuthError,
      ),
    )
    .handle("register", ({ payload }) =>
      Auth.use((auth) => auth.register(payload)).pipe(
        Effect.flatMap((result) => setSessionCookie(result.sessionId)),
        Effect.as(ok),
        asAuthError,
      ),
    )
    .handle("forgotPassword", ({ payload }) =>
      Auth.use((auth) => auth.forgotPassword(payload.email)).pipe(Effect.orDie, Effect.as(ok)),
    )
    .handle("resetPassword", ({ payload }) =>
      Auth.use((auth) => auth.resetPassword(payload)).pipe(
        asAuthError,
        Effect.flatMap((result) => setSessionCookie(result.sessionId)),
        Effect.as(ok),
      ),
    )
    .handle("logout", () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        if (session.sessionId) {
          yield* Auth.use((auth) => auth.logout(session.sessionId)).pipe(Effect.orDie)
        }
        yield* clearSessionCookie
        return ok
      }),
    )
    .handle("me", () => Auth.use((auth) => auth.getMe()).pipe(withAuthContext, ifSignedIn(Effect.succeed(null))))
    .handle("updateMe", ({ payload }) => Auth.use((auth) => auth.updateProfile(payload)).pipe(asAuthError, asUser))
    .handle("changePassword", ({ payload }) =>
      Auth.use((auth) =>
        auth.changePassword({ oldPassword: payload.old_password, newPassword: payload.new_password }),
      ).pipe(asAuthError, Effect.as(ok), asUser),
    )
    .handle("listEmails", () =>
      Auth.use((auth) => auth.listEmails()).pipe(
        Effect.mapError(() => new AuthError({ message: "Could not load emails" })),
        Effect.map((rows) => rows.map(toUserEmail)),
        asUser,
      ),
    )
    .handle("addEmail", ({ payload }) =>
      Auth.use((auth) => auth.addEmail(payload.email)).pipe(asAuthError, Effect.map(toUserEmail), asUser),
    )
    .handle("verifyEmail", ({ payload }) =>
      Auth.use((auth) => auth.verifyEmail(payload)).pipe(asAuthError, Effect.as(ok)),
    )
    .handle("removeEmail", ({ params: { id } }) =>
      Auth.use((auth) => auth.removeEmail(id)).pipe(asAuthError, Effect.as(ok), asUser),
    )
    .handle("makeEmailPrimary", ({ params: { id } }) =>
      Auth.use((auth) => auth.makeEmailPrimary(id)).pipe(asAuthError, Effect.map(toUserEmail), asUser),
    )
    .handle("resendEmailVerification", ({ params: { id } }) =>
      Auth.use((auth) => auth.resendEmailVerification(id)).pipe(asAuthError, Effect.as(ok), asUser),
    )
    .handle("requestAccountDeletion", () =>
      Auth.use((auth) => auth.requestAccountDeletion()).pipe(asAuthError, Effect.as(ok), asUser),
    )
    .handle("confirmAccountDeletion", ({ payload }) =>
      Auth.use((auth) => auth.confirmAccountDeletion(payload.token)).pipe(
        asAuthError,
        asUser,
        // The user row is gone; drop the cookie so the browser is signed out.
        Effect.andThen(clearSessionCookie),
        Effect.as(ok),
      ),
    ),
)

const setSessionCookie = (sessionId: string) =>
  HttpApiBuilder.securitySetCookie(sessionCookie, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: "30 days",
  })

const clearSessionCookie = HttpApiBuilder.securitySetCookie(sessionCookie, "", {
  httpOnly: true,
  sameSite: "lax",
  secure: isSecure,
  path: "/",
  maxAge: "0 seconds",
})

const toUserEmail = (row: { id: string; email: string; is_verified: boolean; is_primary: boolean; created_at: Date }) => ({
  id: row.id,
  email: row.email,
  is_verified: row.is_verified,
  is_primary: row.is_primary,
  created_at: row.created_at,
})
