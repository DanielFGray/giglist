import { Config, Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { AuthDb, AuthVisitor, Db } from "./db";
import { GigListApi } from "../api/contracts";
import { AuthApiGroupLive } from "./httpapi/auth";
import { BandsApiGroupLive } from "./httpapi/bands";
import { PublicBandsApiGroupLive } from "./httpapi/public-bands";
import { PublicUsersApiGroupLive } from "./httpapi/public-users";
import { SongsApiGroupLive } from "./httpapi/songs";
import { SetlistsApiGroupLive } from "./httpapi/setlists";
import { GigsApiGroupLive } from "./httpapi/gigs";
import { ChartsApiGroupLive, ScoresApiGroupLive } from "./httpapi/charts";
import { MarksApiGroupLive, StampsApiGroupLive } from "./httpapi/marks";
import { LiveHub } from "./services/live-hub";
import { ChartReader } from "./services/chart-reader";
import { Auth } from "./services/auth";
import { Bands } from "./services/band";
import { PublicUsers } from "./services/public-user";
import { Songs } from "./services/songs";
import { Marks } from "./services/marks";
import { Charts } from "./services/charts";
import { Setlists } from "./services/setlists";
import { Gigs } from "./services/gigs";
import { SessionMiddlewareLive } from "./httpapi/session";
import { RateLimitMiddlewareLive } from "./httpapi/rate-limit";
import { HealthLive } from "./httpapi/health";

const ApiLive = HttpApiBuilder.layer(GigListApi).pipe(
  Layer.provide(Layer.mergeAll(AuthApiGroupLive, BandsApiGroupLive, PublicBandsApiGroupLive, PublicUsersApiGroupLive, SongsApiGroupLive, SetlistsApiGroupLive, GigsApiGroupLive, ChartsApiGroupLive, ScoresApiGroupLive, MarksApiGroupLive, StampsApiGroupLive)),
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

/**
 * The services the handlers use, and the database pools they share. Each layer
 * provides what the layers above it need. The server entry provides it again
 * after `HttpRouter.serve`, which asks for each handler's services per request;
 * layers are memoized by reference, so both uses share one instance.
 */
export const AppLayer = Layer.empty.pipe(
  // User traffic runs on the authenticator connection as the visitor role,
  // which is what makes the RLS policies apply at all. The owner pool is
  // reachable only through the services that need app_private.
  Layer.provideMerge(AuthDb.Live),
  Layer.provideMerge(AuthVisitor.Live),
  Layer.provideMerge(Db.Live),
  // One hub per process: viewers and change events are shared by every request.
  Layer.provideMerge(LiveHub.layer),
  Layer.provideMerge(ChartReader.layer),
  Layer.provideMerge(Auth.layer),
  Layer.provideMerge(Bands.layer),
  Layer.provideMerge(PublicUsers.layer),
  Layer.provideMerge(Songs.layer),
  Layer.provideMerge(Marks.layer),
  Layer.provideMerge(Charts.layer),
  Layer.provideMerge(Setlists.layer),
  Layer.provideMerge(Gigs.layer),
);

/**
 * Every route the server answers, with AppLayer, and no listener. The server
 * entry serves it on a port; the API tests call it in-process
 * (src/server/test/apiHarness.ts).
 */
export const HttpApiLive = Layer.mergeAll(ApiLive, TestingLive, HealthLive).pipe(
  Layer.provideMerge(AppLayer),
);
