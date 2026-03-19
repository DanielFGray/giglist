#!/usr/bin/env bun
/**
 * dbEnsure — predev hook: start containers, test connection, run init on failure.
 */
import pg from "pg";
import runAll from "npm-run-all";
import { Effect, Schedule, Duration, pipe } from "effect";

const run = (scripts: string[]) =>
  Effect.tryPromise({
    try: () => runAll(scripts, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, silent: true }),
    catch: (e) => new Error(`run-s ${scripts.join(" ")} failed: ${e}`),
  });

const testConnection = (url: string) =>
  pipe(
    Effect.acquireRelease(
      Effect.sync(() => new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 })),
      (pool) => Effect.promise(() => pool.end()),
    ),
    Effect.flatMap((pool) =>
      Effect.tryPromise({
        try: () => pool.query('SELECT true AS "ok"'),
        catch: (e) => e as Error,
      }),
    ),
    Effect.scoped,
    Effect.retry({
      schedule: pipe(
        Schedule.exponential(Duration.millis(200), 1.8),
        Schedule.either(Schedule.spaced(Duration.millis(10_000))),
        Schedule.intersect(Schedule.recurs(7)),
      ),
      while: (e) => (e as { code?: string }).code !== "28P01", // don't retry auth failures
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
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        yield* Effect.log(`Connection failed (${e}), running init...`);
        yield* run(["init"]);
      }),
    ),
  );
});

Effect.runPromise(main).catch((e) => {
  console.error("dbEnsure failed:", e);
  process.exit(1);
});
