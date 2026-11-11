import { Effect, Schema as S } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

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

/**
 * Test-only: write position keys directly, so a spec can start from keys near
 * the length that makes a move renumber its group, instead of making hundreds
 * of moves to grow them.
 */
export const SetPositionKeysPayload = S.Struct({
  entries: S.Array(S.Struct({ id: S.String.check(S.isUUID()), position_key: S.String })),
  gig_setlists: S.Array(S.Struct({
    gig_id: S.String.check(S.isUUID()),
    setlist_id: S.String.check(S.isUUID()),
    position_key: S.String,
  })),
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

/** The invitation's id and the code its emailed link carries. Read only in tests. */
export const TestBandInvitation = S.Struct({
  id: S.String.check(S.isUUID()),
  code: S.NullOr(S.String),
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
    HttpApiEndpoint.put("setPositionKeys", "/position-keys", {
      payload: SetPositionKeysPayload,
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
    HttpApiEndpoint.get("getBandInvitation", "/band-invitation", {
      query: { band_id: S.String, email: S.String },
      success: TestBandInvitation,
    }),
  )
  .add(
    HttpApiEndpoint.get("verifyUser", "/verify-user", {
      query: { username: S.String },
      success: TestingSuccess,
    }),
  )
  .prefix("/api/testing")

export const TestingApi = HttpApi.make("TestingApi").add(TestingApiGroup)
