import { Config, Context, Effect, Layer } from "effect";
import { BunRedis, BunRuntime } from "@effect/platform-bun";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { HttpRouter } from "effect/http";
import { AppLayer, HttpApiLive } from "./runtime";
import { TelemetryLive } from "./telemetry";
import { RateLimiterValkey } from "./services/rate-limiter";
import { Worker } from "../../worker/main";

const ServerLive = HttpRouter.serve(HttpApiLive).pipe(
  Layer.provide(AppLayer),
  Layer.provide(Layer.unwrap(Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    const hostname = yield* Config.NonEmptyString("API_HOST").pipe(Config.withDefault("127.0.0.1"));
    return BunHttpServer.layer({ port, hostname });
  }))),
  // Last, and merged rather than provided: telemetry services are references
  // with defaults, so they are not requirements of the server layer. Merging
  // keeps the exporters in every handler's context.
  Layer.provideMerge(TelemetryLive),
  Layer.provideMerge(Worker.layer),
  // One limiter for the API middleware and the worker's mail cap.
  Layer.provide(RateLimiterValkey),
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
);

// Bind the HTTP server first, then start the worker in the same scope. Scope
// finalizers stop the worker before the server's database pools close.
Effect.scoped(Effect.gen(function* () {
  const context = yield* Layer.build(ServerLive)
  const worker = Context.get(context, Worker)
  yield* worker.start.pipe(
    Effect.tapError((error) => Effect.logError("Could not start the worker", error)),
    Effect.ignore,
  )
  return yield* Effect.never
})).pipe(
  BunRuntime.runMain,
);
