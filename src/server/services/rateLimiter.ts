import { Config, Duration, Layer } from "effect"
import {
  make,
  RateLimiter,
  type RateLimiterStore,
  layerStoreMemory,
  layerStoreRedisConfig,
} from "effect/persistence/RateLimiter"

/**
 * The `RateLimiter` that the API middleware and the email worker count
 * against. Counts live in Valkey, so a limit holds across processes and
 * restarts.
 *
 * It requires Effect's `Redis` service (`effect/persistence/Redis`), which is
 * the Valkey client: each entry point provides it from `VALKEY_URL` with
 * `BunRedis`. Valkey speaks the Redis protocol, so the client works unchanged.
 *
 * Keys start with `VALKEY_KEY_PREFIX` and then `rl:`. The platform sets the
 * prefix to `<cartridge name>:`, the only keys the app's Valkey user may touch.
 */
export const RateLimiterValkey = rateLimiterWithStore(
  layerStoreRedisConfig({
    prefix: Config.String("VALKEY_KEY_PREFIX").pipe(
      Config.map((prefix) => `${prefix}rl:`),
    ),
  }),
)

/** Counts in process memory, for tests that must run without a Valkey. */
export const RateLimiterMemory = rateLimiterWithStore(layerStoreMemory)

/**
 * The longest a caller waits for the store. The Valkey client queues commands
 * while it reconnects, so without a deadline an outage would stall each caller
 * instead of letting it apply its own policy for a store that is down.
 */
export const storeTimeout = Duration.seconds(1)

/**
 * A `RateLimiter` over `store`. Each call makes a new Layer: a build memoizes
 * layers by reference, so two limiters made from Effect's one shared `layer`
 * would both get the store of whichever was built first.
 */
export function rateLimiterWithStore<E, R>(store: Layer.Layer<RateLimiterStore, E, R>) {
  return Layer.effect(RateLimiter, make).pipe(Layer.provide(store))
}
