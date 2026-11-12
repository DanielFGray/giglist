import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { AuthDb, AuthVisitor, Db } from "./db";
import { GigListApi } from "../api/contracts";
import { AuthApiGroupLive } from "./httpapi/auth";
import { BandsApiGroupLive } from "./httpapi/bands";
import { PublicBandsApiGroupLive } from "./httpapi/publicBands";
import { PublicUsersApiGroupLive } from "./httpapi/publicUsers";
import { SongsApiGroupLive } from "./httpapi/songs";
import { SetlistsApiGroupLive } from "./httpapi/setlists";
import { GigsApiGroupLive } from "./httpapi/gigs";
import { ChartsApiGroupLive } from "./httpapi/charts";
import { ScoresApiGroupLive } from "./httpapi/scores";
import { MarksApiGroupLive } from "./httpapi/marks";
import { StampsApiGroupLive } from "./httpapi/stamps";
import { LiveHub } from "./services/liveHub";
import { ChartReader } from "./services/chartReader";
import { Auth } from "./services/auth";
import { Bands } from "./services/bands";
import { PublicUsers } from "./services/publicUsers";
import { Songs } from "./services/songs";
import { Marks } from "./services/marks";
import { Charts } from "./services/charts";
import { Setlists } from "./services/setlists";
import { Gigs } from "./services/gigs";
import { SessionMiddlewareLive } from "./httpapi/session";
import { RateLimitMiddlewareLive } from "./httpapi/rateLimit";
import { FailureBoundaryLive } from "./failureBoundary";
import { HealthLive } from "./httpapi/health";
import { TelemetryLive } from "./telemetry";
import { nodeEnv } from "./config";
import { RateLimiterValkey } from "./services/rateLimiter";
import { Worker } from "../../worker/worker";

const ApiLive = HttpApiBuilder.layer(GigListApi).pipe(
  Layer.provide(Layer.mergeAll(AuthApiGroupLive, BandsApiGroupLive, PublicBandsApiGroupLive, PublicUsersApiGroupLive, SongsApiGroupLive, SetlistsApiGroupLive, GigsApiGroupLive, ChartsApiGroupLive, ScoresApiGroupLive, MarksApiGroupLive, StampsApiGroupLive)),
  Layer.provide(SessionMiddlewareLive),
  Layer.provide(RateLimitMiddlewareLive),
  Layer.provide(FailureBoundaryLive),
);

// Adapted from postgres.garden's conditional testing import. Production never
// loads the module that can create users and expose account secrets.
const TestingLive = Layer.unwrap(Effect.gen(function* () {
  const mode = yield* nodeEnv;
  if (mode === "production") return Layer.empty;
  const { TestingHttpApiLive } = yield* Effect.promise(() => import("./httpapi/testing"));
  return TestingHttpApiLive;
}));

/**
 * The services the handlers use, and the database pools they share. Each
 * service layer provides the services its own `make` needs, so this list stays
 * flat; layers are memoized by reference, so a service that several layers
 * provide (LiveHub, Bands, Auth) is still one instance per process.
 *
 * User traffic runs on the authenticator connection as the visitor role, which
 * is what makes the RLS policies apply at all. The owner pool is reachable only
 * through the services that need app_private.
 */
export const AppLayer = Layer.mergeAll(
  AuthDb.layer,
  AuthVisitor.layer,
  Db.layer,
  LiveHub.layer,
  ChartReader.layer,
  Auth.layer,
  Bands.layer,
  PublicUsers.layer,
  Songs.layer,
  Marks.layer,
  Charts.layer,
  Setlists.layer,
  Gigs.layer,
);

/**
 * Every API route, with AppLayer, and no listener. The API tests call it
 * in-process (src/server/test/apiHarness.ts), so no test starts a worker.
 */
export const HttpApiLive = Layer.mergeAll(ApiLive, TestingLive).pipe(
  Layer.provideMerge(AppLayer),
);

/**
 * The server process: it serves the API and `/healthz`, and runs the
 * graphile-worker runner. Route handlers take their services per request, so
 * AppLayer is provided to the served layer as well; both uses share one
 * instance. The entry point provides the HTTP server and the Valkey client.
 */
export const ServerLive = HttpRouter.serve(
  // `/healthz` probes the database pools that HttpApiLive opens.
  HealthLive.pipe(Layer.provideMerge(HttpApiLive)),
).pipe(
  // Each layer is built before the ones above it and released after them, so
  // the runner stops after the server and before the pools, the exporters and
  // the limiter its jobs use.
  Layer.provide(Worker.layer),
  Layer.provide(AppLayer),
  // Merged rather than provided: telemetry services are references with
  // defaults, so they are not requirements of the server layer. Merging keeps
  // the exporters in every handler's context.
  Layer.provideMerge(TelemetryLive),
  // One limiter for the API middleware and the worker's mail cap.
  Layer.provide(RateLimiterValkey),
);
