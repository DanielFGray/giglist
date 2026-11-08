import { Effect, Option, Schema as S, Struct } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { sql } from "kysely"
import { Kysely } from "../db"
import { LiveHub } from "../services/live-hub"
import { Auth } from "../services/auth"
import { asSessionOr, isBandMember } from "./scope"
import { between, placeAfter } from "../../components/position"
import {
  GigListApi,
  CurrentSession,
  LivePresence,
  Setlist,
  SetlistEntry,
  SetlistForbidden,
  SetlistNotFound,
  type SessionData,
} from "../../api/contracts"

const decodeSetlist = S.decodeUnknownEffect(Setlist)
const decodeSetlistArray = S.decodeUnknownEffect(S.Array(Setlist))
const decodeEntry = S.decodeUnknownEffect(SetlistEntry)
const decodeEntryArray = S.decodeUnknownEffect(S.Array(SetlistEntry))

export const setlistsHandlers = HttpApiBuilder.group(GigListApi, "setlists", (handlers) =>
  handlers
    .handle("listSetlists", ({ params: { bandId } }) =>
      asSession(() =>
        Effect.gen(function* () {
          yield* assertBandMember(bandId)
          return yield* selectSetlists().pipe(
            Effect.flatMap((query) => query.where("s.band_id", "=", bandId).orderBy("s.name").orderBy("s.id")),
            Effect.flatMap((rows) => decodeSetlistArray(rows).pipe(Effect.orDie)),
          )
        }),
      ),
    )
    .handle("createSetlist", ({ payload }) =>
      asSession(() =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertBandMember(payload.band_id)
          const inserted = yield* db
            .insertInto("app_public.setlists")
            .values({ band_id: payload.band_id, name: payload.name })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)
          return yield* setlistOrDie(inserted.id)
        }),
      ),
    )
    .handle("getSetlist", ({ params: { id } }) => asSession(() => setlistOr404(id)))
    .handle("updateSetlist", ({ params: { id }, payload }) =>
      asWriter(id, () =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          // An empty SET is not valid SQL, and an empty payload changes nothing.
          if (Struct.keys(payload).length > 0) {
            yield* db.updateTable("app_public.setlists").set(payload).where("id", "=", id).pipe(Effect.orDie)
          }
          return yield* setlistOrDie(id)
        }),
      ),
    )
    .handle("copySetlist", ({ params: { id }, payload }) =>
      asSession(() =>
        Effect.gen(function* () {
          const source = yield* setlistOr404(id)
          return yield* setlistOrDie(yield* copySetlist(source, payload.name))
        }),
      ),
    )
    .handle("deleteSetlist", ({ params: { id } }) =>
      asWriter(id, () =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          yield* db.deleteFrom("app_public.setlists").where("id", "=", id).pipe(Effect.orDie)
        }),
      ),
    )
    .handle("listEntries", ({ params: { id } }) =>
      asSession(() =>
        Effect.gen(function* () {
          yield* setlistOr404(id)
          return yield* entriesFor(id)
        }),
      ),
    )
    .handle("addEntry", ({ params: { id }, payload }) =>
      asWriter(id, () =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* lockSetlist(id)
          const setlist = yield* setlistOr404(id)
          yield* assertBandSong(payload.song_id, setlist.band_id)
          // A new entry plays last.
          const last = yield* db
            .selectFrom("app_public.setlist_entries")
            .select("position_key")
            .where("setlist_id", "=", id)
            .orderBy("position_key", "desc")
            .orderBy("id", "desc")
            .pipe(Effect.head, Effect.map((row) => row.position_key), Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)))
          const inserted = yield* db
            .insertInto("app_public.setlist_entries")
            .values({ setlist_id: id, song_id: payload.song_id, position_key: between(last, null) })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)
          return yield* entryOr404(inserted.id, id)
        }),
      ),
    )
    .handle("updateEntry", ({ params: { id, entryId }, payload }) =>
      asWriter(id, () =>
        Effect.gen(function* () {
          const db = yield* Kysely
          const setlist = yield* setlistOr404(id)
          yield* entryOr404(entryId, id)
          if (payload.song_id !== undefined) yield* assertBandSong(payload.song_id, setlist.band_id)
          // An empty SET is not valid SQL, and an empty payload changes nothing.
          if (Struct.keys(payload).length > 0) {
            yield* db
              .updateTable("app_public.setlist_entries")
              .set(payload)
              .where("id", "=", entryId)
              .where("setlist_id", "=", id)
              .pipe(Effect.orDie)
          }
          return yield* entryOr404(entryId, id)
        }),
      ),
    )
    .handle("deleteEntry", ({ params: { id, entryId } }) =>
      asWriter(id, () =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          yield* db
            .deleteFrom("app_public.setlist_entries")
            .where("id", "=", entryId)
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)
        }),
      ),
    )
    .handle("move", ({ params: { id }, payload }) =>
      asWriter(id, () =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          // Serialise all moves for one setlist before reading neighbour keys.
          yield* lockSetlist(id)
          const rows = yield* db
            .selectFrom("app_public.setlist_entries")
            .select(["id", "position_key"])
            .where("setlist_id", "=", id)
            .orderBy("position_key", "asc")
            .orderBy("id", "asc")
            .pipe(Effect.orDie)
          const writes = rows.some((row) => row.id === payload.id)
            ? placeAfter(rows.filter((row) => row.id !== payload.id), payload.id, payload.previous)
            : Option.none()
          if (Option.isNone(writes)) {
            return yield* new SetlistForbidden({ message: "That entry or neighbour is not in this setlist" })
          }
          yield* Effect.forEach(writes.value, (write) =>
            db
              .updateTable("app_public.setlist_entries")
              .set({ position_key: write.position_key })
              .where("id", "=", write.id)
              .pipe(Effect.orDie),
          )
        }),
      ),
    )
    .handle("watchSetlist", ({ params: { id }, query: { client } }) =>
      watchRoom(id, client, asSession(() => setlistOr404(id))),
    )
    .handle("reportPresence", ({ params: { id }, payload }) =>
      reportInRoom(id, payload, asSession(() => setlistOr404(id))),
    ),
)

/** Run `query` as the session's user, or answer 403 if there is no session. */
export const asSession = <A, E>(query: (session: SessionData) => Effect.Effect<A, E, Kysely>) =>
  asSessionOr(() => new SetlistForbidden({ message: "You must be signed in" }), query)

/**
 * Run a write to a setlist as the session's user. Once it commits, everyone
 * watching the setlist, and every gig that plays it, hears who wrote. The gigs
 * are read before the write, so deleting the setlist still reaches them.
 */
const asWriter = <A, E>(setlistId: string, query: (session: SessionData) => Effect.Effect<A, E, Kysely>) =>
  asSession((session) =>
    Effect.gen(function* () {
      const db = yield* Kysely
      const gigs = yield* db
        .selectFrom("app_public.gig_setlists")
        .select("gig_id")
        .where("setlist_id", "=", setlistId)
        .pipe(Effect.orDie)
      const result = yield* query(session)
      return { result, rooms: [setlistId, ...gigs.map((gig) => gig.gig_id)] }
    }),
  ).pipe(
    Effect.tap(({ rooms }) => announce(rooms)),
    Effect.map(({ result }) => result),
  )

/** Tells everyone watching each room that the session's user wrote it. */
export const announce = Effect.fn("Setlists.announce")(function*(rooms: ReadonlyArray<string>) {
  const hub = yield* LiveHub
  const auth = yield* Auth
  const session = yield* CurrentSession
  const me = yield* auth.getMe(session.sessionId).pipe(Effect.orElseSucceed(() => null))
  yield* Effect.forEach(rooms, (room) => hub.changed(room, me?.username ?? null))
})

/** The event stream of a setlist or gig. `visible` is the read that proves the caller may see it. */
export const watchRoom = <A, E, R>(roomId: string, client: string, visible: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    // Opening the stream is the visibility check; after that it holds no database connection.
    yield* visible
    const auth = yield* Auth
    const me = yield* auth.getMe(session.sessionId).pipe(Effect.orElseSucceed(() => null))
    if (!me) return yield* new SetlistForbidden({ message: "You must be signed in" })
    const hub = yield* LiveHub
    return hub.watch(roomId, {
      userId: me.id,
      viewer: { client, username: me.username, mode: "viewing", at: null },
    })
  })

/** Records what one of the caller's connections to a room is doing. */
export const reportInRoom = <A, E, R>(
  roomId: string,
  payload: (typeof LivePresence)["Type"],
  visible: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    yield* visible
    if (!session.userId || !(yield* (yield* LiveHub).report(roomId, session.userId, payload))) {
      return yield* new SetlistForbidden({ message: "That connection is not yours" })
    }
  })

export const assertBandMember = Effect.fnUntraced(function*(bandId: string) {
  if (!(yield* isBandMember(bandId))) {
    return yield* new SetlistForbidden({ message: "You are not a member of that band" })
  }
})

/**
 * Refuses a song outside `bandId`. RLS hides another band's songs, so a
 * foreign id is caught here before the resolved view could join its title.
 */
const assertBandSong = Effect.fnUntraced(function*(songId: string, bandId: string) {
  const db = yield* Kysely
  const forbidden = new SetlistForbidden({ message: "That song is not in this band" })
  const song = yield* db
    .selectFrom("app_public.songs")
    .select("band_id")
    .where("id", "=", songId)
    .pipe(Effect.head, Effect.catchTag("NoSuchElementError", () => Effect.fail(forbidden)))
  if (song.band_id !== bandId) return yield* forbidden
})

const lockSetlist = Effect.fnUntraced(function*(setlistId: string) {
  const db = yield* Kysely
  yield* db.selectFrom("app_public.setlists").select("id").where("id", "=", setlistId).forUpdate().pipe(Effect.orDie)
})

/**
 * Setlists with what the wire shape adds to the row: the gigs that play each
 * one (soonest first), its song count and its summed duration. The subqueries
 * run under the caller's policies like the rest of the query.
 */
const selectSetlists = Effect.fnUntraced(function*() {
  const db = yield* Kysely
  return db
    .selectFrom("app_public.setlists as s")
    .select([
      "s.id",
      "s.band_id",
      "s.name",
      "s.status",
      "s.created_at",
      "s.updated_at",
      sql<number>`(select count(*)::int from app_public.setlist_entries e where e.setlist_id = s.id)`.as("song_count"),
      sql<number>`(
        select coalesce(sum(songs.duration_seconds), 0)::int
        from app_public.setlist_entries e join app_public.songs on songs.id = e.song_id
        where e.setlist_id = s.id
      )`.as("duration_seconds"),
      sql`coalesce((
        select json_agg(json_build_object('id', g.id, 'venue', g.venue, 'gig_date', g.gig_date::text)
                        order by g.gig_date nulls last, g.id)
        from app_public.gig_setlists gs join app_public.gigs g on g.id = gs.gig_id
        where gs.setlist_id = s.id
      ), '[]'::json)`.as("gigs"),
    ])
})

/**
 * A setlist the caller may touch.
 *
 * RLS hides a setlist outside the caller's bands, so "missing" and "not yours"
 * are the same answer — the caller learns nothing about another band.
 *
 * The decode is where a schema mismatch (the server disagreeing with its own
 * schema) becomes a defect, so only the real 404 stays in the error channel.
 */
const setlistOr404 = Effect.fnUntraced(function*(id: string) {
  return yield* selectSetlists().pipe(
    Effect.flatMap((query) => query.where("s.id", "=", id)),
    Effect.head,
    Effect.catchTag("NoSuchElementError", () => Effect.fail(new SetlistNotFound({ id }))),
    Effect.flatMap((row) => decodeSetlist(row).pipe(Effect.orDie)),
  )
})

/** A setlist that was just written: a miss here is a server defect, not a caller error. */
const setlistOrDie = (id: string) => setlistOr404(id).pipe(Effect.orDie)

/** A new setlist named `name` with `source`'s songs and overrides, in no gig. Returns its id. */
export const copySetlist = Effect.fn("Setlists.copySetlist")(function*(source: { id: string; band_id: string }, name: string) {
  const db = yield* Kysely
  const copy = yield* db
    .insertInto("app_public.setlists")
    .values({ band_id: source.band_id, name })
    .returning("id")
    .pipe(Effect.head, Effect.orDie)
  // The entries keep their keys, so the copy plays in the same order.
  yield* db
    .insertInto("app_public.setlist_entries")
    .columns(["setlist_id", "song_id", "position_key", "key_override", "tempo_override", "notes_override"])
    .expression(
      db
        .selectFrom("app_public.setlist_entries")
        .select([
          sql<string>`${copy.id}::uuid`.as("setlist_id"),
          "song_id",
          "position_key",
          "key_override",
          "tempo_override",
          "notes_override",
        ])
        .where("setlist_id", "=", source.id),
    )
    .pipe(Effect.orDie)
  return copy.id
})

/**
 * The resolved view rows for one setlist, ordered for display. The view applies
 * the entry's overrides over the song's defaults, so the client never resolves
 * inheritance itself.
 */
const entriesFor = Effect.fnUntraced(function*(setlistId: string) {
  const db = yield* Kysely
  return yield* db
    .selectFrom("app_public.setlist_entries_resolved")
    .selectAll()
    .where("setlist_id", "=", setlistId)
    .orderBy("position_key", "asc")
    .orderBy("id", "asc")
    .pipe(Effect.flatMap((rows) => decodeEntryArray(rows).pipe(Effect.orDie)))
})

/** One entry, scoped to `setlistId` so the id alone cannot reach another band. */
const entryOr404 = Effect.fnUntraced(function*(entryId: string, setlistId: string) {
  const db = yield* Kysely
  return yield* db
    .selectFrom("app_public.setlist_entries_resolved")
    .selectAll()
    .where("id", "=", entryId)
    .where("setlist_id", "=", setlistId)
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () => Effect.fail(new SetlistNotFound({ id: setlistId }))),
      Effect.flatMap((row) => decodeEntry(row).pipe(Effect.orDie)),
    )
})
