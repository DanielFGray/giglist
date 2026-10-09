import { Effect, Layer } from "effect"
import { BunRuntime } from "@effect/platform-bun"
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import { HttpApiBuilder } from "@effect/platform"
import { Db } from "./db"
import { SetListApi } from "../api/contracts"

// Group handlers
import { authHandlers } from "./httpapi/auth"
import { bandsHandlers } from "./httpapi/bands"
import { testingHandlers } from "./httpapi/testing"
import { SessionMiddlewareLive } from "./httpapi/session"

const PORT = Number(process.env.PORT ?? 3001)

const ApiLive = HttpApiBuilder.api(SetListApi).pipe(
  Layer.provide(Layer.mergeAll(authHandlers, bandsHandlers, testingHandlers)),
)

// HTTP server layer
const ServerLive = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provide(SessionMiddlewareLive),
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
