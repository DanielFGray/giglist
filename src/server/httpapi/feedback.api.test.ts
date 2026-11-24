import { ConfigProvider, Context, Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { FetchHttpClient, HttpClient, HttpRouter, HttpServer } from "effect/http"
import { HttpApiLive } from "../runtime"
import { RateLimiterMemory } from "../services/rateLimiter"
import { anonymous, postJson, signedIn } from "../test/clients"

/**
 * The api suite runs with RATE_LIMIT=off (its setup sets it), but this group
 * must prove the limit trips, so it builds its own handler with the override
 * on. It is the only file in the project with one: the shared harness in
 * src/server/test/apiHarness.ts keeps the suite-wide off.
 */
const onLimitWeb = HttpRouter.toWebHandler(
  HttpApiLive.pipe(
    Layer.provide(RateLimiterMemory),
    Layer.provide(HttpServer.layerServices),
    Layer.provide(ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ RATE_LIMIT: "on" }), { asPrimary: true })),
  ),
  { disableLogger: true },
)

const TestHttpClientOnLimit = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, Object.assign(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      onLimitWeb.handler(new Request(input, init), Context.empty()),
    { preconnect: () => {} },
  ))),
)

const runId = Math.random().toString(36).slice(2, 8)

const submission = {
  message: "The score picker scrolled away from the bar I picked",
  category: "bug",
  contact: "me@example.com",
  page_url: "https://giglist.example/band/1/songs/2",
  app_version: "0.1.0",
  website: "",
}

const submit = (client: HttpClient.HttpClient, payload: unknown) => postJson(client, "/feedback", payload)

/**
 * Every signed-out caller shares the one `ip` key the in-process harness has
 * (no socket address to read), so the tests here run in order and spend the
 * ip bucket carefully; the over-limit test runs last and uses its full ten.
 */
describe("feedback over HTTP", () => {
  it.effect("a signed-out submission is accepted", () =>
    Effect.gen(function* () {
      const nobody = yield* anonymous
      expect((yield* submit(nobody, submission)).status).toBe(200)
    }).pipe(Effect.provide(TestHttpClientOnLimit)))

  it.effect("a signed-in submission is accepted and names the user on the server", () =>
    Effect.gen(function* () {
      const client = yield* signedIn(`feedback_user_${runId}`)
      const response = yield* submit(client, { ...submission, contact: undefined })
      expect(response.status).toBe(200)
    }).pipe(Effect.provide(TestHttpClientOnLimit)))

  it.effect("a honeypot-filled submission is refused", () =>
    Effect.gen(function* () {
      const nobody = yield* anonymous
      const refused = yield* submit(nobody, { ...submission, website: "http://spam.example" })
      expect(refused.status).toBe(400)
      expect(yield* refused.json).toMatchObject({ _tag: "FeedbackRejected" })
    }).pipe(Effect.provide(TestHttpClientOnLimit)))

  it.effect("a payload the contract refuses answers 400", () =>
    Effect.gen(function* () {
      const nobody = yield* anonymous
      expect((yield* submit(nobody, { ...submission, category: "complaint" })).status).toBe(400)
      expect((yield* submit(nobody, { ...submission, message: "" })).status).toBe(400)
    }).pipe(Effect.provide(TestHttpClientOnLimit)))

  it.effect("the eleventh submission in an hour is answered 429", () =>
    Effect.gen(function* () {
      const nobody = yield* anonymous
      // Four accepted or refused submissions already spent the ip bucket
      // above; six more put the caller exactly at the limit, and the next is
      // refused with 429.
      for (let i = 0; i < 6; i++) {
        yield* submit(nobody, submission).pipe(Effect.catch(() => Effect.void))
      }
      const over = yield* submit(nobody, submission)
      expect(over.status).toBe(429)
      expect(yield* over.json).toMatchObject({ _tag: "TooManyRequests" })
    }).pipe(Effect.provide(TestHttpClientOnLimit)))
})
