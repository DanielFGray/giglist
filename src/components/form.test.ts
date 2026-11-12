import { Schema as S } from "effect"
import { describe, expect, test } from "vitest"
import { InternalError } from "~/api/errors"
import { errorMessage } from "./form"

describe("errorMessage", () => {
  test("shows the message of an error", () => {
    expect(errorMessage(new Error("Song not found"))).toBe("Song not found")
  })

  test("shows a string as it is", () => {
    expect(errorMessage("Pick a key")).toBe("Pick a key")
  })

  test("adds the trace id to an InternalError", () => {
    const error = new InternalError({ message: "Something went wrong", traceId: "abc123" })
    expect(errorMessage(error)).toBe("Something went wrong (reference: abc123)")
  })

  test("adds the trace id to an InternalError decoded from a response body", () => {
    // The client decodes a 500 body with the contract's schema, so the helper
    // must recognise the decoded value, not only a value built with `new`.
    const decoded = S.decodeSync(InternalError)({
      _tag: "InternalError",
      message: "Something went wrong",
      traceId: "abc123",
    })
    expect(decoded).toBeInstanceOf(InternalError)
    expect(errorMessage(decoded)).toBe("Something went wrong (reference: abc123)")
  })

  test("reads a non-error value as text", () => {
    expect(errorMessage(42)).toBe("42")
    expect(errorMessage(null)).toBe("null")
  })
})
