import { Config, Effect, Layer } from "effect";
import { BunRedis, BunRuntime } from "@effect/platform-bun";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { ServerLive } from "./runtime";

const MainLive = ServerLive.pipe(
  // Bun's client connects on first use, so the server starts while Valkey is down.
  // By default the client stops after a few reconnect attempts and stays closed
  // when Valkey returns, and it holds commands while it reconnects. With these
  // options it keeps reconnecting, and a command fails at once while Valkey is
  // down, so each rate-limit rule applies its policy for a store that is down.
  Layer.provide(BunRedis.layerConfig({
    url: Config.String("VALKEY_URL"),
    maxRetries: Config.succeed(1_000_000),
    enableOfflineQueue: Config.succeed(false),
  })),
  Layer.provide(Layer.unwrap(Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    const hostname = yield* Config.NonEmptyString("API_HOST").pipe(Config.withDefault("127.0.0.1"));
    return BunHttpServer.layer({ port, hostname });
  }))),
);

BunRuntime.runMain(Layer.launch(MainLive));
