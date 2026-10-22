import { Config, Duration, Effect, Layer, Match, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { RateLimiter } from "effect/persistence/RateLimiter"
import type { RateLimiterError } from "effect/persistence/RateLimiter"
import { CurrentSession, RateLimitMiddleware, TooManyRequests } from "../../api/contracts"
import { RateLimiterLive, storeTimeout } from "../services/rate-limiter"
import { networkOf } from "./client-ip"

/**
 * Per-caller limits on the endpoints that send email, check a secret or cost
 * a password hash. The key is the endpoint name plus the caller: the network
 * the request came from (`ip`), or the signed-in user (`user`; a request with
 * no session falls back to its network).
 *
 * An endpoint is limited only if its contract adds `RateLimitMiddleware`.
 */
interface Rule {
  readonly by: "ip" | "user"
  readonly limit: number
  readonly window: Duration.Input
  /**
   * What to do when Valkey cannot answer. Deny where the endpoint sends email
   * or lets a caller choose the recipient, since an open gate there is the
   * abuse. Allow on login, so a Valkey outage does not lock everyone out.
   */
  readonly whenStoreDown: "allow" | "deny"
}

const rules: Readonly<Record<string, Rule>> = {
  login: { by: "ip", limit: 10, window: "5 minutes", whenStoreDown: "allow" },
  register: { by: "ip", limit: 5, window: "1 hour", whenStoreDown: "deny" },
  forgotPassword: { by: "ip", limit: 5, window: "1 hour", whenStoreDown: "deny" },
  resetPassword: { by: "ip", limit: 10, window: "1 hour", whenStoreDown: "allow" },
  verifyEmail: { by: "ip", limit: 20, window: "1 hour", whenStoreDown: "allow" },
  changePassword: { by: "user", limit: 10, window: "1 hour", whenStoreDown: "allow" },
  addEmail: { by: "user", limit: 5, window: "1 day", whenStoreDown: "deny" },
  resendEmailVerification: { by: "user", limit: 5, window: "1 day", whenStoreDown: "deny" },
  requestAccountDeletion: { by: "user", limit: 3, window: "1 day", whenStoreDown: "deny" },
  inviteToBand: { by: "user", limit: 20, window: "1 day", whenStoreDown: "deny" },
}

/**
 * Applies the rule for each endpoint that declares `RateLimitMiddleware`.
 * `RATE_LIMIT=off` passes every request, for the Playwright suite, whose
 * specs register more users per hour than a person would.
 */
export const RateLimitMiddlewareLive = Layer.unwrap(
  Config.Literals(["on", "off"], "RATE_LIMIT").pipe(
    Config.withDefault("on"),
    Effect.map((mode) => mode === "off" ? passThrough : enforce),
  ),
)

const passThrough = Layer.succeed(RateLimitMiddleware, (effect) => effect)

const enforce = Layer.effect(
  RateLimitMiddleware,
  Effect.gen(function* () {
    const limiter = yield* RateLimiter

    return (effect, { endpoint }) =>
      Option.match(Option.fromNullishOr(rules[endpoint.identifier]), {
        onNone: () => effect,
        onSome: (rule) =>
          caller(rule).pipe(
            Effect.flatMap((who) =>
              limiter.consume({
                key: `${endpoint.identifier}:${who}`,
                limit: rule.limit,
                window: rule.window,
                onExceeded: "fail",
              }),
            ),
            Effect.timeout(storeTimeout),
            Effect.catchTags({
              RateLimiterError: (error) => deny(rule, error),
              TimeoutError: () => storeDown(rule, "timed out"),
            }),
            Effect.andThen(effect),
          ),
      })
  }),
).pipe(Layer.provide(RateLimiterLive))

const caller = Effect.fnUntraced(function* (rule: Rule) {
  if (rule.by === "user") {
    const userId = (yield* Effect.serviceOption(CurrentSession)).pipe(
      Option.flatMap((session) => Option.fromNullishOr(session.userId)),
    )
    if (Option.isSome(userId)) return `user:${userId.value}`
  }
  return `ip:${yield* network}`
})

/**
 * Caddy sets `X-Real-IP` to the address it saw (deploy/Caddyfile) and replaces
 * any value the client sent. The API listens on loopback, so only Caddy can
 * reach it; with `API_HOST` set to a public interface this header is forgeable.
 * Without the header (local development) the socket address stands in.
 */
const network = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  return Option.fromNullishOr(request.headers["x-real-ip"]).pipe(
    Option.orElse(() => request.remoteAddress),
    Option.map(networkOf),
    Option.getOrElse(() => "unknown"),
  )
})

const deny = (rule: Rule, error: RateLimiterError) =>
  Match.value(error.reason).pipe(
    Match.tag("RateLimitExceeded", (exceeded) =>
      Effect.fail(new TooManyRequests({
        message: "Too many requests. Try again later.",
        retryAfterSeconds: Math.max(1, Math.ceil(Duration.toSeconds(exceeded.retryAfter))),
      })),
    ),
    Match.tag("RateLimitStoreError", (failure) => storeDown(rule, failure.message)),
    Match.exhaustive,
  )

const storeDown = (rule: Rule, reason: string) =>
  Effect.logWarning("Rate limiter store unavailable", reason).pipe(
    Effect.andThen(rule.whenStoreDown === "allow"
      ? Effect.void
      : Effect.fail(new TooManyRequests({ message: "Try again in a minute.", retryAfterSeconds: 60 }))),
  )
