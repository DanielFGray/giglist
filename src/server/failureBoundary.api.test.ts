import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Layer, Logger, References, Schema as S } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { ChartConflict } from "../api/charts"
import { FailureBoundary } from "../api/failure-boundary"
import { FailureBoundaryLive } from "./failureBoundary"

/** One endpoint that dies, one that fails with a declared error, and one that decodes a payload. */
const ProbeApi = HttpApi.make("probe")
  .add(
    HttpApiGroup.make("probe")
      .add(HttpApiEndpoint.get("defect", "/defect", { success: S.Void }))
      .add(HttpApiEndpoint.get("taken", "/taken", { success: S.Void, error: ChartConflict }))
      .add(
        HttpApiEndpoint.post("signUp", "/sign-up", {
          payload: S.Struct({ name: S.String.check(S.isMinLength(3)) }),
          success: S.Void,
        }),
      ),
  )
  .middleware(FailureBoundary)

const ProbeHandlers = HttpApiBuilder.group(ProbeApi, "probe", (handlers) =>
  handlers
    .handle("defect", () => Effect.die(new Error('relation "secret_table" does not exist')))
    .handle("taken", () =>
      Effect.fail(new ChartConflict({ message: "The chart changed since you opened it" })),
    )
    .handle("signUp", () => Effect.void),
)

const served = HttpApiBuilder.layer(ProbeApi).pipe(
  Layer.provide(ProbeHandlers),
  Layer.provide(FailureBoundaryLive),
  Layer.provide(HttpServer.layerServices),
)

/** One line the probe logged. `traceId` is the log annotation the boundary sets. */
type LogLine = {
  readonly level: string
  readonly message: unknown
  readonly cause: string
  readonly traceId: unknown
}

/**
 * Answers the probe API for one request, and returns the response with every
 * line logged while it was answered. The HTTP logger is on, as in `serve`, so
 * the response line is among them.
 */
const probe = (method: "GET" | "POST", path: string, body?: unknown) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const lines: Array<LogLine> = []
      const recordLines = Logger.layer([
        Logger.make((options) => {
          lines.push({
            level: options.logLevel,
            message: options.message,
            cause: Cause.pretty(options.cause),
            traceId: options.fiber.getRef(References.CurrentLogAnnotations).traceId,
          })
        }),
      ])
      const web = HttpRouter.toWebHandler(served.pipe(Layer.provideMerge(recordLines)))
      return { web, lines }
    }),
    ({ web, lines }) =>
      Effect.promise(async () => {
        const init: RequestInit = body === undefined
          ? { method }
          : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        const response = await web.handler(new Request(`http://localhost${path}`, init))
        return { status: response.status, body: await response.text(), lines }
      }),
    ({ web }) => Effect.promise(() => web.dispose()),
  )

describe("FailureBoundary", () => {
  it.effect("answers a defect with a 500 that carries the trace id of its logged cause", () =>
    Effect.gen(function* () {
      const { status, body, lines } = yield* probe("GET", "/defect")
      expect(lines).toHaveLength(2)
      expect(lines[1]?.message).toEqual(["Sent HTTP response"])
      const [line] = lines
      expect(line?.message).toEqual(["Unexpected failure"])
      expect(line?.cause).toContain('relation "secret_table" does not exist')
      expect(line?.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(status).toBe(500)
      expect(JSON.parse(body)).toEqual({
        _tag: "InternalError",
        message: "Something went wrong on our side.",
        traceId: line?.traceId,
      })
    }),
  )

  it.effect("passes a declared error through unlogged", () =>
    Effect.gen(function* () {
      const { status, body, lines } = yield* probe("GET", "/taken")
      expect(status).toBe(409)
      expect(JSON.parse(body)).toEqual({
        _tag: "ChartConflict",
        message: "The chart changed since you opened it",
      })
      expect(lines.map(({ message }) => message)).toEqual([["Sent HTTP response"]])
    }),
  )

  it.effect("answers a payload its schema rejects with 400 invalid_input naming each value", () =>
    Effect.gen(function* () {
      const { status, body, lines } = yield* probe("POST", "/sign-up", {})
      expect(status).toBe(400)
      const decoded = JSON.parse(body)
      expect(decoded).toEqual({
        _tag: "InvalidOperation",
        message: "Some values are not valid.",
        reason: "invalid_input",
        issues: [{ path: ["payload", "name"], message: expect.any(String) }],
      })
      expect(lines.map(({ message }) => message)).toEqual([["Sent HTTP response"]])
    }),
  )
})
