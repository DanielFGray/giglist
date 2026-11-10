import { Config, Context, Effect, Layer } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { HttpRouter } from "effect/http";
import { AppLayer, HttpApiLive } from "./runtime";
import { TelemetryLive } from "./telemetry";
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
