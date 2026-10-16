import { Context, Effect, Layer, PubSub, Stream } from "effect"
import type { Schema as S } from "effect"
import type { SetlistEvent, SetlistViewer } from "../../api/contracts"

export type SetlistEventData = S.Schema.Type<typeof SetlistEvent>
export type Viewer = S.Schema.Type<typeof SetlistViewer>

/** How often an idle connection hears something, so a client can tell a dead one from a quiet one. */
const PING_EVERY = "20 seconds"

/**
 * Who has each setlist open, and the channel that tells them it changed.
 *
 * It lives in this process's memory. Two server processes would not see each
 * other's viewers or writes; running more than one needs the same events sent
 * through the database (LISTEN/NOTIFY) instead.
 */
export class SetlistHub extends Context.Service<SetlistHub, {
  /** Tells everyone watching `setlistId` that `by` wrote it. */
  readonly changed: (setlistId: string, by: string | null) => Effect.Effect<void>
  /**
   * The events of one connection. The viewer joins when the stream starts and
   * leaves when it ends, however it ends.
   */
  readonly watch: (setlistId: string, who: { userId: string; viewer: Viewer }) => Stream.Stream<SetlistEventData>
  /** Updates what a connection is doing; false when `userId` has no connection `client` on this setlist. */
  readonly report: (
    setlistId: string,
    userId: string,
    update: Pick<Viewer, "client" | "mode" | "at">,
  ) => Effect.Effect<boolean>
}>()("SetlistHub") {
  static Live = Layer.sync(this, makeHub)
}

type Room = {
  readonly events: PubSub.PubSub<SetlistEventData>
  readonly viewers: Map<string, { userId: string; viewer: Viewer }>
}

function makeHub() {
  const rooms = new Map<string, Room>()

  const presence = (room: Room): SetlistEventData => ({
    kind: "presence",
    viewers: [...room.viewers.values()].map((v) => v.viewer),
  })

  const announce = (room: Room) => PubSub.publish(room.events, presence(room))

  const roomFor = (setlistId: string): Room => {
    let room = rooms.get(setlistId)
    if (!room) {
      room = { events: Effect.runSync(PubSub.sliding<SetlistEventData>(64)), viewers: new Map() }
      rooms.set(setlistId, room)
    }
    return room
  }

  return SetlistHub.of({
    changed: (setlistId, by) => {
      const room = rooms.get(setlistId)
      return room ? PubSub.publish(room.events, { kind: "changed", by }).pipe(Effect.asVoid) : Effect.void
    },

    watch: (setlistId, { userId, viewer }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const room = roomFor(setlistId)
          room.viewers.set(viewer.client, { userId, viewer })
          yield* announce(room)
          // The announcement above went out before this connection listened, so it starts from the list itself.
          const live = Stream.merge(
            Stream.fromPubSub(room.events),
            Stream.tick(PING_EVERY).pipe(Stream.map((): SetlistEventData => ({ kind: "ping" }))),
          )
          return Stream.concat(Stream.make(presence(room)), live).pipe(
            Stream.ensuring(
              Effect.suspend(() => {
                room.viewers.delete(viewer.client)
                if (room.viewers.size === 0) {
                  rooms.delete(setlistId)
                  return Effect.void
                }
                return announce(room).pipe(Effect.asVoid)
              }),
            ),
          )
        }),
      ),

    report: (setlistId, userId, update) =>
      Effect.suspend(() => {
        const room = rooms.get(setlistId)
        const entry = room?.viewers.get(update.client)
        if (!room || !entry || entry.userId !== userId) return Effect.succeed(false)
        entry.viewer = { ...entry.viewer, mode: update.mode, at: update.at }
        return announce(room).pipe(Effect.as(true))
      }),
  })
}
