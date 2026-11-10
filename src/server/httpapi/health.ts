import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { sql } from "kysely"
import { AuthDb, Db } from "../db"
import { Worker } from "../../../worker/main"

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

export const HealthLive = HttpRouter.add("GET", "/healthz", Effect.gen(function* () {
  const worker = yield* Worker
  const owner = yield* Db
  const authenticator = yield* AuthDb
  const check = Effect.all([
    owner.selectNoFrom(sql<number>`1`.as("ok")),
    authenticator.selectNoFrom(sql<number>`1`.as("ok")),
  ], { concurrency: "unbounded" }).pipe(Effect.asVoid)
  return yield* healthResponse(check, yield* worker.isRunning, process.env.GIT_COMMIT || "unknown")
}))
