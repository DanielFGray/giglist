import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AuthUser } from "../../api/contracts"
import { baseUrl, makeCookieJar, TestHttpClientLive } from "../test/apiHarness"
import { login, postJson, register } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)
const me = (client: HttpClient.HttpClient) =>
  client.get(`${baseUrl}/auth/me`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.NullOr(AuthUser))))

describe("auth over HTTP", () => {
  it.effect("a session starts at sign-up and ends at logout", () =>
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withCookiesRef(yield* makeCookieJar))
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
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withCookiesRef(yield* makeCookieJar))
      const username = `auth_refused_${runId}`
      yield* register(client, username)
      yield* postJson(client, "/auth/logout", {})

      const refused = yield* login(client, username, "not-the-password")
      expect(refused.status).toBe(401)
      expect(yield* me(client)).toBeNull()
    }).pipe(Effect.provide(TestHttpClientLive)))
})
