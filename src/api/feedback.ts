import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { RateLimitMiddleware } from "./rate-limit"
import { SessionMiddleware } from "./session"

// --- Feedback ---

export const FeedbackCategory = S.Literals(["bug", "idea", "other"])

export type FeedbackCategory = S.Schema.Type<typeof FeedbackCategory>

/**
 * One submission. `message`, `category` and `contact` are what the writer
 * typed; `page_url` and `app_version` are attached by the browser, and the
 * server adds the signed-in user. `website` is the honeypot: the form hides
 * it (OWASP's bot-trap practice, see ATTRIBUTIONS.md), and a bot that fills
 * it is rejected without its feedback being recorded.
 */
export const FeedbackPayload = S.Struct({
  message: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(4000))),
  category: FeedbackCategory,
  contact: S.optionalKey(S.String.pipe(S.check(S.isMaxLength(200)))),
  page_url: S.String.pipe(S.check(S.isMaxLength(2000))),
  app_version: S.String.pipe(S.check(S.isMaxLength(100))),
  website: S.String.pipe(S.check(S.isMaxLength(500))),
})

export type FeedbackSubmission = S.Schema.Type<typeof FeedbackPayload>

/** Strip URL credentials, query, and fragment before storing the page location. */
export const safeFeedbackPageUrl = (pageUrl: string): string =>
  pageUrl
    .replace(/^(https?:\/\/)[^/@]*@/i, "$1")
    .split(/[?#]/, 1)[0]

export const FeedbackSuccess = S.Struct({ ok: S.Literals([true]) })

export class FeedbackRejected extends S.TaggedError<FeedbackRejected, { readonly brand: unique symbol }>()(
  "FeedbackRejected",
  { message: S.String },
  { httpApiStatus: 400 },
) {}

export const submitFeedbackEndpoint = HttpApiEndpoint.post("submitFeedback", "/", {
  payload: FeedbackPayload,
  success: FeedbackSuccess,
  error: FeedbackRejected,
})
  .middleware(RateLimitMiddleware)
  .middleware(SessionMiddleware)

export const FeedbackApiGroup = HttpApiGroup.make("feedback")
  .add(submitFeedbackEndpoint)
  .prefix("/api/feedback")
