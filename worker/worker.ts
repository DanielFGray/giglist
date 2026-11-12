// @entrypoint: graphile-worker calls the send_email task, which runs its effect with the worker's context.
import { Config, Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
import { BunServices } from "@effect/platform-bun"
import { getTasks, run, type Runner, type Task } from "graphile-worker"
import { Path } from "effect/Path"
import { EmailDelivery, QueuedEmail } from "./email/emailDelivery"
import { TelemetryLive } from "../src/server/telemetry"

class WorkerError extends Schema.TaggedError<WorkerError, { readonly brand: unique symbol }>()("WorkerError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The graphile-worker runner, inside the server process. Building the layer
 * builds EmailDelivery first, so a mail provider that cannot start fails this
 * layer and stops the server before it binds. The runner itself starts in the
 * background: the server binds without waiting for graphile-worker's own
 * migrations, and keeps serving when the runner cannot start. `isRunning`
 * reports both cases to `/healthz`.
 *
 * The runner stops when the layer's scope closes, before the RateLimiter and
 * the database pools are released.
 */
export class Worker extends Context.Service<Worker>()("giglist/worker", {
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
    Layer.provide(Layer.mergeAll(TelemetryLive, EmailDelivery.layer)),
    Layer.provide(BunServices.layer),
  )
}

/**
 * Starts the runner and returns once it runs. The send_email task calls the
 * EmailDelivery that Worker.layer built, so it shares the process's Mailer.
 */
const start = Effect.fnUntraced(function* (running: Ref.Ref<boolean>) {
  const connection = yield* Config.Redacted("DATABASE_URL")
  const delivery = yield* EmailDelivery
  const context = yield* Effect.context()
  const path = yield* Path
  const workerDir = yield* path.fromFileUrl(new URL(".", import.meta.url))
  const loadedTasks = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => getTasks({}, path.join(workerDir, "tasks")),
      catch: (cause) => new WorkerError({ message: "Could not load worker tasks", cause }),
    }),
    (loaded) => Effect.sync(() => loaded.release()),
  )
  // Graphile owns retry scheduling. A rejected delivery must reject this callback.
  const deliver: Task = (payload, helpers) =>
    Effect.runPromiseWith(context)(
      Schema.decodeUnknownEffect(QueuedEmail)(payload).pipe(Effect.flatMap(delivery.send)),
      { signal: helpers.abortSignal },
    )
  const runner = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => run({
        connectionString: Redacted.value(connection),
        taskList: { ...loadedTasks.tasks, send_email: deliver },
        crontabFile: path.join(workerDir, "crontab"),
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
