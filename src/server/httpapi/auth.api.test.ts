import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AuthUser, UserEmail } from "../../api/auth"
import { baseUrl, TestHttpClientLive } from "../test/apiHarness"
import { anonymous, login, postJson, register, sendJson, signedIn, testPassword } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)

const me = (client: HttpClient.HttpClient) =>
  client.get(`${baseUrl}/auth/me`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.NullOr(AuthUser))))

const emails = (client: HttpClient.HttpClient) =>
  client.get(`${baseUrl}/auth/emails`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(UserEmail))))

describe("auth over HTTP", () => {
  it.effect("a session starts at sign-up and ends at logout", () =>
    Effect.gen(function* () {
      const client = yield* anonymous
      const username = `auth_session_${runId}`

      expect((yield* register(client, username)).status).toBe(200)
      expect((yield* me(client))?.username).toBe(username)

      expect((yield* postJson(client, "/auth/logout", {})).status).toBe(200)
      expect(yield* me(client)).toBeNull()

      expect((yield* login(client, username)).status).toBe(200)
      expect((yield* me(client))?.username).toBe(username)
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a wrong password is refused and starts no session", () =>
    Effect.gen(function* () {
      const client = yield* anonymous
      const username = `auth_refused_${runId}`
      yield* register(client, username)
      yield* postJson(client, "/auth/logout", {})

      const refused = yield* login(client, username, "not-the-password")
      expect(refused.status).toBe(401)
      expect(yield* me(client)).toBeNull()
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a signed-in user manages their emails and password", () =>
    Effect.gen(function* () {
      const username = `auth_user_${runId}`
      const user = yield* signedIn(username)
      expect((yield* me(user))?.username).toBe(username)

      // The sign-up address is not primary until it is verified.
      const [first] = yield* emails(user)
      expect(first).toMatchObject({ email: `${username}@example.com`, is_primary: false })

      const added = yield* postJson(user, "/auth/emails", { email: `${username}.second@example.com` }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(UserEmail)),
      )
      expect(added).toMatchObject({ is_primary: false, is_verified: false })
      expect((yield* sendJson(user, "DELETE", `/auth/emails/${added.id}`, {})).status).toBe(200)
      expect((yield* emails(user)).map((e) => e.id)).toEqual([first?.id])

      const changed = yield* postJson(user, "/auth/password", { old_password: testPassword, new_password: `${testPassword}2` })
      expect(changed.status).toBe(200)
      expect((yield* login(yield* anonymous, username, `${testPassword}2`)).status).toBe(200)
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a signed-out caller is nobody, owns nothing, and cannot change an account", () =>
    Effect.gen(function* () {
      const nobody = yield* anonymous
      expect(yield* me(nobody)).toBeNull()
      expect(yield* nobody.get(`${baseUrl}/my/bands`).pipe(Effect.flatMap((r) => r.json))).toEqual([])

      const refused = yield* nobody.get(`${baseUrl}/auth/emails`)
      expect(refused.status).toBe(400)
      expect(yield* refused.json).toMatchObject({ message: "You must be signed in" })
      expect((yield* sendJson(nobody, "PUT", "/auth/me", { name: "x" })).status).toBe(400)
      expect((yield* postJson(nobody, "/my/bands", { slug: `nobody-${runId}`, name: "x" })).status).toBe(400)
    }).pipe(Effect.provide(TestHttpClientLive)))
})
