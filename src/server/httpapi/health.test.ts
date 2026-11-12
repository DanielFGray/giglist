import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { healthResponse } from "./health"

describe("health response", () => {
  it.effect("returns the commit when the database answers", () =>
    Effect.gen(function* () {
      const response = yield* healthResponse(Effect.void, true, "test-commit")

      expect(response.status).toBe(200)
      expect(response.body._tag === "Uint8Array" ? JSON.parse(response.body.text ?? "") : null).toEqual({ status: "ok", commit: "test-commit" })
    }))

  it.effect("returns a database failure when the database check fails", () =>
    Effect.gen(function* () {
      const response = yield* healthResponse(Effect.fail("database unavailable"), true, "test-commit")

      expect(response.status).toBe(503)
      expect(response.body._tag === "Uint8Array" ? JSON.parse(response.body.text ?? "") : null).toEqual({ status: "error", commit: "test-commit", failed: ["database"] })
    }))

  it.effect("reports a stopped worker", () =>
    Effect.gen(function* () {
      const response = yield* healthResponse(Effect.void, false, "test-commit")

      expect(response.status).toBe(503)
      expect(response.body._tag === "Uint8Array" ? JSON.parse(response.body.text ?? "") : null).toEqual({ status: "error", commit: "test-commit", failed: ["worker"] })
    }))
})
