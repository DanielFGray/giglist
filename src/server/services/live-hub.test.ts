import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { LiveHub, type LiveEventData } from "./live-hub"

const CLIENT_A = "11111111-1111-4111-8111-111111111111"
const CLIENT_B = "22222222-2222-4222-8222-222222222222"
const viewer = (client: string, username: string) => ({ client, username, mode: "viewing" as const, at: null })

const run = <A>(body: (hub: typeof LiveHub.Service) => Effect.Effect<A>) =>
  Effect.runPromise(LiveHub.use(body).pipe(Effect.provide(LiveHub.Live)))

const names = (event: LiveEventData | undefined) => (event?.kind === "presence" ? event.viewers.map((v) => v.username) : null)

describe("live hub", () => {
  test("a connection starts from the list of who is here, itself included", async () => {
    const first = await run((hub) =>
      hub.watch("s1", { userId: "u1", viewer: viewer(CLIENT_A, "ann") }).pipe(Stream.take(1), Stream.runCollect),
    )
    expect(names(first[0])).toEqual(["ann"])
  })

  test("others hear when someone joins, reports where they are, writes, and leaves", async () => {
    const seen = await run((hub) =>
      Effect.gen(function* () {
        const listener = yield* Effect.forkChild(
          hub.watch("s2", { userId: "u1", viewer: viewer(CLIENT_A, "ann") }).pipe(Stream.filter((e) => e.kind !== "ping"), Stream.take(5), Stream.runCollect),
        )
        yield* Effect.sleep("20 millis")
        // Bob joins, moves to song 3, writes, and leaves.
        const bob = yield* Effect.forkChild(hub.watch("s2", { userId: "u2", viewer: viewer(CLIENT_B, "bob") }).pipe(Stream.runDrain))
        yield* Effect.sleep("20 millis")
        yield* hub.report("s2", "u2", { client: CLIENT_B, mode: "performing", at: 3 })
        yield* hub.changed("s2", "bob")
        yield* Fiber.interrupt(bob)
        return yield* Fiber.join(listener)
      }),
    )
    expect(names(seen[0])).toEqual(["ann"])
    expect(names(seen[1])).toEqual(["ann", "bob"])
    const moved = seen[2]
    expect(moved?.kind === "presence" && moved.viewers.find((v) => v.username === "bob")).toMatchObject({ mode: "performing", at: 3 })
    expect(seen[3]).toEqual({ kind: "changed", by: "bob" })
    expect(names(seen[4])).toEqual(["ann"])
  })

  test("only the owner of a connection can report for it", async () => {
    const results = await run((hub) =>
      Effect.gen(function* () {
        const watching = yield* Effect.forkChild(
          hub.watch("s3", { userId: "u1", viewer: viewer(CLIENT_A, "ann") }).pipe(Stream.filter((e) => e.kind !== "ping"), Stream.take(2), Stream.runCollect),
        )
        yield* Effect.sleep("20 millis")
        const other = yield* hub.report("s3", "u2", { client: CLIENT_A, mode: "performing", at: 1 })
        const unknown = yield* hub.report("s3", "u1", { client: CLIENT_B, mode: "performing", at: 1 })
        const own = yield* hub.report("s3", "u1", { client: CLIENT_A, mode: "performing", at: 1 })
        yield* Fiber.join(watching)
        return { other, unknown, own }
      }),
    )
    expect(results).toEqual({ other: false, unknown: false, own: true })
  })

  test("a write to a room nobody watches goes nowhere", async () => {
    await run((hub) => hub.changed("nobody", "ann"))
  })
})
