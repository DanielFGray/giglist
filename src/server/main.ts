import { Effect, Layer } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { AuthDb, AuthVisitor, Db } from "./db";
import { SetListApi } from "../api/contracts";

// Group handlers
import { authHandlers } from "./httpapi/auth";
import { bandsHandlers } from "./httpapi/bands";
import { testingHandlers } from "./httpapi/testing";
import { songsHandlers } from "./httpapi/songs";
import { setlistsHandlers } from "./httpapi/setlists";
import { chartsHandlers } from "./httpapi/charts";
import { scoresHandlers } from "./httpapi/scores";
import { marksHandlers, stampsHandlers } from "./httpapi/marks";
import { SetlistHub } from "./services/setlist-hub";
import { ChartReader } from "./services/chart-reader";
import { SessionMiddlewareLive } from "./httpapi/session";

const PORT = Number(process.env.PORT ?? 3001);

const ApiLive = HttpApiBuilder.layer(SetListApi).pipe(
  Layer.provide(Layer.mergeAll(authHandlers, bandsHandlers, testingHandlers, songsHandlers, setlistsHandlers, chartsHandlers, scoresHandlers, marksHandlers, stampsHandlers)),
  Layer.provide(SessionMiddlewareLive),
);

// HTTP server layer
const ServerLive = HttpRouter.serve(ApiLive).pipe(
  // User traffic runs on the authenticator connection as the visitor role,
  // which is what makes the RLS policies apply at all. The owner pool is
  // reachable only through the services that need app_private.
  Layer.provide(AuthDb.Live),
  Layer.provide(AuthVisitor.Live),
  Layer.provide(Db.Live),
  // One hub per process: viewers and change events are shared by every request.
  Layer.provide(SetlistHub.Live),
  Layer.provide(ChartReader.Live),
  Layer.provide(BunHttpServer.layer({ port: PORT, hostname: "0.0.0.0" })),
);

// Launch
Layer.launch(ServerLive).pipe(
  Effect.tap(() => Effect.log(`Starting SetList API server on port ${PORT}`)),
  BunRuntime.runMain,
);
