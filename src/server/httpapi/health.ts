import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { sql } from "kysely"
import { AuthDb, Db } from "../db"

/** Readiness requires a successful query through both database connections. */
export const HealthLive = HttpRouter.add("GET", "/api/health", Effect.gen(function* () {
  const owner = yield* Db
  const authenticator = yield* AuthDb
  yield* Effect.all([
    owner.selectNoFrom(sql<number>`1`.as("ok")),
    authenticator.selectNoFrom(sql<number>`1`.as("ok")),
  ], { concurrency: "unbounded" })
  return HttpServerResponse.text("ok\n", { headers: { "cache-control": "no-store" } })
}).pipe(
  Effect.timeout("5 seconds"),
  Effect.catch((error) => Effect.logError("Database readiness check failed", error).pipe(
    Effect.as(HttpServerResponse.text("unavailable\n", { status: 503, headers: { "cache-control": "no-store" } })),
  )),
))
