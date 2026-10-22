#!/usr/bin/env bun
/**
 * dbEnsure — predev hook: start containers, test connection, run init on failure.
 */
import { Config, Duration, Effect, Option, Redacted, Schedule, Schema as S } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { PgClient } from "@effect/sql-pg";
import * as SqlError from "effect/sql/SqlError";
import runAll from "npm-run-all";

class ScriptFailed extends S.TaggedError<ScriptFailed, { readonly brand: unique symbol }>()(
  "ScriptFailed",
  { message: S.String },
) {}

class DbUnavailable extends S.TaggedError<DbUnavailable, { readonly brand: unique symbol }>()(
  "DbUnavailable",
  {
    message: S.String,
    retryable: S.Boolean,
  },
) {}

const run = Effect.fn("dbEnsure.run")(function* (scripts: string[]) {
  yield* Effect.tryPromise({
    try: () =>
      runAll(scripts, {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        silent: true,
      }),
    catch: () => new ScriptFailed({ message: `run-s ${scripts.join(" ")} failed` }),
  });
});

// Building the PgClient layer opens the connection, so a refused connection
// fails at provide time. The retry wraps the provided effect for that reason.
const testConnection = Effect.fn("dbEnsure.testConnection")(
  function* (_url: Redacted.Redacted) {
    const sql = yield* PgClient.PgClient;
    return yield* sql`SELECT true AS "ok"`;
  },
  (effect, url) =>
    effect.pipe(
      Effect.provide(PgClient.layer({ url, maxConnections: 1, connectTimeout: Duration.seconds(3) })),
      Effect.mapError(
        (error: SqlError.SqlError) =>
          new DbUnavailable({ message: error.message, retryable: error.isRetryable }),
      ),
      Effect.retry({
        schedule: Schedule.min([
          Schedule.exponential(Duration.millis(200), 1.8),
          Schedule.spaced(Duration.millis(10_000)),
        ]).pipe(Schedule.upTo({ times: 7 })),
        while: (error) => error.retryable,
      }),
    ),
);

const main = Effect.gen(function* () {
  const databaseUrl = yield* Config.option(Config.Redacted("DATABASE_URL"));
  if (Option.isNone(databaseUrl)) {
    return yield* Effect.log("DATABASE_URL not set, running full init").pipe(
      Effect.andThen(run(["init"])),
    );
  }

  const url = databaseUrl.value;
  return yield* run(["db:up"]).pipe(
    Effect.andThen(
      testConnection(url).pipe(
        Effect.tap(() => Effect.log("Database is ready")),
        Effect.catch((error) =>
          Effect.log(`Connection failed (${error.message}), running init...`).pipe(
            Effect.andThen(run(["init"])),
          ),
        ),
      ),
    ),
  );
});

main.pipe(NodeRuntime.runMain);
