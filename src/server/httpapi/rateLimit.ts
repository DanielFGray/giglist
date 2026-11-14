import { Config, Duration, Effect, Layer, Match, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { RateLimiter } from "effect/persistence/RateLimiter"
import type { RateLimiterError } from "effect/persistence/RateLimiter"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { GigListApi } from "../../api/contracts"
import { RateLimitMiddleware, TooManyRequests } from "../../api/rate-limit"
import { CurrentSession } from "../../api/session"
import { storeTimeout } from "../services/rateLimiter"
import { networkOf } from "./clientIp"

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

/**
 * One rule for each endpoint that declares `RateLimitMiddleware`, and none for
 * any other name, so the compiler refuses a renamed or unlimited endpoint
 * instead of letting its requests through unlimited.
 */
const limits = {
  login: { by: "ip", limit: 10, window: "5 minutes", whenStoreDown: "allow" },
  register: { by: "ip", limit: 5, window: "1 hour", whenStoreDown: "deny" },
  joinByInvitation: { by: "ip", limit: 5, window: "1 hour", whenStoreDown: "deny" },
  invitationPreview: { by: "ip", limit: 30, window: "1 hour", whenStoreDown: "allow" },
  forgotPassword: { by: "ip", limit: 5, window: "1 hour", whenStoreDown: "deny" },
  resetPassword: { by: "ip", limit: 10, window: "1 hour", whenStoreDown: "allow" },
  verifyEmail: { by: "ip", limit: 20, window: "1 hour", whenStoreDown: "allow" },
  changePassword: { by: "user", limit: 10, window: "1 hour", whenStoreDown: "allow" },
  addEmail: { by: "user", limit: 5, window: "1 day", whenStoreDown: "deny" },
  resendEmailVerification: { by: "user", limit: 5, window: "1 day", whenStoreDown: "deny" },
  requestAccountDeletion: { by: "user", limit: 3, window: "1 day", whenStoreDown: "deny" },
  inviteToBand: { by: "user", limit: 20, window: "1 day", whenStoreDown: "deny" },
} satisfies { readonly [Name in LimitedEndpoint]: Rule }

/** The same rules, looked up by the name of the endpoint a request reached. */
const rules: Readonly<Record<string, Rule>> = limits

type ApiEndpoint = HttpApiGroup.Endpoints<typeof GigListApi extends HttpApi.HttpApi<string, infer Groups> ? Groups : never>

type LimitedEndpoint = ApiEndpoint extends infer Endpoint
  ? Endpoint extends { readonly identifier: infer Name extends string }
    ? RateLimitMiddleware extends HttpApiEndpoint.Middleware<Endpoint> ? Name : never
    : never
  : never

/**
 * Applies the rule for each endpoint that declares `RateLimitMiddleware`.
 * `RATE_LIMIT=off` passes every request, for the Playwright suite, whose
 * specs register more users per hour than a person would. The entry point
 * provides the `RateLimiter`: Valkey in the server, memory in the API tests.
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
)

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
 * The edge proxy (Traefik in production, docs/deploy.md) sets `X-Real-IP` to the
 * address it saw and replaces any value the client sent. Anyone who reaches the
 * API without passing the proxy can forge it, so the API port must be reachable
 * only from the proxy.
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
