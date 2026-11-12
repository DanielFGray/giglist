import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Unauthorized } from "./errors"
import { RateLimitMiddleware } from "./rate-limit"
import { SessionMiddleware } from "./session"

// --- Auth schemas ---

/*
 * Passwords carry through the handler and service as `Redacted`, so a password
 * cannot reach a log or a trace by accident. `RedactedFromValue` decodes the
 * string the client sends and wraps it; the wire form stays a plain string, and
 * the service unwraps it only where it hashes or verifies the value.
 */
export const LoginPayload = S.Struct({
  id: S.String,
  password: S.RedactedFromValue(S.String),
})

/*
 * The field rules below repeat the database's checks. The forms validate
 * against these payloads as the person types, so each message reaches the
 * field it is about; a rule only the database holds comes back as one
 * message for the whole form.
 */

/** Matches `app_public.username`: 2–64 chars, letter then letters/digits/_/-. */
const Username = S.String.pipe(
  S.check(S.isMinLength(2, { message: "Use at least 2 characters" })),
  S.check(S.isMaxLength(64, { message: "Use at most 64 characters" })),
  S.check(
    S.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]+$/, {
      message: "Start with a letter, then use only letters, digits, _ and -",
    }),
  ),
)

/** Matches the check on `app_public.user_emails.email`. */
const Email = S.String.check(S.isPattern(/^[^@]+@[^@]+\.[^@]+$/, { message: "Enter an email address" }))

const NewPassword = S.RedactedFromValue(
  S.String.check(S.isMinLength(8, { message: "Use at least 8 characters" })),
)

export const RegisterPayload = S.Struct({
  username: Username,
  email: Email,
  password: NewPassword,
})

export const ForgotPasswordPayload = S.Struct({ email: S.String })

export const ResetPasswordPayload = S.Struct({
  userId: S.String.check(S.isUUID()),
  token: S.String.check(S.isMinLength(1)),
  password: NewPassword,
})

/** Matches `app_public.url`, or null when the user clears the field. */
const AvatarUrl = S.NullOr(
  S.String.pipe(S.check(S.isPattern(/^https?:\/\/\S+$/))),
)

export const AuthUser = S.Struct({
  id: S.String.check(S.isUUID()),
  username: S.String,
  name: S.NullOr(S.String),
  bio: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  /** Whether anyone may open `/u/:username` (docs/adr/0011); off until the user turns it on. */
  is_public: S.Boolean,
  /** The profile's theme (docs/adr/0012), shaped like a band's `PageTheme` below. */
  page_theme: S.NullOr(S.String),
  page_options: S.Record(S.String, S.String),
  role: S.String,
  is_verified: S.Boolean,
})

export const UpdateProfilePayload = S.Struct({
  username: Username,
  name: S.NullOr(S.String.pipe(S.check(S.isMaxLength(200)))),
  // Markdown (docs/adr/0010), sized like a band's description.
  bio: S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000)))),
  avatar_url: AvatarUrl,
  is_public: S.optional(S.Boolean),
  page_theme: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(200_000))))),
  page_options: S.optional(
    S.Record(
      S.String.pipe(S.check(S.isPattern(/^(color|image|text|if):[A-Za-z][A-Za-z0-9 ]*$/))),
      S.String.pipe(S.check(S.isMaxLength(2000))),
    ),
  ),
})

export const ChangePasswordPayload = S.Struct({
  old_password: S.RedactedFromValue(S.String),
  new_password: NewPassword,
})

export const UserEmail = S.Struct({
  id: S.String.check(S.isUUID()),
  email: S.String,
  is_verified: S.Boolean,
  is_primary: S.Boolean,
  created_at: S.Date,
})

export const AddEmailPayload = S.Struct({
  email: Email,
})

export const VerifyEmailPayload = S.Struct({
  id: S.String.check(S.isUUID()),
  token: S.String.pipe(S.check(S.isMinLength(1))),
})

export const ConfirmAccountDeletionPayload = S.Struct({
  token: S.String.pipe(S.check(S.isMinLength(1))),
})

export const AuthSuccess = S.Struct({ ok: S.Literals([true]) })

export class AuthError extends S.TaggedError<AuthError, { readonly brand: unique symbol }>()("AuthError", { message: S.String }, { httpApiStatus: 400 }) {}

// --- Auth API group ---
// NOTE: .prefix() must come AFTER .add() — prefix only applies to existing endpoints

export const AuthApiGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login", {
      payload: LoginPayload,
      success: AuthSuccess,
      error: Unauthorized,
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.post("register", "/register", {
      payload: RegisterPayload,
      success: AuthSuccess,
      error: AuthError,
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.post("forgotPassword", "/forgot-password", {
      payload: ForgotPasswordPayload,
      success: AuthSuccess,
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.post("resetPassword", "/reset-password", {
      payload: ResetPasswordPayload,
      success: AuthSuccess,
      error: AuthError,
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.post("logout", "/logout", { success: AuthSuccess }).middleware(
      SessionMiddleware,
    ),
  )
  .add(
    HttpApiEndpoint.get("me", "/me", { success: S.NullOr(AuthUser) }).middleware(
      SessionMiddleware,
    ),
  )
  .add(
    HttpApiEndpoint.put("updateMe", "/me", {
      payload: UpdateProfilePayload,
      success: AuthUser,
      error: AuthError,
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("changePassword", "/password", {
      payload: ChangePasswordPayload,
      success: AuthSuccess,
      error: AuthError,
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.get("listEmails", "/emails", {
      success: S.Array(UserEmail),
      error: AuthError,
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("addEmail", "/emails", {
      payload: AddEmailPayload,
      success: UserEmail.pipe(HttpApiSchema.status(201)),
      error: AuthError,
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("verifyEmail", "/emails/verify", {
      payload: VerifyEmailPayload,
      success: AuthSuccess,
      error: AuthError,
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.delete("removeEmail", "/emails/:id", {
      params: { id: S.String.check(S.isUUID()) },
      success: AuthSuccess,
      error: AuthError,
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("makeEmailPrimary", "/emails/:id/primary", {
      params: { id: S.String.check(S.isUUID()) },
      success: UserEmail,
      error: AuthError,
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("resendEmailVerification", "/emails/:id/resend", {
      params: { id: S.String.check(S.isUUID()) },
      success: AuthSuccess,
      error: AuthError,
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("requestAccountDeletion", "/account/delete-request", {
      success: AuthSuccess,
      error: AuthError,
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("confirmAccountDeletion", "/account/delete", {
      payload: ConfirmAccountDeletionPayload,
      success: AuthSuccess,
      error: AuthError,
    }).middleware(SessionMiddleware),
  )
  .prefix("/api/auth")
