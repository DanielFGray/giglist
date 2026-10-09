import { Schema as S } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "@effect/platform"
import { Context } from "effect"

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
  .prefix("/api/testing")

// --- Unified API ---

export const SetListApi = HttpApi.make("SetListApi")
  .add(AuthApiGroup)
  .add(BandsApiGroup)
  .add(TestingApiGroup)
