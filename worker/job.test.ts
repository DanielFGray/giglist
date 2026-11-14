import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Ref, Scope } from "effect"
import { collectLogs, type LogLine } from "../src/server/test/probe"
import { effectTask, type JobInfo, promiseTask } from "./job"

const jobInfo = (abortSignal: AbortSignal = new AbortController().signal): JobInfo => ({
  job: { id: "1", task_identifier: "send_email", attempts: 1 },
  abortSignal,
})

describe("worker job adapters", () => {
  it.effect("promiseTask rejects its callback and logs one 'The job failed' line", () => {
    const lines: Array<LogLine> = []
    return Effect.gen(function* () {
      const context = yield* Effect.context()
      const failing = promiseTask(context, async () => { throw new Error("boom") })
      const settled = yield* Effect.promise(() => failing({}, jobInfo()).then(() => "resolved", () => "rejected"))
      expect(settled).toBe("rejected")
      expect(lines.map((line) => [line.level, line.message])).toEqual([["Error", ["The job failed"]]])
    }).pipe(Effect.provide(collectLogs(lines)))
  })

  it.effect("effectTask interrupts its effect when the job is aborted, and logs no failure", () => {
    const lines: Array<LogLine> = []
    return Effect.gen(function* () {
      const context = yield* Effect.context()
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Ref.make(false)
      const job = () => Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Ref.set(interrupted, true)),
      )
      // Effect.abortSignal aborts when its scope closes, which is how this test aborts the job.
      const scope = yield* Scope.make()
      const signal = yield* Effect.abortSignal.pipe(Effect.provideService(Scope.Scope, scope))
      const running = effectTask(context, job)({}, jobInfo(signal)).then(() => "resolved", () => "rejected")
      yield* Deferred.await(started)
      yield* Scope.close(scope, Exit.void)
      const settled = yield* Effect.promise(() => running)
      expect(settled).toBe("rejected")
      expect(yield* Ref.get(interrupted)).toBe(true)
      expect(lines).toEqual([])
    }).pipe(Effect.provide(collectLogs(lines)))
  })
})
