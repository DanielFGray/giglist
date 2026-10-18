import { Context, Effect, Schema as S } from "effect"
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

export const RegisterPayload = S.Struct({
  username: S.String,
  email: S.String,
  password: S.RedactedFromValue(S.String),
})

export const AuthUser = S.Struct({
  id: S.String.check(S.isUUID()),
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  role: S.String,
  is_verified: S.Boolean,
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
    }),
  )
  .add(
    HttpApiEndpoint.post("register", "/register", {
      payload: RegisterPayload,
      success: AuthSuccess,
      error: AuthError.pipe(HttpApiSchema.status(400)),
    }),
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
  .prefix("/api/auth")

// --- Bands schemas ---

export const BandInfo = S.Struct({
  id: S.String.check(S.isUUID()),
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  created_at: S.String,
})

export const BandMember = S.Struct({
  id: S.String.check(S.isUUID()),
  user_id: S.String.check(S.isUUID()),
  is_owner: S.Boolean,
  created_at: S.String,
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

export const InvitePayload = S.Struct({
  username: S.optional(S.String),
  email: S.optional(S.String),
})

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
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/my/bands")

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

export const TestingSuccess = S.Struct({ success: S.Boolean })

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
  created_at: S.String,
  updated_at: S.String,
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

export const SongUpdate = S.Struct({
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

export const Setlist = S.Struct({
  id: S.String.check(S.isUUID()),
  band_id: S.String.check(S.isUUID()),
  name: S.String,
  description: S.NullOr(S.String),
  /** `YYYY-MM-DD`, or null when the setlist is not tied to a date. */
  gig_date: S.NullOr(S.String),
  status: SetlistStatus,
  created_at: S.String,
  updated_at: S.String,
})

export const SetlistInsert = S.Struct({
  band_id: S.String.check(S.isUUID()),
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(500))),
  description: S.NullOr(S.String.pipe(S.check(S.isMaxLength(5000)))),
  gig_date: S.NullOr(S.String.pipe(S.check(S.isPattern(/^\d{4}-\d{2}-\d{2}$/)))),
  status: SetlistStatus,
})

export const SetlistUpdate = S.Struct({
  name: SetlistInsert.fields.name,
  description: SetlistInsert.fields.description,
  gig_date: SetlistInsert.fields.gig_date,
  status: SetlistStatus,
})

/**
 * One song in a setlist, as `app_public.setlist_entries_resolved` returns it:
 * the entry's own fields with the song's defaults filled in, and a flag per
 * field saying whether the entry overrides it.
 */
export const SetlistEntry = S.Struct({
  id: S.String.check(S.isUUID()),
  setlist_id: S.String.check(S.isUUID()),
  section_id: S.NullOr(S.String.check(S.isUUID())),
  song_id: S.String.check(S.isUUID()),
  position: S.Finite,
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

export const SetlistEntryInsert = S.Struct({
  song_id: S.String.check(S.isUUID()),
  position: S.Finite,
  section_id: S.optional(S.NullOr(S.String.check(S.isUUID()))),
})

/** The whole entry is sent on update: a null override means "inherit". */
export const SetlistEntryUpdate = S.Struct({
  position: S.Finite,
  section_id: S.NullOr(S.String.check(S.isUUID())),
  key_override: S.NullOr(musicalKey),
  tempo_override: S.NullOr(
    S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(1)), S.check(S.isLessThanOrEqualTo(999))),
  ),
  notes_override: S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000)))),
})

/** A named group of entries in a setlist ("Set 1", "Encore"), in the order the setlist plays them. */
export const SetlistSection = S.Struct({
  id: S.String.check(S.isUUID()),
  setlist_id: S.String.check(S.isUUID()),
  name: S.String,
  position: S.Finite,
})

export const SetlistSectionName = S.Struct({
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
})

/**
 * The whole play order in one value: sections in order, each with its entries
 * in order. A null `section_id` is the group of entries that belong to no
 * section. The server numbers the positions itself, so the client never
 * computes a position and gaps never run out.
 */
export const SetlistArrangement = S.Struct({
  groups: S.Array(
    S.Struct({
      section_id: S.NullOr(S.String.check(S.isUUID())),
      entries: S.Array(S.String.check(S.isUUID())),
    }),
  ),
})

/** Someone with a setlist open: reading it, or performing it from song number `at`. */
export const SetlistViewer = S.Struct({
  client: S.String.check(S.isUUID()),
  username: S.String,
  mode: S.Literals(["viewing", "performing"]),
  at: S.NullOr(S.Finite),
})

/**
 * What a setlist's event stream carries. `changed` says the setlist was written
 * and by whom, and holds no data: a listener fetches the new state through the
 * ordinary endpoints, so row-level security decides what it sees. `presence` is
 * the full list of viewers each time it changes. `ping` keeps an idle
 * connection alive and lets a client notice a dead one.
 */
export const SetlistEvent = S.Union([
  S.Struct({ kind: S.Literal("changed"), by: S.NullOr(S.String) }),
  S.Struct({ kind: S.Literal("presence"), viewers: S.Array(SetlistViewer) }),
  S.Struct({ kind: S.Literal("ping") }),
])

export const SetlistPresence = S.Struct({
  client: S.String.check(S.isUUID()),
  mode: S.Literals(["viewing", "performing"]),
  at: S.NullOr(S.Finite),
})

export class SetlistForbidden extends S.TaggedError<
  SetlistForbidden,
  { readonly brand: unique symbol }
>()("SetlistForbidden", { message: S.String }) {}

export class SetlistNotFound extends S.TaggedError<
  SetlistNotFound,
  { readonly brand: unique symbol }
>()("SetlistNotFound", { id: S.String.check(S.isUUID()) }) {}

export const SetlistsApiGroup = HttpApiGroup.make("setlists")
  .add(
    HttpApiEndpoint.get("listSetlists", "/band/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
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
  .add(
    HttpApiEndpoint.get("getSetlist", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      success: Setlist,
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.put("updateSetlist", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SetlistUpdate,
      success: Setlist,
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteSetlist", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.get("listEntries", "/:id/entries", {
      params: { id: S.String.check(S.isUUID()) },
      success: S.Array(SetlistEntry),
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("addEntry", "/:id/entries", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SetlistEntryInsert,
      success: SetlistEntry.pipe(HttpApiSchema.status(201)),
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.put("updateEntry", "/:id/entries/:entryId", {
      params: {
        id: S.String.check(S.isUUID()),
        entryId: S.String.check(S.isUUID()),
      },
      payload: SetlistEntryUpdate,
      success: SetlistEntry,
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteEntry", "/:id/entries/:entryId", {
      params: {
        id: S.String.check(S.isUUID()),
        entryId: S.String.check(S.isUUID()),
      },
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.get("watchSetlist", "/:id/events", {
      params: { id: S.String.check(S.isUUID()) },
      query: { client: S.String.check(S.isUUID()) },
      success: HttpApiSchema.StreamSse({ data: SetlistEvent }),
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("reportPresence", "/:id/presence", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SetlistPresence,
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.get("listSections", "/:id/sections", {
      params: { id: S.String.check(S.isUUID()) },
      success: S.Array(SetlistSection),
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("addSection", "/:id/sections", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SetlistSectionName,
      success: SetlistSection.pipe(HttpApiSchema.status(201)),
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.put("renameSection", "/:id/sections/:sectionId", {
      params: {
        id: S.String.check(S.isUUID()),
        sectionId: S.String.check(S.isUUID()),
      },
      payload: SetlistSectionName,
      success: SetlistSection,
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteSection", "/:id/sections/:sectionId", {
      params: {
        id: S.String.check(S.isUUID()),
        sectionId: S.String.check(S.isUUID()),
      },
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.put("arrange", "/:id/arrangement", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SetlistArrangement,
      error: [
        SetlistNotFound.pipe(HttpApiSchema.status(404)),
        SetlistForbidden.pipe(HttpApiSchema.status(403)),
      ],
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/setlists")

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
  created_at: S.String,
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

/** One replacement in a change set: `[from, to)` of the earlier anchor text became `insert` characters. */
export const ChartChange = S.Struct({
  from: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  to: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  insert: S.Int.check(S.isGreaterThanOrEqualTo(0)),
})

/**
 * A new revision of a lyrics chart, saved by the editor. `parent_id` must be
 * the chart's newest revision and `changes` must explain how the text became
 * `source` (docs/adr/0001).
 */
export const ChartRevisionInsert = S.Struct({
  parent_id: S.String.check(S.isUUID()),
  source: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200000))),
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
  created_at: S.String,
  updated_at: S.String,
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
  created_at: S.String,
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

export const SetListApi = HttpApi.make("SetListApi")
  .add(AuthApiGroup)
  .add(BandsApiGroup)
  .add(TestingApiGroup)
  .add(SongsApiGroup)
  .add(SetlistsApiGroup)
  .add(ChartsApiGroup)
  .add(ScoresApiGroup)
  .add(MarksApiGroup)
  .add(StampsApiGroup)
