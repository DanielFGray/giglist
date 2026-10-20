import { Config, Effect, Layer } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { AuthDb, AuthVisitor, Db } from "./db";
import { GigListApi } from "../api/contracts";

// Group handlers
import { authHandlers } from "./httpapi/auth";
import { bandsHandlers } from "./httpapi/bands";
import { publicBandsHandlers } from "./httpapi/public-bands";
import { publicUsersHandlers } from "./httpapi/public-users";
import { songsHandlers } from "./httpapi/songs";
import { setlistsHandlers } from "./httpapi/setlists";
import { gigsHandlers } from "./httpapi/gigs";
import { chartsHandlers } from "./httpapi/charts";
import { scoresHandlers } from "./httpapi/scores";
import { marksHandlers, stampsHandlers } from "./httpapi/marks";
import { LiveHub } from "./services/live-hub";
import { ChartReader } from "./services/chart-reader";
import { SessionMiddlewareLive } from "./httpapi/session";
import { RateLimitMiddlewareLive } from "./httpapi/rate-limit";
import { HealthLive } from "./httpapi/health";
import { TracingLive } from "./tracing";

const ApiLive = HttpApiBuilder.layer(GigListApi).pipe(
  Layer.provide(Layer.mergeAll(authHandlers, bandsHandlers, publicBandsHandlers, publicUsersHandlers, songsHandlers, setlistsHandlers, gigsHandlers, chartsHandlers, scoresHandlers, marksHandlers, stampsHandlers)),
  Layer.provide(SessionMiddlewareLive),
  Layer.provide(RateLimitMiddlewareLive),
);

// Adapted from postgres.garden's conditional testing import. Production never
// loads the module that can create users and expose account secrets.
const TestingLive = Layer.unwrap(Effect.gen(function* () {
  const mode = yield* Config.Literals(["development", "test", "production"], "NODE_ENV").pipe(Config.withDefault("development"));
  if (mode === "production") return Layer.empty;
  const { testingRoutes } = yield* Effect.promise(() => import("./httpapi/testing"));
  return testingRoutes;
}));

// HTTP server layer
const ServerLive = HttpRouter.serve(Layer.mergeAll(ApiLive, TestingLive, HealthLive)).pipe(
  // User traffic runs on the authenticator connection as the visitor role,
  // which is what makes the RLS policies apply at all. The owner pool is
  // reachable only through the services that need app_private.
  Layer.provide(AuthDb.Live),
  Layer.provide(AuthVisitor.Live),
  Layer.provide(Db.Live),
  // One hub per process: viewers and change events are shared by every request.
  Layer.provide(LiveHub.Live),
  Layer.provide(ChartReader.Live),
  Layer.provide(Layer.unwrap(Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    const hostname = yield* Config.NonEmptyString("API_HOST").pipe(Config.withDefault("127.0.0.1"));
    return BunHttpServer.layer({ port, hostname });
  }))),
  // Last, and merged rather than provided: `Tracer.Tracer` is a reference with
  // a default, so it is never a requirement of the server layer and `provide`
  // has nothing to satisfy. Merging keeps it in every handler's context.
  Layer.provideMerge(TracingLive),
);

// Launch
Layer.launch(ServerLive).pipe(
  BunRuntime.runMain,
);
