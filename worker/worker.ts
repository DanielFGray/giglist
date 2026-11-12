// @entrypoint: graphile-worker calls the send_email task, which runs its effect with the worker's context.
import { Cause, Config, Context, Effect, Layer, Option, Record, Redacted, Ref, Schema } from "effect"
import { BunServices } from "@effect/platform-bun"
import { getTasks, type JobHelpers, Logger, run, type Runner, type Task } from "graphile-worker"
import { Path } from "effect/Path"
import { EmailDelivery, QueuedEmail } from "./email/emailDelivery"

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
    Layer.provide(EmailDelivery.layer),
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
  const logger = new Logger(
    (scope) => (level, message) =>
      Option.match(Record.get(graphileLevels, level), {
        onNone: () => undefined,
        onSome: (log) => Effect.runSyncWith(context)(log(message).pipe(Effect.annotateLogs(scope))),
      }),
  )
  const loadedTasks = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => getTasks({ logger }, path.join(workerDir, "tasks")),
      catch: (cause) => new WorkerError({ message: "Could not load worker tasks", cause }),
    }),
    (loaded) => Effect.sync(() => loaded.release()),
  )
  // Graphile owns retry scheduling: a failed job rejects its callback. An Effect
  // job stops when graphile aborts it.
  const effectTask: Task = (payload, helpers) =>
    Effect.runPromiseWith(context)(
      traced(Schema.decodeUnknownEffect(QueuedEmail)(payload).pipe(Effect.flatMap(delivery.send)), helpers),
      { signal: helpers.abortSignal },
    )
  // Nothing outside a Promise task can stop it. It reads the abort signal from
  // its own helpers, and its callback settles when the task does: if it
  // rejected on abort while the task ran on, graphile would retry a job whose
  // effects had already happened.
  const promiseTask =
    (task: Task): Task =>
    (payload, helpers) =>
      Effect.runPromiseWith(context)(
        traced(
          Effect.tryPromise({
            try: async () => task(payload, helpers),
            catch: (cause) => new WorkerError({ message: "The job failed", cause }),
          }),
          helpers,
        ),
      )
  const taskList = {
    ...Record.map(
      Record.getSomes(Record.map(loadedTasks.tasks, Option.fromNullishOr)),
      promiseTask,
    ),
    send_email: effectTask,
  }
  const runner = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => run({
        connectionString: Redacted.value(connection),
        taskList,
        logger,
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

/**
 * Runs one job in its Worker.job span. This is the worker's failure boundary:
 * a failure is logged here, once, inside the span, so the line carries the
 * trace id. A stop is not a failure, so an interrupt alone is not logged.
 */
const traced = <A, E, R>(job: Effect.Effect<A, E, R>, helpers: JobHelpers) =>
  job.pipe(
    Effect.tapCauseIf(
      (cause) => !Cause.hasInterruptsOnly(cause),
      (cause) => Effect.logError("The job failed", cause),
    ),
    Effect.withSpan("Worker.job", {
      attributes: {
        "job.task": helpers.job.task_identifier,
        "job.id": helpers.job.id,
        "job.attempt": helpers.job.attempts,
      },
    }),
  )

/**
 * Graphile's log levels, as Effect log calls. Debug has no entry, so graphile's
 * debug lines are dropped, as its default logger drops them: one of them
 * prints the pool options, connection string included.
 *
 * Only graphile's scope (worker, task and job ids) annotates a line. Its
 * per-line metadata holds the whole job row, whose payload can carry tokens.
 */
const graphileLevels: Record.ReadonlyRecord<string, (message: string) => Effect.Effect<void>> = {
  error: Effect.logError,
  warning: Effect.logWarning,
  info: Effect.logInfo,
}
