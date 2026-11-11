import { Config, Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
import { BunServices } from "@effect/platform-bun"
import type { FileSystem } from "effect/FileSystem"
import { getTasks, run, type Runner, type Task } from "graphile-worker"
import { Mailer } from "./email/mailer"
import { sendEmail } from "./email/send-email"
import type { RateLimiter } from "effect/persistence/RateLimiter"
import { TelemetryLive } from "../src/server/telemetry"
import { nodeEnv } from "../src/server/config"

class WorkerError extends Schema.TaggedError<WorkerError, { readonly brand: unique symbol }>()("WorkerError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The graphile-worker runner, inside the server process. Building the layer
 * starts the runner in the background: the server binds without waiting for
 * graphile-worker's own migrations, and keeps serving when the runner cannot
 * start. `isRunning` reports both cases to `/healthz`.
 *
 * The runner stops when the layer's scope closes, before the RateLimiter and
 * the database pools are released.
 */
export class Worker extends Context.Service<Worker>()("giglist/Worker", {
  make: Effect.gen(function* () {
    const running = yield* Ref.make(false)
    yield* start(running).pipe(
      Effect.catch((error) => Effect.logError("The worker did not start", error)),
      Effect.forkScoped,
    )
    return { isRunning: Ref.get(running) }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(TelemetryLive, BunServices.layer)),
  )
}

// The provider is chosen once. Every email job requires the same Mailer service.
const MailerLive = Layer.unwrap(Effect.gen(function* () {
  const mode = yield* nodeEnv
  const configured = Config.Literals(["development", "ses", "cloudflare"], "MAIL_PROVIDER")
  // A test worker needs an explicit provider before it can contact a mail server.
  const provider = yield* (mode === "test" ? configured : configured.pipe(
    Config.withDefault(mode === "production" ? "ses" : "development"),
  ))
  switch (provider) {
    case "development": return Mailer.layer
    case "ses": return Mailer.ses
    case "cloudflare": return Mailer.cloudflare
  }
}))

/**
 * Starts the runner and returns once it runs. The Mailer is built here, not in
 * the layer, so a mail provider that cannot start stops only the worker.
 */
const start = Effect.fnUntraced(function* (running: Ref.Ref<boolean>) {
  const connection = yield* Config.Redacted("DATABASE_URL")
  const mailer = yield* Layer.build(MailerLive)
  const services = yield* Effect.context<FileSystem | RateLimiter>()
  const context = Context.merge(services, mailer)
  const loadedTasks = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => getTasks({}, `${import.meta.dir}/tasks`),
      catch: (cause) => new WorkerError({ message: "Could not load worker tasks", cause }),
    }),
    (loaded) => Effect.sync(() => loaded.release()),
  )
  // Graphile owns retry scheduling. A rejected delivery must reject this callback.
  const deliver: Task = (payload, helpers) =>
    Effect.runPromiseWith(context)(sendEmail(payload), { signal: helpers.abortSignal })
  const runner = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => run({
        connectionString: Redacted.value(connection),
        taskList: { ...loadedTasks.tasks, send_email: deliver },
        crontabFile: `${import.meta.dir}/crontab`,
        // The server's runtime handles SIGTERM and closes this scope.
        noHandleSignals: true,
        // With the default delay (-1), graphile does not wait for the row
        // update that marks a job done or failed, and a graceful shutdown can
        // end the pool before it is sent. The job then stays locked and runs
        // again when the lock expires (4 hours), so a sent email is sent
        // twice. With a batch delay, the shutdown waits for the pending
        // updates; 0 sends each one on the next tick.
        preset: { worker: { completeJobBatchDelay: 0, failJobBatchDelay: 0 } },
      }),
      catch: (cause) => new WorkerError({ message: "Could not start the worker", cause }),
    }),
    (started) => stop(started, running),
  )
  yield* Ref.set(running, true)
  // Forked after the release above, so on shutdown it is interrupted before
  // `stop` settles the runner's promise, and does not log a planned stop.
  yield* Effect.forkScoped(
    Effect.tryPromise({
      try: () => runner.promise,
      catch: (cause) => new WorkerError({ message: "The worker stopped with an error", cause }),
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.logError(error.message, error.cause),
        onSuccess: () => Effect.logError("The worker stopped"),
      }),
      Effect.andThen(Ref.set(running, false)),
    ),
  )
})

/** `runner.stop()` rejects on a runner that already stopped itself, so that one is skipped. */
const stop = Effect.fnUntraced(function* (runner: Runner, running: Ref.Ref<boolean>) {
  if (!(yield* Ref.get(running))) return
  yield* Effect.tryPromise({
    try: () => runner.stop(),
    catch: (cause) => new WorkerError({ message: "Could not stop the worker", cause }),
  }).pipe(Effect.catch((error) => Effect.logError(error.message, error.cause)))
  yield* Ref.set(running, false)
})
