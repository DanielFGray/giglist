#!/usr/bin/env bun
/**
 * dbEnsure — predev hook: start containers, test connection, run init on failure.
 */
import pg from "pg";
import runAll from "npm-run-all";
import { Duration, Effect, Option, Schedule, Schema, pipe } from "effect";

/** A `run-s` invocation that exited non-zero. */
class ScriptFailed extends Schema.TaggedError<ScriptFailed, { readonly brand: unique symbol }>()("ScriptFailed", {
  message: Schema.String,
}) {}

/**
 * The database is not reachable yet. `sqlState` carries the SQLSTATE when the
 * driver reported one, so the retry loop can tell a wrong password (28P01) from
 * a server that has not finished starting.
 */
class DbUnavailable extends Schema.TaggedError<DbUnavailable, { readonly brand: unique symbol }>()("DbUnavailable", {
  message: Schema.String,
  sqlState: Schema.optional(Schema.String),
}) {}

/** The shape pg attaches to a connection failure, decoded rather than asserted. */
const PgFailure = Schema.Struct({
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const dbUnavailable = (cause: unknown): DbUnavailable =>
  Option.match(Schema.decodeUnknownOption(PgFailure)(cause), {
    onNone: () => new DbUnavailable({ message: "Database is not reachable" }),
    onSome: (failure) =>
      new DbUnavailable({
        message: failure.message ?? "Database is not reachable",
        sqlState: failure.code,
      }),
  });

const run = (scripts: string[]) =>
  Effect.tryPromise({
    try: () =>
      runAll(scripts, {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        silent: true,
      }),
    catch: () => new ScriptFailed({ message: `run-s ${scripts.join(" ")} failed` }),
  });

const testConnection = (url: string) =>
  pipe(
    Effect.acquireRelease(
      Effect.sync(
        () => new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 }),
      ),
      (pool) => Effect.promise(() => pool.end()),
    ),
    Effect.flatMap((pool) =>
      Effect.tryPromise({
        try: () => pool.query('SELECT true AS "ok"'),
        catch: dbUnavailable,
      }),
    ),
    Effect.scoped,
    Effect.retry({
      // Retry on the faster of an exponential backoff and a 10s floor, at most
      // seven times. `Schedule.either` / `Schedule.intersect` became
      // `Schedule.min` (fastest delay) plus a limit.
      schedule: pipe(
        Schedule.min([
          Schedule.exponential(Duration.millis(200), 1.8),
          Schedule.spaced(Duration.millis(10_000)),
        ]),
        Schedule.upTo({ times: 7 }),
      ),
      // A wrong password never becomes right by waiting.
      while: (error) => error.sqlState !== "28P01",
    }),
  );

const main = Effect.gen(function* () {
  const url = process.env.DATABASE_URL;
  if (!url) {
    yield* Effect.log("DATABASE_URL not set — running full init");
    yield* run(["init"]);
    return;
  }

  yield* run(["db:up"]);
  yield* testConnection(url).pipe(
    Effect.tap(() => Effect.log("Database is ready")),
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Effect.log(`Connection failed (${error.message}), running init...`);
        yield* run(["init"]);
      }),
    ),
  );
});

Effect.runPromise(main).catch((cause: unknown) => {
  console.error("dbEnsure failed:", cause);
  process.exit(1);
});
