import { ConfigProvider, Context, Effect, Layer, Logger, References, Schema as S } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { FetchHttpClient, HttpClient, HttpRouter, HttpServer } from "effect/http"
import { HttpApiLive } from "../runtime"
import { RateLimiterMemory } from "../services/rateLimiter"
import { anonymous, postJson, signedIn } from "../test/clients"

const FeedbackLogAttributes = S.Struct({ feedback: S.Literals([true]), user_id: S.String })
const feedbackUserIds: Array<string> = []
const feedbackLogger = Logger.make((options) => {
  const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
  if (S.is(FeedbackLogAttributes)(annotations)) feedbackUserIds.push(annotations.user_id)
})

/**
 * The api suite runs with RATE_LIMIT=off (its setup sets it), but this group
 * must prove the limit trips, so it builds its own handler with the override
 * on. It is the only file in the project with one: the shared harness in
 * src/server/test/apiHarness.ts keeps the suite-wide off.
 */
const onLimitWeb = HttpRouter.toWebHandler(
  HttpApiLive.pipe(
    Layer.provide(Logger.layer([feedbackLogger])),
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
 * Signed-out callers share an IP key in this in-process harness. The limit
 * case uses a fresh signed-in user, whose bucket is independent of other cases.
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
      feedbackUserIds.length = 0
      const response = yield* submit(client, { ...submission, contact: undefined })
      expect(response.status).toBe(200)
      expect(feedbackUserIds).toHaveLength(1)
      expect(feedbackUserIds[0]).toBeTruthy()
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

  it.effect("ten submissions pass and the eleventh in an hour is answered 429", () =>
    Effect.gen(function* () {
      const client = yield* signedIn(`feedback_limit_${runId}`)
      const accepted = yield* Effect.all(
        Array.from({ length: 10 }, () => submit(client, submission).pipe(Effect.map((response) => response.status))),
      )
      expect(accepted).toEqual(Array.from({ length: 10 }, () => 200))
      const over = yield* submit(client, submission)
      expect(over.status).toBe(429)
      expect(yield* over.json).toMatchObject({ _tag: "TooManyRequests" })
    }).pipe(Effect.provide(TestHttpClientOnLimit)))
})
