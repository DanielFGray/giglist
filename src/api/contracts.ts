import { Context, Effect, Schema as S, Struct } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "effect/http-api"

// --- Security ---

export const sessionCookie = HttpApiSecurity.apiKey({
  key: "session",
  in: "cookie",
})

// --- Session context (server provides, client strips) ---

export interface SessionData {
  readonly sessionId: string
  readonly userId: string | null
}

export class CurrentSession extends Context.Service<CurrentSession, SessionData>()("CurrentSession") {}

export class SessionMiddleware extends HttpApiMiddleware.Service<
  SessionMiddleware,
  { provides: CurrentSession }
>()("SessionMiddleware", {
  security: { session: sessionCookie },
}) {}

// --- Rate limiting ---

export class TooManyRequests extends S.TaggedError<TooManyRequests, { readonly brand: unique symbol }>()(
  "TooManyRequests",
  { message: S.String, retryAfterSeconds: S.Int },
) {}

/**
 * Limits how often one caller may use an endpoint. The limit comes from the
 * server's rule for the endpoint's name (`httpapi/rate-limit.ts`); an endpoint
 * with no rule passes through. Add this BEFORE `SessionMiddleware` on an
 * endpoint: a later middleware wraps the earlier ones, so the limiter then runs
 * inside the session and can key a rule on the signed-in user.
 */
export class RateLimitMiddleware extends HttpApiMiddleware.Service<RateLimitMiddleware>()(
  "RateLimitMiddleware",
  { error: TooManyRequests.pipe(HttpApiSchema.status(429)) },
) {}

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
  email: S.String.pipe(S.check(S.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))),
})

export const VerifyEmailPayload = S.Struct({
  id: S.String.check(S.isUUID()),
  token: S.String.pipe(S.check(S.isMinLength(1))),
})

export const ConfirmAccountDeletionPayload = S.Struct({
  token: S.String.pipe(S.check(S.isMinLength(1))),
})

export const AuthSuccess = S.Struct({ ok: S.Literals([true]) })

export class AuthError extends S.TaggedError<AuthError, { readonly brand: unique symbol }>()("AuthError", { message: S.String },) {}

// --- Auth API group ---
// NOTE: .prefix() must come AFTER .add() — prefix only applies to existing endpoints

export const AuthApiGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login", {
      payload: LoginPayload,
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(401)),
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.post("register", "/register", {
      payload: RegisterPayload,
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
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
      error: AuthError.pipe(HttpApiSchema.status(400)),
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
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("changePassword", "/password", {
      payload: ChangePasswordPayload,
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.get("listEmails", "/emails", {
      success: S.Array(UserEmail),
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("addEmail", "/emails", {
      payload: AddEmailPayload,
      success: UserEmail.pipe(HttpApiSchema.status(201)),
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("verifyEmail", "/emails/verify", {
      payload: VerifyEmailPayload,
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.delete("removeEmail", "/emails/:id", {
      params: { id: S.String.check(S.isUUID()) },
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("makeEmailPrimary", "/emails/:id/primary", {
      params: { id: S.String.check(S.isUUID()) },
      success: UserEmail,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("resendEmailVerification", "/emails/:id/resend", {
      params: { id: S.String.check(S.isUUID()) },
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("requestAccountDeletion", "/account/delete-request", {
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(RateLimitMiddleware).middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("confirmAccountDeletion", "/account/delete", {
      payload: ConfirmAccountDeletionPayload,
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }).middleware(SessionMiddleware),
  )
  .prefix("/api/auth")

// --- Bands schemas ---

/**
 * How a band's public page looks (docs/adr/0006): `page_theme` is an HTML
 * document with theme tags, or null for the built-in Classic theme, and
 * `page_options` holds the band's values for the options the theme declares,
 * keyed like `color:Accent`.
 */
export const PageTheme = S.Struct({
  page_theme: S.NullOr(S.String.pipe(S.check(S.isMaxLength(200_000)))),
  page_options: S.Record(
    S.String.pipe(S.check(S.isPattern(/^(color|image|text|if):[A-Za-z][A-Za-z0-9 ]*$/))),
    S.String.pipe(S.check(S.isMaxLength(2000))),
  ),
})

export const BandInfo = S.Struct({
  id: S.String.check(S.isUUID()),
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  is_public: S.Boolean,
  show_members_publicly: S.Boolean,
  show_gig_dates_publicly: S.Boolean,
  show_songs_publicly: S.Boolean,
  ...PageTheme.fields,
  created_at: S.Date,
})

export const BandMember = S.Struct({
  id: S.String.check(S.isUUID()),
  user_id: S.String.check(S.isUUID()),
  is_owner: S.Boolean,
  created_at: S.Date,
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
})

/** An invitation to join a band, addressed to the signed-in user. */
export const BandInvitation = S.Struct({
  id: S.String.check(S.isUUID()),
  band_id: S.String.check(S.isUUID()),
  band_name: S.String,
})

export const CreateBandPayload = S.Struct({
  slug: S.String,
  name: S.String,
})

export const UpdateBandPayload = S.Struct({
  // Markdown (docs/adr/0010): room for prose plus the links and pasted embed code that become players.
  description: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000))))),
  is_public: S.optional(S.Boolean),
  show_members_publicly: S.optional(S.Boolean),
  show_gig_dates_publicly: S.optional(S.Boolean),
  show_songs_publicly: S.optional(S.Boolean),
  page_theme: S.optional(PageTheme.fields.page_theme),
  page_options: S.optional(PageTheme.fields.page_options),
})

export const PublicBandMember = S.Struct({
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  is_owner: S.Boolean,
})

export const PublicBandGig = S.Struct({
  venue: S.NullOr(S.String),
  /** `YYYY-MM-DD` */
  gig_date: S.String,
})

export const PublicBandSong = S.Struct({
  title: S.String,
  artist: S.NullOr(S.String),
})

/**
 * A band's public page. Each list is empty when the owner has not turned it on,
 * so the page shows a section exactly when its list has rows.
 */
export const PublicBandProfile = S.Struct({
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  ...PageTheme.fields,
  members: S.Array(PublicBandMember),
  gigs: S.Array(PublicBandGig),
  songs: S.Array(PublicBandSong),
})

export const InvitePayload = S.Struct({
  username: S.optional(S.String),
  email: S.optional(S.String),
})

/**
 * Leave a band. Owners with other members must name a successor; the sole
 * owner deletes the band instead (`DELETE /:bandId`).
 */
export const LeaveBandPayload = S.Struct({
  transfer_to: S.optional(S.String.check(S.isUUID())),
})

export const TransferOwnershipPayload = S.Struct({
  user_id: S.String.check(S.isUUID()),
})

export const BandSuccess = S.Struct({ ok: S.Literals([true]) })

export class BandError extends S.TaggedError<BandError, { readonly brand: unique symbol }>()("BandError", { message: S.String },) {}

// --- Bands API group ---

export const BandsApiGroup = HttpApiGroup.make("myBands")
  .add(
    HttpApiEndpoint.get("listBands", "/", {
      success: S.Array(BandInfo),
    }),
  )
  .add(
    HttpApiEndpoint.get("getBandMembers", "/:bandId/members", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: S.Array(BandMember),
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createBand", "/", {
      payload: CreateBandPayload,
      success: BandInfo,
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteBand", "/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: BandSuccess,
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.put("updateBand", "/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: UpdateBandPayload,
      success: BandInfo,
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.post("leaveBand", "/:bandId/leave", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: LeaveBandPayload,
      success: BandSuccess,
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.post("transferOwnership", "/:bandId/transfer", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: TransferOwnershipPayload,
      success: BandSuccess,
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.get("listInvitations", "/invitations", {
      success: S.Array(BandInvitation),
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/invitations/:invitationId/accept", {
      params: { invitationId: S.String.check(S.isUUID()) },
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.post("declineInvitation", "/invitations/:invitationId/decline", {
      params: { invitationId: S.String.check(S.isUUID()) },
      error: BandError.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteToBand", "/:bandId/invite", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: InvitePayload,
      error: BandError.pipe(HttpApiSchema.status(400)),
    }).middleware(RateLimitMiddleware),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/my/bands")

export class PublicBandNotFound extends S.TaggedError<
  PublicBandNotFound,
  { readonly brand: unique symbol }
>()("PublicBandNotFound", { slug: S.String }) {}

export const PublicBandsApiGroup = HttpApiGroup.make("publicBands")
  .add(
    HttpApiEndpoint.get("getPublicBand", "/:slug", {
      params: { slug: S.String.pipe(S.check(S.isMinLength(1))) },
      success: PublicBandProfile,
      error: PublicBandNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .prefix("/api/public/bands")

// --- Public user profiles ---

/** A band with a public page that a user belongs to, linked from their profile. */
export const PublicUserBand = S.Struct({
  slug: S.String,
  name: S.String,
})

/**
 * A user's public profile (docs/adr/0011). Present only while the user keeps
 * `is_public` on; `bands` holds only bands whose own page is also on.
 */
export const PublicUserProfile = S.Struct({
  username: S.String,
  name: S.NullOr(S.String),
  bio: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  ...PageTheme.fields,
  bands: S.Array(PublicUserBand),
})

export class PublicUserNotFound extends S.TaggedError<
  PublicUserNotFound,
  { readonly brand: unique symbol }
>()("PublicUserNotFound", { username: S.String }) {}

export const PublicUsersApiGroup = HttpApiGroup.make("publicUsers")
  .add(
    HttpApiEndpoint.get("getPublicUser", "/:username", {
      params: { username: S.String.pipe(S.check(S.isMinLength(1))) },
      success: PublicUserProfile,
      error: PublicUserNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .prefix("/api/public/users")

// --- Testing schemas ---

export const SeedBandPayload = S.Struct({
  username: S.String,
  password: S.String,
  bandName: S.String,
  bandSlug: S.String,
})

/** Test-only: put an existing user in a band without an invitation. */
export const AddBandMemberPayload = S.Struct({
  band_id: S.String.check(S.isUUID()),
  username: S.String,
})

export const TestingLoginPayload = S.Struct({
  username: S.String,
  password: S.String,
})

export const TestingSuccess = S.Struct({
  success: S.Boolean,
  /** Why it failed. Present only when `success` is false. */
  message: S.optional(S.String),
})

/**
 * Creates a user through app_private.really_create_user, bypassing the
 * registration safety checks the UI path goes through, and reports the
 * verification token so tests can exercise the verify flow directly.
 */
export const CreateTestUserPayload = S.Struct({
  username: S.String.pipe(S.withDecodingDefaultType(Effect.succeed("testuser"))),
  email: S.String.pipe(S.withDecodingDefaultType(Effect.succeed("testuser@example.com"))),
  verified: S.Boolean.pipe(S.withDecodingDefaultType(Effect.succeed(false))),
  name: S.optional(S.String),
  avatarUrl: S.NullOr(S.String).pipe(S.withDecodingDefaultType(Effect.succeed(null))),
  password: S.String.pipe(S.withDecodingDefaultType(Effect.succeed("TestUserPassword"))),
})

export const TestUser = S.Struct({
  id: S.String.check(S.isUUID()),
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  role: S.String,
  is_verified: S.Boolean,
  created_at: S.Date,
  updated_at: S.Date,
})

export const CreateTestUserResult = S.Struct({
  user: TestUser,
  userEmailId: S.String,
  verificationToken: S.NullOr(S.String),
})

/** app_private.user_secrets — never visible to the user, read only in tests. */
export const TestUserSecrets = S.Struct({
  user_id: S.String.check(S.isUUID()),
  password_hash: S.NullOr(S.String),
  last_login_at: S.Date,
  failed_password_attempts: S.Finite,
  first_failed_password_attempt: S.NullOr(S.Date),
  reset_password_token: S.NullOr(S.String),
  reset_password_token_generated: S.NullOr(S.Date),
  failed_reset_password_attempts: S.Finite,
  first_failed_reset_password_attempt: S.NullOr(S.Date),
  delete_account_token: S.NullOr(S.String),
  delete_account_token_generated: S.NullOr(S.Date),
})

/** app_private.user_email_secrets — never visible to the user, read only in tests. */
export const TestEmailSecrets = S.Struct({
  user_email_id: S.String.check(S.isUUID()),
  verification_token: S.NullOr(S.String),
  verification_email_sent_at: S.NullOr(S.Date),
  password_reset_email_sent_at: S.NullOr(S.Date),
  reset_password_token: S.NullOr(S.String),
})

export const TestingApiGroup = HttpApiGroup.make("testing")
  .add(
    HttpApiEndpoint.post("clear", "/clear", {
      success: TestingSuccess,
    }),
  )
  .add(
    HttpApiEndpoint.post("seedBand", "/seed-band", {
      payload: SeedBandPayload,
      success: TestingSuccess,
    }),
  )
  .add(
    HttpApiEndpoint.post("addBandMember", "/band-member", {
      payload: AddBandMemberPayload,
      success: TestingSuccess,
    }),
  )
  .add(
    HttpApiEndpoint.post("testLogin", "/login", {
      payload: TestingLoginPayload,
      success: TestingSuccess,
    }),
  )
  .add(
    // The same path as the POST, as a GET, so a dev can log in from a browser
    // address bar. It answers a redirect, so the response has no body of its
    // own. See the handler for why a GET is acceptable here.
    HttpApiEndpoint.get("testLoginRedirect", "/login", {
      query: {
        username: S.String,
        password: S.String.pipe(
          S.withDecodingDefaultType(Effect.succeed("TestUserPassword")),
        ),
      },
      success: HttpApiSchema.Empty(302),
    }),
  )
  .add(
    HttpApiEndpoint.get("clearTestUsers", "/clear-test-users", {
      success: TestingSuccess,
    }),
  )
  .add(
    HttpApiEndpoint.get("clearTestOrganizations", "/clear-test-organizations", {
      success: TestingSuccess,
    }),
  )
  .add(
    HttpApiEndpoint.post("createUser", "/create-user", {
      payload: CreateTestUserPayload,
      success: CreateTestUserResult,
    }),
  )
  .add(
    HttpApiEndpoint.get("getUserSecrets", "/user-secrets", {
      query: { username: S.String },
      success: TestUserSecrets,
    }),
  )
  .add(
    HttpApiEndpoint.get("getEmailSecrets", "/email-secrets", {
      query: { email: S.String },
      success: TestEmailSecrets,
    }),
  )
  .add(
    HttpApiEndpoint.get("verifyUser", "/verify-user", {
      query: { username: S.String },
      success: TestingSuccess,
    }),
  )
  .prefix("/api/testing")

// --- Songs schemas ---

/**
 * The keys the `app_public.musical_key` domain accepts, spelled out because the
 * schema uses a text domain with a check constraint rather than an enum. A value
 * outside this list fails here as a 400, instead of reaching the database and
 * coming back as a domain violation.
 */
const keys = [
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb",
  "G", "G#", "Ab", "A", "A#", "Bb", "B",
  "Cm", "C#m", "Dbm", "Dm", "D#m", "Ebm", "Em", "Fm", "F#m", "Gbm",
  "Gm", "G#m", "Abm", "Am", "A#m", "Bbm", "Bm",
] as const

export const MusicalKeys = keys

export type MusicalKeyType = S.Schema.Type<typeof musicalKey>

const musicalKey = S.Literals([...keys])

/*
 * Wire schemas for the song catalog, declared here rather than taken from
 * generated/song.ts: that module imports src/server/db.ts, so bringing its
 * schemas into the contract would pull @effect/sql-pg into the browser bundle.
 * The server decodes database rows into these before responding.
 */
export const Song = S.Struct({
  id: S.String.check(S.isUUID()),
  band_id: S.String.check(S.isUUID()),
  title: S.String,
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Finite),
  duration_seconds: S.NullOr(S.Finite),
  capo: S.NullOr(S.Finite),
  notes: S.NullOr(S.String),
  created_by: S.NullOr(S.String.check(S.isUUID())),
  created_at: S.Date,
  updated_at: S.Date,
})

export const SongInsert = S.Struct({
  band_id: S.String.check(S.isUUID()),
  title: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(500))),
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)), S.check(S.isLessThanOrEqualTo(999)))),
  duration_seconds: S.NullOr(
    S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)), S.check(S.isLessThanOrEqualTo(86400))),
  ),
  capo: S.NullOr(S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)), S.check(S.isLessThanOrEqualTo(12)))),
  notes: S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000)))),
})

/**
 * The fields to change; an absent field keeps its value. A grid cell sends only
 * its own field, so two people editing different cells of one song both land.
 */
/** A song's own fields: everything a band can set on it. */
export const SongFields = Struct.omit(SongInsert.fields, ["band_id"])

export const SongUpdate = S.Struct(Struct.map(SongFields, S.optionalKey))

export class SongNotFound extends S.TaggedError<SongNotFound, { readonly brand: unique symbol }>()("SongNotFound", {
  id: S.String.check(S.isUUID()),
}) {}

/**
 * Declared here instead of importing the generated group, which maps its reads
 * onto bare `GET /:param` paths; the Effect router rejects the resulting
 * duplicate route and the server fails to start. Spelling the paths out also
 * lets a band's catalog (`GET /band/:bandId`) and one song (`GET /:id`) coexist.
 * Only the URLs are re-declared — the handler's queries come from
 * generated/queries.ts, and the lookup by id happens inside the handler, which
 * needs the song row to authorise its band anyway.
 */
export class SongForbidden extends S.TaggedError<SongForbidden, { readonly brand: unique symbol }>()("SongForbidden", { message: S.String },) {}

export const SongsApiGroup = HttpApiGroup.make("songs")
  .add(
    HttpApiEndpoint.get("songFindById", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      success: Song,
      error: SongForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.get("songFindByBandId", "/band/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: S.Array(Song),
      error: SongForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("songCreate", "/", {
      payload: SongInsert,
      success: Song.pipe(HttpApiSchema.status(201)),
      error: SongForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.put("songUpdate", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SongUpdate,
      success: Song,
      error: [
        SongNotFound.pipe(HttpApiSchema.status(404)),
        SongForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("songDelete", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: [
        SongNotFound.pipe(HttpApiSchema.status(404)),
        SongForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/songs")

// --- Setlists schemas ---

export const SetlistStatus = S.Literals(["draft", "rehearsal", "final"])

export type SetlistStatusType = S.Schema.Type<typeof SetlistStatus>

const uuid = S.String.check(S.isUUID())

const SetlistName = S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))

/** A gig that plays a setlist: enough to name it (see `gigLabel`) and link to it. */
export const GigRef = S.Struct({
  id: uuid,
  venue: S.NullOr(S.String),
  /** `YYYY-MM-DD`, or null when the gig has no date yet. */
  gig_date: S.NullOr(S.String),
})

/** A named, ordered list of songs. `gigs` are the gigs that play it, soonest first: an edit reaches all of them. */
export const Setlist = S.Struct({
  id: uuid,
  band_id: uuid,
  name: S.String,
  status: SetlistStatus,
  gigs: S.Array(GigRef),
  /** How many songs, and their summed durations (songs without one count as 0). */
  song_count: S.Finite,
  duration_seconds: S.Finite,
  created_at: S.Date,
  updated_at: S.Date,
})

export const SetlistInsert = S.Struct({
  band_id: uuid,
  name: SetlistName,
})

export const SetlistUpdate = S.Struct({
  name: S.optionalKey(SetlistName),
  status: S.optionalKey(SetlistStatus),
})

/** A copy takes the songs and their overrides; it plays in no gig until one adds it. */
export const SetlistCopy = S.Struct({
  name: SetlistName,
})

/**
 * One song in a setlist, as `app_public.setlist_entries_resolved` returns it:
 * the entry's own fields with the song's defaults filled in, and a flag per
 * field saying whether the entry overrides it.
 */
export const SetlistEntry = S.Struct({
  id: uuid,
  setlist_id: uuid,
  song_id: uuid,
  position_key: S.String,
  title: S.String,
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Finite),
  notes: S.NullOr(S.String),
  duration_seconds: S.NullOr(S.Finite),
  capo: S.NullOr(S.Finite),
  key_overridden: S.Boolean,
  tempo_overridden: S.Boolean,
  notes_overridden: S.Boolean,
})

/** A new entry plays last. */
export const SetlistEntryInsert = S.Struct({
  song_id: uuid,
})

/**
 * The fields to change; an absent field keeps its value. A null override means
 * "inherit the song's value". `song_id` puts another song of the band in this
 * place, keeping the overrides.
 */
export const SetlistEntryUpdate = S.Struct({
  song_id: S.optionalKey(uuid),
  key_override: S.optionalKey(S.NullOr(musicalKey)),
  tempo_override: S.optionalKey(
    S.NullOr(S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(1)), S.check(S.isLessThanOrEqualTo(999)))),
  ),
  notes_override: S.optionalKey(S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000))))),
})

/** One reorder: `id` goes right after `previous`, or first when `previous` is null. The server resolves keys inside the write. */
export const Move = S.Struct({
  id: uuid,
  previous: S.NullOr(uuid),
})

/** Someone with a setlist or a gig open: reading it, or performing it from song number `at`. */
export const LiveViewer = S.Struct({
  client: uuid,
  username: S.String,
  mode: S.Literals(["viewing", "performing"]),
  at: S.NullOr(S.Finite),
})

/**
 * What a setlist's or a gig's event stream carries. `changed` says it was
 * written and by whom, and holds no data: a listener fetches the new state
 * through the ordinary endpoints, so row-level security decides what it sees.
 * `presence` is the full list of viewers each time it changes. `ping` keeps an
 * idle connection alive and lets a client notice a dead one.
 */
export const LiveEvent = S.Union([
  S.Struct({ kind: S.Literal("changed"), by: S.NullOr(S.String) }),
  S.Struct({ kind: S.Literal("presence"), viewers: S.Array(LiveViewer) }),
  S.Struct({ kind: S.Literal("ping") }),
])

export const LivePresence = S.Struct({
  client: uuid,
  mode: LiveViewer.fields.mode,
  at: LiveViewer.fields.at,
})

export class SetlistForbidden extends S.TaggedError<
  SetlistForbidden,
  { readonly brand: unique symbol }
>()("SetlistForbidden", { message: S.String }) {}

export class SetlistNotFound extends S.TaggedError<
  SetlistNotFound,
  { readonly brand: unique symbol }
>()("SetlistNotFound", { id: uuid }) {}

const setlistErrors = [
  SetlistNotFound.pipe(HttpApiSchema.status(404)),
  SetlistForbidden.pipe(HttpApiSchema.status(403)),
]

export const SetlistsApiGroup = HttpApiGroup.make("setlists")
  .add(
    HttpApiEndpoint.get("listSetlists", "/band/:bandId", {
      params: { bandId: uuid },
      success: S.Array(Setlist),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createSetlist", "/", {
      payload: SetlistInsert,
      success: Setlist.pipe(HttpApiSchema.status(201)),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(HttpApiEndpoint.get("getSetlist", "/:id", { params: { id: uuid }, success: Setlist, error: setlistErrors }))
  .add(
    HttpApiEndpoint.put("updateSetlist", "/:id", {
      params: { id: uuid },
      payload: SetlistUpdate,
      success: Setlist,
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("copySetlist", "/:id/copy", {
      params: { id: uuid },
      payload: SetlistCopy,
      success: Setlist.pipe(HttpApiSchema.status(201)),
      error: setlistErrors,
    }),
  )
  .add(HttpApiEndpoint.delete("deleteSetlist", "/:id", { params: { id: uuid }, error: setlistErrors }))
  .add(
    HttpApiEndpoint.get("listEntries", "/:id/entries", {
      params: { id: uuid },
      success: S.Array(SetlistEntry),
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("addEntry", "/:id/entries", {
      params: { id: uuid },
      payload: SetlistEntryInsert,
      success: SetlistEntry.pipe(HttpApiSchema.status(201)),
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("updateEntry", "/:id/entries/:entryId", {
      params: { id: uuid, entryId: uuid },
      payload: SetlistEntryUpdate,
      success: SetlistEntry,
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteEntry", "/:id/entries/:entryId", {
      params: { id: uuid, entryId: uuid },
      error: setlistErrors,
    }),
  )
  .add(HttpApiEndpoint.put("move", "/:id/move", { params: { id: uuid }, payload: Move, error: setlistErrors }))
  .add(
    HttpApiEndpoint.get("watchSetlist", "/:id/events", {
      params: { id: uuid },
      query: { client: uuid },
      success: HttpApiSchema.StreamSse({ data: LiveEvent }),
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportPresence", "/:id/presence", {
      params: { id: uuid },
      payload: LivePresence,
      error: setlistErrors,
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/setlists")

// --- Gigs schemas ---

/**
 * A wall-clock time at the venue on the gig date, `HH:MM` (the database may
 * answer `HH:MM:SS`). No time zone is stored: the gig date and the venue's
 * local time are all a band needs to know when to show up.
 */
const GigTime = S.NullOr(
  S.String.pipe(S.check(S.isPattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/))),
)

/** A setlist as a gig plays it, in the gig's order. `gig_count` counts every gig that plays it, this one included. */
export const GigSetlist = S.Struct({
  id: uuid,
  name: S.String,
  song_count: S.Finite,
  duration_seconds: S.Finite,
  gig_count: S.Finite,
})

/** One performance. It has no name: `gigLabel` names it by venue, or by date. */
export const Gig = S.Struct({
  ...GigRef.fields,
  band_id: uuid,
  address: S.NullOr(S.String),
  load_in_time: GigTime,
  performance_time: GigTime,
  /** For the band only. */
  notes: S.NullOr(S.String),
  setlists: S.Array(GigSetlist),
  created_at: S.Date,
  updated_at: S.Date,
})

export const GigDetails = S.Struct({
  venue: S.NullOr(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))),
  gig_date: S.NullOr(S.String.pipe(S.check(S.isPattern(/^\d{4}-\d{2}-\d{2}$/)))),
  address: S.NullOr(S.String.pipe(S.check(S.isMaxLength(1000)))),
  load_in_time: GigTime,
  performance_time: GigTime,
  notes: S.NullOr(S.String.pipe(S.check(S.isMaxLength(5000)))),
})

export const GigInsert = S.Struct({
  band_id: uuid,
  ...GigDetails.fields,
})

/** A setlist the gig starts playing, after the ones it already plays. */
export const GigSetlistInsert = S.Struct({
  setlist_id: uuid,
})

/** One song of a gig, in play order: an entry of one of its setlists. */
export const GigEntry = S.Struct({
  ...SetlistEntry.fields,
  setlist_name: S.String,
})

export class GigNotFound extends S.TaggedError<GigNotFound, { readonly brand: unique symbol }>()("GigNotFound", {
  id: uuid,
}) {}

const gigErrors = [
  GigNotFound.pipe(HttpApiSchema.status(404)),
  SetlistForbidden.pipe(HttpApiSchema.status(403)),
]

export const GigsApiGroup = HttpApiGroup.make("gigs")
  .add(
    HttpApiEndpoint.get("listGigs", "/band/:bandId", {
      params: { bandId: uuid },
      success: S.Array(Gig),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createGig", "/", {
      payload: GigInsert,
      success: Gig.pipe(HttpApiSchema.status(201)),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(HttpApiEndpoint.get("getGig", "/:id", { params: { id: uuid }, success: Gig, error: gigErrors }))
  .add(
    HttpApiEndpoint.put("updateGig", "/:id", {
      params: { id: uuid },
      payload: GigDetails,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(HttpApiEndpoint.delete("deleteGig", "/:id", { params: { id: uuid }, error: gigErrors }))
  .add(
    HttpApiEndpoint.post("addGigSetlist", "/:id/setlists", {
      params: { id: uuid },
      payload: GigSetlistInsert,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeGigSetlist", "/:id/setlists/:setlistId", {
      params: { id: uuid, setlistId: uuid },
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    // The gig plays a new copy of the setlist in its place; other gigs keep the original.
    HttpApiEndpoint.post("copyGigSetlist", "/:id/setlists/:setlistId/copy", {
      params: { id: uuid, setlistId: uuid },
      payload: SetlistCopy,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("moveGigSetlist", "/:id/setlists/move", {
      params: { id: uuid },
      payload: Move,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listGigEntries", "/:id/entries", {
      params: { id: uuid },
      success: S.Array(GigEntry),
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("watchGig", "/:id/events", {
      params: { id: uuid },
      query: { client: uuid },
      success: HttpApiSchema.StreamSse({ data: LiveEvent }),
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportGigPresence", "/:id/presence", {
      params: { id: uuid },
      payload: LivePresence,
      error: gigErrors,
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/gigs")

// --- Charts schemas ---

/**
 * A chart with the text of its newest revision. `source` is the stored
 * ChordPro text, which the browser draws with `renderLyrics` and edits as
 * chords over lyrics (`exportChords`); it is null for a score, whose bytes are
 * fetched separately.
 */
export const Chart = S.Struct({
  id: S.String.check(S.isUUID()),
  song_id: S.String.check(S.isUUID()),
  kind: S.Literals(["lyrics", "score"]),
  name: S.String,
  written_key: S.NullOr(musicalKey),
  revision_id: S.String.check(S.isUUID()),
  source: S.NullOr(S.String),
  created_at: S.Date,
})

/** A lyrics chart made from text pasted as chords over lyrics. */
export const LyricsChartInsert = S.Struct({
  song_id: S.String.check(S.isUUID()),
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  written_key: S.NullOr(musicalKey),
  pasted: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(100000))),
})

export class ChartForbidden extends S.TaggedError<ChartForbidden, { readonly brand: unique symbol }>()("ChartForbidden", {
  message: S.String,
}) {}

/** One replacement in a change set: `[from, to)` of the earlier anchor text became `insert` characters; optional `source` names the exact earlier anchor range copied as a move. */
export const ChartChange = S.Struct({
  from: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  to: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  insert: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  source: S.optional(S.Int.check(S.isGreaterThanOrEqualTo(0))),
})

/**
 * A new revision of a lyrics chart, saved by the editor. `parent_id` must be
 * the chart's newest revision and `changes` must explain how the text became
 * `source` (docs/adr/0001).
 */
export const ChartRevisionInsert = S.Struct({
  parent_id: S.String.check(S.isUUID()),
  // An empty source is a chart whose last block was deleted; it parses to one empty line.
  source: S.String.pipe(S.check(S.isMaxLength(200000))),
  changes: S.NullOr(S.Array(ChartChange).pipe(S.check(S.isMaxLength(10000)))),
})

/** Someone saved a newer revision since the editor loaded the chart. */
export class ChartConflict extends S.TaggedError<ChartConflict, { readonly brand: unique symbol }>()("ChartConflict", {
  message: S.String,
}) {}

/** The revision is not one the editor could have made from its parent. */
export class ChartInvalid extends S.TaggedError<ChartInvalid, { readonly brand: unique symbol }>()("ChartInvalid", {
  message: S.String,
}) {}

/** An uploaded file as the raw request or response body. */
const fileBytes = S.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }))

export const ChartsApiGroup = HttpApiGroup.make("charts")
  .add(
    HttpApiEndpoint.get("listCharts", "/song/:songId", {
      params: { songId: S.String.check(S.isUUID()) },
      success: S.Array(Chart),
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createLyricsChart", "/", {
      payload: LyricsChartInsert,
      success: Chart.pipe(HttpApiSchema.status(201)),
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    // The body is a PDF or an image; the answer is the chords and lyrics read
    // from it, as text for the paste box. Nothing is stored.
    HttpApiEndpoint.post("readChartFile", "/read", {
      payload: fileBytes,
      success: S.Struct({ text: S.String }),
      error: [
        ChartForbidden.pipe(HttpApiSchema.status(403)),
        ChartInvalid.pipe(HttpApiSchema.status(400)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("saveRevision", "/:id/revisions", {
      params: { id: S.String.check(S.isUUID()) },
      payload: ChartRevisionInsert,
      success: Chart.pipe(HttpApiSchema.status(201)),
      error: [
        ChartForbidden.pipe(HttpApiSchema.status(403)),
        ChartConflict.pipe(HttpApiSchema.status(409)),
        ChartInvalid.pipe(HttpApiSchema.status(400)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteChart", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/charts")

// --- Marks and stamps schemas ---

/** Ink strokes in em units from the body's top-left. Each point is [x, y, pressure]. */
export const InkBody = S.Struct({
  kind: S.Literal("ink"),
  strokes: S.Array(S.Array(S.Tuple([S.Finite, S.Finite, S.Finite])).pipe(S.check(S.isMaxLength(5000)))).pipe(
    S.check(S.isMaxLength(200)),
  ),
  width: S.Finite,
  height: S.Finite,
})

export const TextBody = S.Struct({
  kind: S.Literal("text"),
  text: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(2000))),
})

export const MarkBody = S.Union([InkBody, TextBody])

/** What a mark's range counts: characters of a lyrics chart's anchor text. */
export const MarkScope = S.Struct({ kind: S.Literal("chart") })

const markPlacement = {
  revision_id: S.String.check(S.isUUID()),
  scope: MarkScope,
  range_start: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  range_end: S.Int.check(S.isGreaterThanOrEqualTo(1)),
  side: S.Literals(["inline", "margin"]),
  dx: S.Finite,
  dy: S.Finite,
  scale: S.Finite.pipe(S.check(S.isGreaterThan(0))),
  body: MarkBody,
  visibility: S.Literals(["private", "band"]),
}

export const MarkInsert = S.Struct(markPlacement)

/** The whole mark is sent on update: moving one anchors it again, to the revision it was dropped on. */
export const MarkUpdate = S.Struct(markPlacement)

export const Mark = S.Struct({
  id: S.String.check(S.isUUID()),
  user_id: S.String.check(S.isUUID()),
  ...markPlacement,
  created_at: S.Date,
  updated_at: S.Date,
})

/** One revision of a chart, as the browser needs it to follow a mark: its text and the change set the editor recorded. */
export const RevisionStep = S.Struct({
  id: S.String.check(S.isUUID()),
  source: S.NullOr(S.String),
  changes: S.NullOr(S.Array(ChartChange)),
})

/**
 * The marks a player can see on a chart (their own and the band's shared
 * ones), with every revision from the oldest of those marks' revisions on, in
 * order. Following a mark across them needs no further request.
 */
export const ChartMarks = S.Struct({
  marks: S.Array(Mark),
  revisions: S.Array(RevisionStep),
})

export const Stamp = S.Struct({
  id: S.String.check(S.isUUID()),
  name: S.String,
  body: MarkBody,
  created_at: S.Date,
})

export const StampInsert = S.Struct({
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  body: MarkBody,
})

export class MarkForbidden extends S.TaggedError<MarkForbidden, { readonly brand: unique symbol }>()("MarkForbidden", {
  message: S.String,
}) {}

export class MarkNotFound extends S.TaggedError<MarkNotFound, { readonly brand: unique symbol }>()("MarkNotFound", {
  id: S.String.check(S.isUUID()),
}) {}

export const MarksApiGroup = HttpApiGroup.make("marks")
  .add(
    HttpApiEndpoint.get("listMarks", "/chart/:chartId", {
      params: { chartId: S.String.check(S.isUUID()) },
      success: ChartMarks,
      error: MarkForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createMark", "/", {
      payload: MarkInsert,
      success: Mark.pipe(HttpApiSchema.status(201)),
      error: MarkForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.put("updateMark", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      payload: MarkUpdate,
      success: Mark,
      error: [MarkNotFound.pipe(HttpApiSchema.status(404)), MarkForbidden.pipe(HttpApiSchema.status(403))],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMark", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: [MarkNotFound.pipe(HttpApiSchema.status(404)), MarkForbidden.pipe(HttpApiSchema.status(403))],
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/marks")

export const StampsApiGroup = HttpApiGroup.make("stamps")
  .add(
    HttpApiEndpoint.get("listStamps", "/", {
      success: S.Array(Stamp),
      error: MarkForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createStamp", "/", {
      payload: StampInsert,
      success: Stamp.pipe(HttpApiSchema.status(201)),
      error: MarkForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteStamp", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: [MarkNotFound.pipe(HttpApiSchema.status(404)), MarkForbidden.pipe(HttpApiSchema.status(403))],
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/stamps")

// --- Scores ---

/** Where a score upload goes and what it is called; the request body is the file itself. */
export const ScoreUploadQuery = {
  song_id: S.String.check(S.isUUID()),
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  file_name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(255))),
}

export const ScoresApiGroup = HttpApiGroup.make("scores")
  .add(
    // The body is the Guitar Pro file, stored byte for byte as the chart's first revision.
    HttpApiEndpoint.post("uploadScore", "/", {
      query: ScoreUploadQuery,
      payload: fileBytes,
      success: Chart.pipe(HttpApiSchema.status(201)),
      error: [
        ChartForbidden.pipe(HttpApiSchema.status(403)),
        ChartInvalid.pipe(HttpApiSchema.status(400)),
      ],
    }),
  )
  .add(
    // A revision never changes, so the same URL always answers the same bytes.
    HttpApiEndpoint.get("scoreFile", "/:revisionId/file", {
      params: { revisionId: S.String.check(S.isUUID()) },
      success: fileBytes,
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/scores")

// --- Unified API ---

export const GigListApi = HttpApi.make("GigListApi")
  .add(AuthApiGroup)
  .add(BandsApiGroup)
  .add(PublicBandsApiGroup)
  .add(PublicUsersApiGroup)
  .add(SongsApiGroup)
  .add(SetlistsApiGroup)
  .add(GigsApiGroup)
  .add(ChartsApiGroup)
  .add(ScoresApiGroup)
  .add(MarksApiGroup)
  .add(StampsApiGroup)

export const TestingApi = HttpApi.make("TestingApi").add(TestingApiGroup)
