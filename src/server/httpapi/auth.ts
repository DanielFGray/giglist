import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Auth, type AuthFailure, AccountError } from "../services/auth"
import { withAuthContext } from "../db"
import { toHttpError } from "../dbErrors"
import { type DatabaseError, isDatabaseError } from "../databaseError"
import { asSignedIn, ifSignedIn } from "./scope"
import { sessionCookiePolicy } from "./session"
import { AuthError } from "../../api/auth"
import { Unauthorized } from "../../api/errors"
import { GigListApi } from "../../api/contracts"
import { CurrentSession, sessionCookie } from "../../api/session"

const ok = { ok: true as const }

/** Answers a service failure with its message, as the 4xx the browser shows. */
const toAuthError = (e: { readonly message: string }) => Effect.fail(new AuthError({ message: e.message }))

/** A rejected sign-in answers 401 with the service's message. */
const toUnauthorized = (e: { readonly message: string }) =>
  Effect.fail(new Unauthorized({ message: e.message, reason: "invalid_credentials" }))

/** Each service failure answers the one contract class, with the service's message. */
const asAuthError = <A, R>(effect: Effect.Effect<A, AuthFailure | AccountError | DatabaseError, R>) =>
  effect.pipe(Effect.catchTags({
  AccountError: toAuthError,
  AccountLocked: toAuthError,
  DuplicateAccount: toAuthError,
  InvalidCredentials: toAuthError,
  InvitationRefused: toAuthError,
  RegistrationFailed: toAuthError,
  WeakPassword: toAuthError,
  DatabaseError: toHttpError,
}))

const asUser = asSignedIn(() => new AuthError({ message: "You must be signed in" }))

export const AuthApiGroupLive = HttpApiBuilder.group(GigListApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const cookie = yield* sessionCookiePolicy
    const setSessionCookie = (sessionId: string) => HttpApiBuilder.securitySetCookie(sessionCookie, sessionId, cookie)
    const clearSessionCookie = HttpApiBuilder.securitySetCookie(sessionCookie, "", { ...cookie, maxAge: "0 seconds" })
    return handlers
      .handle("login", ({ payload }) =>
        Auth.use((auth) => auth.login(payload)).pipe(
          Effect.flatMap((result) => setSessionCookie(result.sessionId)),
          Effect.as(ok),
          Effect.catchTags({ AccountLocked: toUnauthorized, InvalidCredentials: toUnauthorized, DatabaseError: toHttpError }),
        ),
      )
      .handle("register", ({ payload }) =>
        Auth.use((auth) => auth.register(payload)).pipe(
          Effect.flatMap((result) => setSessionCookie(result.sessionId)),
          Effect.as(ok),
          asAuthError,
        ),
      )
      .handle("invitationPreview", ({ params: { invitationId }, query: { code } }) =>
        Auth.use((auth) => auth.invitationPreview(invitationId, code)).pipe(asAuthError, withAuthContext, Effect.catchIf(isDatabaseError, toHttpError)),
      )
      .handle("joinByInvitation", ({ params: { invitationId }, payload }) =>
        Auth.use((auth) => auth.joinByInvitation({ invitationId, ...payload })).pipe(
          Effect.flatMap(({ bandId, sessionId }) => setSessionCookie(sessionId).pipe(Effect.as({ bandId }))),
          asAuthError,
        ),
      )
      .handle("forgotPassword", ({ payload }) =>
        Auth.use((auth) => auth.forgotPassword(payload.email)).pipe(Effect.catchTag("DatabaseError", toHttpError), Effect.as(ok)),
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
            yield* Auth.use((auth) => auth.logout(session.sessionId)).pipe(Effect.catchTag("DatabaseError", toHttpError))
          }
          yield* clearSessionCookie
          return ok
        }),
      )
      .handle("me", () => Auth.use((auth) => auth.getMe()).pipe(withAuthContext, Effect.catchTag("DatabaseError", toHttpError), ifSignedIn(Effect.succeed(null))))
      .handle("updateMe", ({ payload }) => Auth.use((auth) => auth.updateProfile(payload)).pipe(asAuthError, asUser))
      .handle("changePassword", ({ payload }) =>
        Auth.use((auth) =>
          auth.changePassword({ oldPassword: payload.old_password, newPassword: payload.new_password }),
        ).pipe(asAuthError, Effect.as(ok), asUser),
      )
      .handle("listEmails", () =>
        Auth.use((auth) => auth.listEmails()).pipe(
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
      )
  }),
)

const toUserEmail = (row: { id: string; email: string; is_verified: boolean; is_primary: boolean; created_at: Date }) => ({
  id: row.id,
  email: row.email,
  is_verified: row.is_verified,
  is_primary: row.is_primary,
  created_at: row.created_at,
})
