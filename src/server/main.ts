// @entrypoint: the server process, which launches the layer that serves the API and runs the worker.
import { Config, Effect, Layer } from "effect";
import { BunRedis, BunRuntime } from "@effect/platform-bun";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { ServerLive } from "./runtime";
import { storeTimeout } from "./services/rateLimiter";

/**
 * The Valkey client. By default Bun's client stops after a few reconnect
 * attempts and stays closed when Valkey returns, and it holds commands while
 * it reconnects. With these options it keeps reconnecting, and a command fails
 * at once while it is not connected, so each rate-limit rule applies its
 * policy for a store that is down.
 *
 * Bun's client opens its first connection only when asked, so a new process
 * would fail its first commands while that connection opens. The connection is
 * therefore started here, and the boot waits for it at most `storeTimeout`.
 * While Valkey is down the server still starts, and the client goes on
 * connecting.
 */
const ValkeyLive = Layer.effectDiscard(
  BunRedis.BunRedis.use((redis) => redis.use((client) => client.connect())).pipe(
    Effect.timeout(storeTimeout),
    Effect.catch((error) => Effect.logWarning("Valkey is not reachable yet; the client keeps connecting", error)),
  ),
).pipe(
  Layer.provideMerge(BunRedis.layerConfig({
    url: Config.String("VALKEY_URL"),
    maxRetries: Config.succeed(1_000_000),
    enableOfflineQueue: Config.succeed(false),
  })),
);

const MainLive = ServerLive.pipe(
  Layer.provide(ValkeyLive),
  Layer.provide(Layer.unwrap(Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    const hostname = yield* Config.NonEmptyString("API_HOST").pipe(Config.withDefault("127.0.0.1"));
    return BunHttpServer.layer({ port, hostname });
  }))),
);

BunRuntime.runMain(Layer.launch(MainLive));
