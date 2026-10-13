import { Schema as S } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "@effect/platform"
import { Context } from "effect"// --- Security ---

export const sessionCookie = HttpApiSecurity.apiKey({
  key: "session",
  in: "cookie",
})

// --- Session context (server provides, client strips) ---

export interface SessionData {
  readonly sessionId: string
  readonly userId: string | null
}

export class CurrentSession extends Context.Tag("CurrentSession")<
  CurrentSession,
  SessionData
>() {}

export class SessionMiddleware extends HttpApiMiddleware.Tag<SessionMiddleware>()(
  "SessionMiddleware",
  {
    provides: CurrentSession,
    security: { session: sessionCookie },
  },
) {}

// --- Auth schemas ---

export const LoginPayload = S.Struct({
  id: S.String,
  password: S.String,
})

export const RegisterPayload = S.Struct({
  username: S.String,
  email: S.String,
  password: S.String,
})

export const AuthUser = S.Struct({
  id: S.UUID,
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  role: S.String,
  is_verified: S.Boolean,
})

export const AuthSuccess = S.Struct({ ok: S.Literal(true) })

export class AuthError extends S.TaggedError<AuthError>()(
  "AuthError",
  { message: S.String },
) {}

// --- Auth API group ---
// NOTE: .prefix() must come AFTER .add() — prefix only applies to existing endpoints

export const AuthApiGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login")`/login`
      .setPayload(LoginPayload)
      .addSuccess(AuthSuccess)
      .addError(AuthError, { status: 401 }),
  )
  .add(
    HttpApiEndpoint.post("register")`/register`
      .setPayload(RegisterPayload)
      .addSuccess(AuthSuccess)
      .addError(AuthError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("logout")`/logout`
      .addSuccess(AuthSuccess)
      .middleware(SessionMiddleware),
  )
  .add(
    HttpApiEndpoint.get("me")`/me`
      .addSuccess(S.NullOr(AuthUser))
      .middleware(SessionMiddleware),
  )
  .prefix("/api/auth")

// --- Bands schemas ---

export const BandInfo = S.Struct({
  id: S.UUID,
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  created_at: S.String,
})

export const BandMember = S.Struct({
  id: S.UUID,
  user_id: S.UUID,
  is_owner: S.Boolean,
  created_at: S.String,
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
})

export const CreateBandPayload = S.Struct({
  slug: S.String,
  name: S.String,
})

export const InvitePayload = S.Struct({
  username: S.optional(S.String),
  email: S.optional(S.String),
})

export class BandError extends S.TaggedError<BandError>()(
  "BandError",
  { message: S.String },
) {}

// --- Bands API group ---

export const BandsApiGroup = HttpApiGroup.make("myBands")
  .middleware(SessionMiddleware)
  .add(
    HttpApiEndpoint.get("listBands")`/`
      .addSuccess(S.Array(BandInfo)),
  )
  .add(
    HttpApiEndpoint.get("getBandMembers")`/${HttpApiSchema.param("bandId", S.UUID)}/members`
      .addSuccess(S.Array(BandMember)),
  )
  .add(
    HttpApiEndpoint.post("createBand")`/`
      .setPayload(CreateBandPayload)
      .addSuccess(BandInfo)
      .addError(BandError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.del("deleteBand")`/${HttpApiSchema.param("bandId", S.UUID)}`
      .addError(BandError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("inviteToBand")`/${HttpApiSchema.param("bandId", S.UUID)}/invite`
      .setPayload(InvitePayload)
      .addError(BandError, { status: 400 }),
  )
  .prefix("/api/my/bands")

// --- Testing schemas ---

export const SeedBandPayload = S.Struct({
  username: S.String,
  password: S.String,
  bandName: S.String,
  bandSlug: S.String,
})

export const TestingLoginPayload = S.Struct({
  username: S.String,
  password: S.String,
})

export const TestingSuccess = S.Struct({ success: S.Boolean })

/**
 * Creates a user through app_private.really_create_user, bypassing the
 * registration safety checks the UI path goes through, and reports the
 * verification token so tests can exercise the verify flow directly.
 */
export const CreateTestUserPayload = S.Struct({
  username: S.optionalWith(S.String, { default: () => "testuser" }),
  email: S.optionalWith(S.String, { default: () => "testuser@example.com" }),
  verified: S.optionalWith(S.Boolean, { default: () => false }),
  name: S.optional(S.String),
  avatarUrl: S.optionalWith(S.NullOr(S.String), { default: () => null }),
  password: S.optionalWith(S.String, { default: () => "TestUserPassword" }),
})

export const TestUser = S.Struct({
  id: S.UUID,
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
  user_id: S.UUID,
  password_hash: S.NullOr(S.String),
  last_login_at: S.Date,
  failed_password_attempts: S.Number,
  first_failed_password_attempt: S.NullOr(S.Date),
  reset_password_token: S.NullOr(S.String),
  reset_password_token_generated: S.NullOr(S.Date),
  failed_reset_password_attempts: S.Number,
  first_failed_reset_password_attempt: S.NullOr(S.Date),
  delete_account_token: S.NullOr(S.String),
  delete_account_token_generated: S.NullOr(S.Date),
})

/** app_private.user_email_secrets — never visible to the user, read only in tests. */
export const TestEmailSecrets = S.Struct({
  user_email_id: S.UUID,
  verification_token: S.NullOr(S.String),
  verification_email_sent_at: S.NullOr(S.Date),
  password_reset_email_sent_at: S.NullOr(S.Date),
})

export const TestingApiGroup = HttpApiGroup.make("testing")
  .add(
    HttpApiEndpoint.post("clear")`/clear`
      .addSuccess(TestingSuccess),
  )
  .add(
    HttpApiEndpoint.post("seedBand")`/seed-band`
      .setPayload(SeedBandPayload)
      .addSuccess(TestingSuccess),
  )
  .add(
    HttpApiEndpoint.post("testLogin")`/login`
      .setPayload(TestingLoginPayload)
      .addSuccess(TestingSuccess),
  )
  .add(
    HttpApiEndpoint.get("clearTestUsers")`/clear-test-users`
      .addSuccess(TestingSuccess),
  )
  .add(
    HttpApiEndpoint.get("clearTestOrganizations")`/clear-test-organizations`
      .addSuccess(TestingSuccess),
  )
  .add(
    HttpApiEndpoint.post("createUser")`/create-user`
      .setPayload(CreateTestUserPayload)
      .addSuccess(CreateTestUserResult),
  )
  .add(
    HttpApiEndpoint.get("getUserSecrets")`/user-secrets`
      .setPayload(S.Struct({ username: S.String }))
      .addSuccess(TestUserSecrets),
  )
  .add(
    HttpApiEndpoint.get("getEmailSecrets")`/email-secrets`
      .setPayload(S.Struct({ email: S.String }))
      .addSuccess(TestEmailSecrets),
  )
  .add(
    HttpApiEndpoint.get("verifyUser")`/verify-user`
      .setPayload(S.Struct({ username: S.String }))
      .addSuccess(TestingSuccess),
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

const musicalKey = S.Literal(...keys)

/*
 * Wire schemas for the song catalog, declared here rather than taken from
 * generated/song.ts: that module imports src/server/db.ts, so bringing its
 * schemas into the contract would pull @effect/sql-pg into the browser bundle.
 * The server decodes database rows into these before responding.
 */
export const Song = S.Struct({
  id: S.UUID,
  band_id: S.UUID,
  title: S.String,
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Number),
  duration_seconds: S.NullOr(S.Number),
  capo: S.NullOr(S.Number),
  notes: S.NullOr(S.String),
  created_by: S.NullOr(S.UUID),
  created_at: S.String,
  updated_at: S.String,
})

export const SongInsert = S.Struct({
  band_id: S.UUID,
  title: S.String.pipe(S.minLength(1), S.maxLength(500)),
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Number.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(999))),
  duration_seconds: S.NullOr(
    S.Number.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(86400)),
  ),
  capo: S.NullOr(S.Number.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(12))),
  notes: S.NullOr(S.String.pipe(S.maxLength(10000))),
})

export const SongUpdate = S.Struct({
  title: S.String.pipe(S.minLength(1), S.maxLength(500)),
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Number.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(999))),
  duration_seconds: S.NullOr(
    S.Number.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(86400)),
  ),
  capo: S.NullOr(S.Number.pipe(S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(12))),
  notes: S.NullOr(S.String.pipe(S.maxLength(10000))),
})

export class SongNotFound extends S.TaggedError<SongNotFound>()("SongNotFound", {
  id: S.UUID,
}) {}

/**
 * Declared here instead of importing the generated group, which maps both
 * songFindById and songFindByBandId onto `GET /:param`; the Effect router
 * rejects that as a duplicate route and the server fails to start. Only the
 * URLs are re-declared — the handler's queries come from generated/queries.ts,
 * and the lookup by id happens inside the handler, which needs the song row to
 * authorise its band anyway.
 */
export class SongForbidden extends S.TaggedError<SongForbidden>()(
  "SongForbidden",
  { message: S.String },
) {}

export const SongsApiGroup = HttpApiGroup.make("songs")
  .middleware(SessionMiddleware)
  .add(
    HttpApiEndpoint.get("songFindByBandId")`/band/${HttpApiSchema.param("bandId", S.UUID)}`
      .addSuccess(S.Array(Song))
      .addError(SongForbidden, { status: 403 }),
  )
  .add(
    HttpApiEndpoint.post("songCreate", "/")
      .setPayload(SongInsert)
      .addSuccess(Song, { status: 201 })
      .addError(SongForbidden, { status: 403 }),
  )
  .add(
    HttpApiEndpoint.put("songUpdate")`/${HttpApiSchema.param("id", S.UUID)}`
      .setPayload(SongUpdate)
      .addSuccess(Song)
      .addError(SongNotFound, { status: 404 })
      .addError(SongForbidden, { status: 403 }),
  )
  .add(
    HttpApiEndpoint.del("songDelete")`/${HttpApiSchema.param("id", S.UUID)}`
      .addError(SongNotFound, { status: 404 })
      .addError(SongForbidden, { status: 403 }),
  )
  .prefix("/api/songs")

// --- Unified API ---

export const SetListApi = HttpApi.make("SetListApi")
  .add(AuthApiGroup)
  .add(BandsApiGroup)
  .add(TestingApiGroup)
  .add(SongsApiGroup)
