// @entrypoint: graphile-worker's task callbacks run here. Each adapter runs its Effect through the context the worker captured at start.
import { Cause, Context, Effect, Schema } from "effect"
import type { Job } from "graphile-worker"
import { QueuedEmail } from "./email/emailDelivery"

export class WorkerError extends Schema.TaggedError<WorkerError, { readonly brand: unique symbol }>()("WorkerError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The part of graphile's JobHelpers that the adapters read. Typed narrowly so
 * that a test builds it as a literal, without a cast.
 */
export type JobInfo = {
  readonly job: Pick<Job, "id" | "task_identifier" | "attempts">
  readonly abortSignal: AbortSignal
}

/**
 * The send_email job. The payload is the queue's boundary: it is `unknown`
 * until it is decoded here, and a malformed payload fails with a SchemaError
 * before `send` runs.
 */
export const sendEmail = <A, E, R>(send: (job: QueuedEmail) => Effect.Effect<A, E, R>) =>
  (payload: unknown) => Schema.decodeUnknownEffect(QueuedEmail)(payload).pipe(Effect.flatMap(send))

/**
 * Runs one job in its Worker.job span. This is the worker's failure boundary:
 * a failure is logged here, once, inside the span, so the line carries the
 * trace id. A stop is not a failure, so an interrupt alone is not logged.
 */
export const traced = <A, E, R>(job: Effect.Effect<A, E, R>, helpers: JobInfo) =>
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
 * An Effect job. Graphile owns retry scheduling: a failed job rejects its
 * callback. Graphile aborts a job on shutdown through its abort signal, which
 * interrupts the effect.
 */
export const effectTask = <A, E, R>(context: Context.Context<R>, job: (payload: unknown) => Effect.Effect<A, E, R>) =>
  (payload: unknown, helpers: JobInfo): Promise<A> =>
    Effect.runPromiseWith(context)(traced(job(payload), helpers), { signal: helpers.abortSignal })

/**
 * A Promise task. Nothing outside it can stop it, so it reads the abort signal
 * from its own helpers. Its callback settles when the task does: if it rejected
 * on abort while the task ran on, graphile would retry a job whose effects had
 * already happened.
 */
export const promiseTask = <R, H extends JobInfo>(context: Context.Context<R>, task: (payload: unknown, helpers: H) => unknown) =>
  (payload: unknown, helpers: H): Promise<unknown> =>
    Effect.runPromiseWith(context)(
      traced(
        Effect.tryPromise({
          try: async () => task(payload, helpers),
          catch: (cause) => new WorkerError({ message: "The job failed", cause }),
        }),
        helpers,
      ),
    )
