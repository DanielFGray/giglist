import { Layer } from "effect"
import { layer as rateLimiterLayer, layerStoreRedis } from "effect/persistence/RateLimiter"
import { ValkeyLive } from "./valkey"

/**
 * The `RateLimiter` both the API and the worker count against, so a limit
 * holds across processes. Its keys live under the `giglist:rl:` prefix of the
 * shared Valkey instance.
 */
export const RateLimiterLive = rateLimiterLayer.pipe(
  Layer.provide(layerStoreRedis({ prefix: "giglist:rl:" })),
  Layer.provide(ValkeyLive),
)

/**
 * Bun queues commands while it retries a lost connection, so without a
 * deadline a Valkey outage would stall each caller instead of letting it apply
 * its own policy for a store that is down.
 */
export const storeTimeout = "1 second"
