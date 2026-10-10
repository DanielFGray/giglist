import { Effect, Layer } from "effect"
import { BunRuntime } from "@effect/platform-bun"
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import { HttpApiBuilder } from "@effect/platform"
import { AuthDb, AuthVisitor, Db } from "./db"
import { SetListApi } from "../api/contracts"

// Group handlers
import { authHandlers } from "./httpapi/auth"
import { bandsHandlers } from "./httpapi/bands"
import { testingHandlers } from "./httpapi/testing"
import { songsHandlers } from "./httpapi/songs"
import { SessionMiddlewareLive } from "./httpapi/session"

const PORT = Number(process.env.PORT ?? 3001)

const ApiLive = HttpApiBuilder.api(SetListApi).pipe(
  Layer.provide(
    Layer.mergeAll(authHandlers, bandsHandlers, testingHandlers, songsHandlers),
  ),
)

// HTTP server layer
const ServerLive = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provide(SessionMiddlewareLive),
  // User traffic runs on the authenticator connection as the visitor role,
  // which is what makes the RLS policies apply at all. The owner pool is
  // reachable only through the services that need app_private.
  Layer.provide(AuthDb.Live),
  Layer.provide(AuthVisitor.Live),
  Layer.provide(Db.Live),
  Layer.provide(
    BunHttpServer.layer({ port: PORT, hostname: "0.0.0.0" }),
  ),
)

// Launch
BunRuntime.runMain(
  Effect.gen(function* () {
    yield* Effect.log(`Starting SetList API server on port ${PORT}`)
    yield* Layer.launch(ServerLive)
  }).pipe(Effect.orDie),
)
