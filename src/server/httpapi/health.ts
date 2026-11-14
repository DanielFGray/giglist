import { Config, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { sql } from "kysely"
import { AuthDb, Db } from "../db"
import { Worker } from "../../../worker/worker"

/**
 * The platform health contract: `GET /healthz` answers 200 `{status, commit}`
 * when the app can serve, and 503 `{status, commit, failed}` naming each
 * dependency that cannot answer. The route is public, so error detail goes to
 * the log, not the body. `commit` is `GIT_COMMIT`, which the platform sets in
 * every release.
 */
export const HealthLive = Layer.unwrap(Effect.gen(function* () {
  const commit = yield* Config.String("GIT_COMMIT").pipe(Config.withDefault("unknown"))
  const worker = yield* Worker
  const owner = yield* Db
  const authenticator = yield* AuthDb
  const check = Effect.all([
    owner.selectNoFrom(sql<number>`1`.as("ok")),
    authenticator.selectNoFrom(sql<number>`1`.as("ok")),
  ], { concurrency: "unbounded" }).pipe(Effect.asVoid)
  return HttpRouter.add("GET", "/healthz", Effect.gen(function* () {
    return yield* healthResponse(check, yield* worker.isRunning, commit)
  }))
}))

export const healthResponse = <E>(databaseCheck: Effect.Effect<void, E, never>, workerRunning: boolean, commit: string) =>
  databaseCheck.pipe(
    Effect.timeout("2 seconds"),
    Effect.matchEffect({
      onSuccess: () => workerRunning
        ? HttpServerResponse.json({ status: "ok", commit }, { headers: { "cache-control": "no-store" } })
        : Effect.logError("Worker readiness check failed").pipe(Effect.andThen(HttpServerResponse.json(
          { status: "error", commit, failed: ["worker"] },
          { status: 503, headers: { "cache-control": "no-store" } },
        ))),
      onFailure: (error) => Effect.logError("Database readiness check failed", error).pipe(
        Effect.andThen(HttpServerResponse.json(
          { status: "error", commit, failed: workerRunning ? ["database"] : ["database", "worker"] },
          { status: 503, headers: { "cache-control": "no-store" } },
        )),
      ),
    }),
  )
