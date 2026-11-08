import { Context, Effect, Layer, PubSub, Ref, Stream } from "effect"
import type { Schema as S } from "effect"
import type { LiveEvent, LiveViewer } from "../../api/contracts"

export type LiveEventData = S.Schema.Type<typeof LiveEvent>
export type Viewer = S.Schema.Type<typeof LiveViewer>

/** How often an idle connection hears something, so a client can tell a dead one from a quiet one. */
const PING_EVERY = "20 seconds"

type Room = {
  readonly events: PubSub.PubSub<LiveEventData>
  readonly viewers: Map<string, { userId: string; viewer: Viewer }>
}

/**
 * Who has each room open, and the channel that tells them it changed. A room is
 * a setlist or a gig, named by its id; a write to a setlist is announced to the
 * setlist and to every gig that plays it.
 *
 * It lives in this process's memory. Two server processes would not see each
 * other's viewers or writes; running more than one needs the same events sent
 * through the database (LISTEN/NOTIFY) instead.
 */
export class LiveHub extends Context.Service<LiveHub>()("setlist/LiveHub", {
  make: Effect.gen(function* () {
    const rooms = yield* Ref.make(new Map<string, Room>())

    const presence = (room: Room): LiveEventData => ({
      kind: "presence",
      viewers: [...room.viewers.values()].map((v) => v.viewer),
    })

    const announce = (room: Room) => PubSub.publish(room.events, presence(room))

    const ensureRoom = (roomId: string): Effect.Effect<Room> =>
      Effect.gen(function* () {
        const map = yield* Ref.get(rooms)
        const existing = map.get(roomId)
        if (existing) return existing
        const events = yield* PubSub.sliding<LiveEventData>(64)
        const room = { events, viewers: new Map() }
        map.set(roomId, room)
        return room
      })

    /** Tells everyone watching `roomId` that `by` wrote it. */
    const changed = (roomId: string, by: string | null): Effect.Effect<void> =>
      Effect.gen(function* () {
        const room = (yield* Ref.get(rooms)).get(roomId)
        if (room) yield* PubSub.publish(room.events, { kind: "changed", by })
      })

    /**
     * The events of one connection. The viewer joins when the stream starts and
     * leaves when it ends, however it ends.
     */
    const watch = (roomId: string, { userId, viewer }: { userId: string; viewer: Viewer }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const room = yield* ensureRoom(roomId)
          room.viewers.set(viewer.client, { userId, viewer })
          yield* announce(room)
          // The announcement above went out before this connection listened, so it starts from the list itself.
          const live = Stream.merge(
            Stream.fromPubSub(room.events),
            Stream.tick(PING_EVERY).pipe(Stream.map((): LiveEventData => ({ kind: "ping" }))),
          )
          return Stream.concat(Stream.make(presence(room)), live).pipe(
            Stream.ensuring(
              Effect.gen(function* () {
                room.viewers.delete(viewer.client)
                if (room.viewers.size === 0) {
                  const map = yield* Ref.get(rooms)
                  map.delete(roomId)
                  return
                }
                yield* announce(room)
              }),
            ),
          )
        }),
      )

    /** Updates what a connection is doing; false when `userId` has no connection `client` in this room. */
    const report = (
      roomId: string,
      userId: string,
      update: Pick<Viewer, "client" | "mode" | "at">,
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const room = (yield* Ref.get(rooms)).get(roomId)
        const entry = room?.viewers.get(update.client)
        if (!room || !entry || entry.userId !== userId) return false
        entry.viewer = { ...entry.viewer, mode: update.mode, at: update.at }
        yield* announce(room)
        return true
      })

    return { changed, watch, report }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
