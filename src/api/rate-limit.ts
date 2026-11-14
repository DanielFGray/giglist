import { Schema as S } from "effect"
import { HttpApiMiddleware } from "effect/http-api"

// --- Rate limiting ---

export class TooManyRequests extends S.TaggedError<TooManyRequests, { readonly brand: unique symbol }>()(
  "TooManyRequests",
  { message: S.String, retryAfterSeconds: S.Int },
  { httpApiStatus: 429 },
) {}

/**
 * Limits how often one caller may use an endpoint. The limit comes from the
 * server's rule for the endpoint's name (`httpapi/rateLimit.ts`); an endpoint
 * with no rule passes through. Add this BEFORE `SessionMiddleware` on an
 * endpoint: a later middleware wraps the earlier ones, so the limiter then runs
 * inside the session and can key a rule on the signed-in user.
 */
export class RateLimitMiddleware extends HttpApiMiddleware.Service<RateLimitMiddleware>()(
  "giglist/RateLimitMiddleware",
  { error: TooManyRequests },
) {}
