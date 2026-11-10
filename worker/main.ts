import { Config, Context, Effect, Layer, Redacted, Ref, Schema } from "effect"
import { BunRedis, BunRuntime, BunServices } from "@effect/platform-bun"
import { FileSystem } from "effect/FileSystem"
import { getTasks, run, type Task } from "graphile-worker"
import { Mailer } from "./email/mailer"
import { sendEmail } from "./email/send-email"
import { RateLimiter } from "effect/persistence/RateLimiter"
import { RateLimiterValkey } from "../src/server/services/rate-limiter"
import { TelemetryLive } from "../src/server/telemetry"

class WorkerError extends Schema.TaggedError<WorkerError, { readonly brand: unique symbol }>()("WorkerError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

// The provider is chosen once. Every email job requires the same Mailer service.
const MailerLive = Layer.unwrap(Effect.gen(function* () {
  const mode = yield* Config.Literals(["development", "test", "production"], "NODE_ENV").pipe(Config.withDefault("development"))
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

export class Worker extends Context.Service<Worker, {
  readonly start: Effect.Effect<void, WorkerError, import("effect/Scope").Scope>
  readonly isRunning: Effect.Effect<boolean>
}>()("giglist/Worker") {
  static readonly make = Effect.gen(function* () {
    const connection = yield* Config.Redacted("DATABASE_URL")
    const context = yield* Effect.context<Mailer | FileSystem | RateLimiter>()
    const running = yield* Ref.make(false)

    const start = Effect.gen(function* () {
      const tasks = yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => getTasks({}, `${import.meta.dir}/tasks`), catch: (cause) => new WorkerError({ message: "Could not load worker tasks", cause }) }),
        (tasks) => Effect.sync(() => tasks.release()),
      )
      // Graphile owns retry scheduling. A rejected delivery must reject this callback.
      const deliver: Task = (payload, helpers) => Effect.runPromiseWith(context)(sendEmail(payload), { signal: helpers.abortSignal })
      const runner = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => run({
            connectionString: Redacted.value(connection),
            taskList: { ...tasks.tasks, send_email: deliver },
            crontabFile: `${import.meta.dir}/crontab`,
            noHandleSignals: true,
          }),
          catch: (cause) => new WorkerError({ message: "Could not start the worker", cause }),
        }),
        (runner) => Effect.tryPromise({ try: () => runner.stop(), catch: (cause) => new WorkerError({ message: "Could not stop the worker", cause }) }).pipe(
          Effect.tapError((error) => Effect.logError("Could not stop the worker", error)),
          Effect.ignore,
          Effect.andThen(Ref.set(running, false)),
        ),
      )
      yield* Ref.set(running, true)
      const monitor = Effect.tryPromise({
        try: () => runner.promise,
        catch: (cause) => new WorkerError({ message: "Worker stopped with an error", cause }),
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.logError("Worker stopped with an error", error),
          onSuccess: () => Effect.logError("Worker stopped unexpectedly"),
        }),
        Effect.andThen(Ref.set(running, false)),
      )
      yield* Effect.forkScoped(monitor)
    })

    return Worker.of({ start, isRunning: Ref.get(running) })
  })

  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(MailerLive, TelemetryLive).pipe(Layer.provideMerge(BunServices.layer))),
  )
}

if (import.meta.main) {
  Effect.scoped(Effect.gen(function* () {
    const worker = yield* Worker
    yield* worker.start
    return yield* Effect.never
  })).pipe(
    Effect.provide(Worker.layer.pipe(
      Layer.provide(RateLimiterValkey),
      // The same client options as src/server/main.ts: keep reconnecting, and fail
      // a command at once while Valkey is down.
      Layer.provide(BunRedis.layerConfig({
        url: Config.String("VALKEY_URL"),
        maxRetries: Config.succeed(1_000_000),
        enableOfflineQueue: Config.succeed(false),
      })),
    )),
    BunRuntime.runMain,
  )
}
