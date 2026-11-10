import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { healthResponse } from "./health"

describe("health response", () => {
  test("returns the commit when the database answers", async () => {
    const response = await Effect.runPromise(healthResponse(Effect.void, "test-commit"))

    expect(response.status).toBe(200)
    expect(response.body._tag === "Uint8Array" ? JSON.parse(response.body.text ?? "") : null).toEqual({ status: "ok", commit: "test-commit" })
  })

  test("returns a database failure when the database check fails", async () => {
    const response = await Effect.runPromise(healthResponse(Effect.fail("database unavailable"), "test-commit"))

    expect(response.status).toBe(503)
    expect(response.body._tag === "Uint8Array" ? JSON.parse(response.body.text ?? "") : null).toEqual({ status: "error", commit: "test-commit", failed: ["database"] })
  })
})
