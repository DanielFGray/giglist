import { Config } from "effect"
import { BunRedis } from "@effect/platform-bun"

/**
 * The connection to the shared Valkey instance, as Effect's `Redis` service
 * (`send`, `subscribe`, `eval`; each returns an Effect that fails with
 * `RedisError`) and `BunRedis` (the raw client).
 *
 * Valkey speaks the Redis protocol, so Bun's built-in client works unchanged.
 * Other apps use the same instance: every consumer must pass its own key prefix
 * (for example `giglist:rl:`) so keys never collide. The client closes when the
 * layer's scope ends.
 */
export const ValkeyLive = BunRedis.layerConfig({
  url: Config.String("VALKEY_URL"),
})
