import { Effect, Logger, References, Schema as S } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { FeedbackPayload, FeedbackRejected } from "../../api/feedback"
import { acceptFeedback, recordFeedback } from "./feedback"

/**
 * What one submission logs, as the OtlpLogger turns it into OTLP attributes.
 * The record's body is the message; the annotations carry the fields and the
 * `feedback` marker. The annotations are read when the record is logged, as
 * the OTLP logger does, because the fiber's context does not outlive the run.
 */
const annotationsOf = <E>(effect: Effect.Effect<void, E>) =>
  Effect.gen(function* () {
    const records: Array<{ readonly message: ReadonlyArray<unknown>; readonly annotations: Record<string, unknown> }> = []
    const capture = Logger.make((options) => {
      records.push({
        message: options.message as ReadonlyArray<unknown>,
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      })
    })
    yield* effect.pipe(Effect.provide(Logger.layer([capture])))
    return records
  })

const validPayload = {
  message: "The setlist drag dropped the wrong song",
  category: "bug" as const,
  contact: "me@example.com",
  page_url: "https://giglist.example/band/1/setlists/2",
  app_version: "0.1.0",
  website: "",
}

describe("acceptFeedback", () => {
  it.effect("records one feedback log with the fields as attributes", () =>
    Effect.gen(function* () {
      const records = yield* annotationsOf(acceptFeedback(validPayload, "user-1").pipe(Effect.asVoid))

      expect(records).toHaveLength(1)
      expect(records[0].annotations).toEqual({
        feedback: true,
        category: "bug",
        contact: "me@example.com",
        page_url: validPayload.page_url,
        app_version: "0.1.0",
        user_id: "user-1",
      })
      expect(records[0].message).toEqual([validPayload.message])
    }))

  it.effect("omits the optional fields when the writer sent none", () =>
    Effect.gen(function* () {
      const records = yield* annotationsOf(
        acceptFeedback({ ...validPayload, contact: undefined }, undefined).pipe(Effect.asVoid),
      )

      expect(records[0].annotations).toEqual({
        feedback: true,
        category: "bug",
        page_url: validPayload.page_url,
        app_version: "0.1.0",
      })
    }))

  it.effect("refuses a honeypot-filled submission without a record", () =>
    Effect.gen(function* () {
      const records = yield* annotationsOf(
        acceptFeedback({ ...validPayload, website: "http://spam.example" }, "user-1").pipe(Effect.catch(() => Effect.void)),
      )

      expect(records).toHaveLength(0)
    }))

  it.effect("a honeypot-filled submission fails with FeedbackRejected", () =>
    Effect.gen(function* () {
      const failure = yield* acceptFeedback({ ...validPayload, website: "spam" }, undefined).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(FeedbackRejected)
    }))

  it.effect("a whitespace honeypot is still a refusal", () =>
    Effect.gen(function* () {
      const failure = yield* acceptFeedback({ ...validPayload, website: "  " }, undefined).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(FeedbackRejected)
    }))
})

describe("recordFeedback", () => {
  it.effect("logs exactly one record per submission", () =>
    Effect.gen(function* () {
      const records = yield* annotationsOf(
        Effect.all(
          [
            recordFeedback({ message: "one", category: "idea", contact: undefined, page_url: "/", app_version: "0.1.0", userId: undefined }),
            recordFeedback({ message: "two", category: "other", contact: undefined, page_url: "/", app_version: "0.1.0", userId: undefined }),
          ],
          { discard: true },
        ),
      )

      expect(records.map((record) => record.message)).toEqual([["one"], ["two"]])    }))
})

describe("FeedbackPayload", () => {
  const valid = (payload: unknown) => S.is(FeedbackPayload)(payload)

  it("accepts a submission with no contact", () => {
    const { contact: _contact, ...withoutContact } = validPayload
    expect(valid(withoutContact)).toBe(true)
  })

  it("refuses an empty message", () => {
    expect(valid({ ...validPayload, message: "" })).toBe(false)
  })

  it("refuses an unknown category", () => {
    expect(valid({ ...validPayload, category: "complaint" })).toBe(false)
  })

  it("refuses a message over 4000 characters", () => {
    expect(valid({ ...validPayload, message: "x".repeat(4001) })).toBe(false)
  })

  it("refuses a contact over 200 characters", () => {
    expect(valid({ ...validPayload, contact: "x".repeat(201) })).toBe(false)
  })
})
