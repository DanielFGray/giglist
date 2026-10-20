import { Config, Effect, Layer, Redacted, Schema } from "effect"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { FileSystem } from "effect/FileSystem"
import { getTasks, run, type Task } from "graphile-worker"
import { Mailer } from "./email/mailer"
import { sendEmail } from "./email/send-email"

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

const program = Effect.gen(function* () {
  const connection = yield* Config.Redacted("DATABASE_URL")
  const context = yield* Effect.context<Mailer | FileSystem>()
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
    (runner) => Effect.promise(() => runner.stop()),
  )
  yield* Effect.tryPromise({ try: () => runner.promise, catch: (cause) => new WorkerError({ message: "Worker stopped with an error", cause }) })
})

program.pipe(
  Effect.scoped,
  Effect.provide(MailerLive.pipe(Layer.provideMerge(BunServices.layer))),
  BunRuntime.runMain,
)
