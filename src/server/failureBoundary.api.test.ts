import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema as S } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { ChartConflict } from "../api/charts"
import { FailureBoundary } from "../api/failure-boundary"
import { FailureBoundaryLive } from "./failureBoundary"
import { answerRequest, collectLogs, type LogLine } from "./test/probe"

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

const probe = (method: "GET" | "POST", path: string, body?: unknown) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const lines: Array<LogLine> = []
      return { lines, web: HttpRouter.toWebHandler(served.pipe(Layer.provideMerge(collectLogs(lines)))) }
    }),
    ({ web, lines }) => answerRequest(web, lines, method, path, body),
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
