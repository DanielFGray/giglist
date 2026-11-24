import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { FeedbackRejected, type FeedbackSubmission } from "../../api/feedback"
import { GigListApi } from "../../api/contracts"
import { CurrentSession } from "../../api/session"

/** A submission that passed the honeypot, with the user attached by the server. */
export interface AcceptedFeedback {
  readonly message: string
  readonly category: FeedbackSubmission["category"]
  readonly contact: string | undefined
  readonly page_url: string
  readonly app_version: string
  readonly userId: string | undefined
}

/**
 * The OTLP log record of one accepted submission: the log body is the message,
 * and the feedback record's fields are log annotations, so every app that
 * logs feedback with these field names can share one OpenObserve stream
 * filtered by the `feedback` marker.
 */
export const recordFeedback = (feedback: AcceptedFeedback) =>
  Effect.log(feedback.message).pipe(
    Effect.annotateLogs({
      feedback: true,
      category: feedback.category,
      ...(feedback.contact === undefined ? {} : { contact: feedback.contact }),
      page_url: feedback.page_url,
      app_version: feedback.app_version,
      ...(feedback.userId === undefined ? {} : { user_id: feedback.userId }),
    }),
  )

/**
 * Accepts one submission: a filled honeypot is refused without a record, and
 * anything else logs exactly one feedback record and succeeds.
 */
export const acceptFeedback = (payload: FeedbackSubmission, userId: string | undefined) =>
  Effect.gen(function* () {
    if (payload.website !== "") {
      return yield* new FeedbackRejected({ message: "Your submission was refused." })
    }
    yield* recordFeedback({
      message: payload.message,
      category: payload.category,
      contact: payload.contact,
      page_url: payload.page_url,
      app_version: payload.app_version,
      userId,
    })
    return { ok: true as const }
  })

export const FeedbackApiGroupLive = HttpApiBuilder.group(GigListApi, "feedback", (handlers) =>
  handlers.handle("submitFeedback", ({ payload }) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession
      return yield* acceptFeedback(payload, session.userId ?? undefined)
    }),
  ),
)
