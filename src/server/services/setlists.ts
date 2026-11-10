import { Context, Effect, Layer, Option, Predicate, Schema as S, Struct } from "effect"
import { sql } from "kysely"
import { RequestDatabase } from "../db"
import { Auth } from "./auth"
import { Bands } from "./band"
import { LiveHub, type Written } from "./live-hub"
import { between, placeAfter } from "../../components/position"
import { LivePresence, Setlist, SetlistEntry, SetlistForbidden, SetlistNotFound, type Move, type SetlistEntryInsert, type SetlistEntryUpdate, type SetlistInsert, type SetlistUpdate } from "../../api/setlists"

const decodeSetlist = S.decodeUnknownEffect(Setlist)
const decodeSetlists = S.decodeUnknownEffect(S.Array(Setlist))
const decodeEntry = S.decodeUnknownEffect(SetlistEntry)
const decodeEntries = S.decodeUnknownEffect(S.Array(SetlistEntry))

/**
 * A band's setlists and their entries, read and written as the request's user.
 * Row-level security hides another band's setlists, so a missing one and a
 * foreign one are the same 404.
 *
 * A write returns a `Written`: its result, and the rooms to tell once it
 * commits — the setlist and every gig that plays it. A setlist and a gig are
 * each a room of the LiveHub; `watch` opens one and `report` updates a viewer.
 */
export class Setlists extends Context.Service<Setlists>()("giglist/Setlists", {
  make: Effect.gen(function* () {
    const bands = yield* Bands
    const auth = yield* Auth
    const hub = yield* LiveHub

    const requireMember = Effect.fnUntraced(function* (bandId: string) {
      if (!(yield* bands.isMember(bandId))) {
        return yield* new SetlistForbidden({ message: "You are not a member of that band" })
      }
    })

    /** The signed-in user, read in the request's transaction. */
    const me = auth.getMe().pipe(
      Effect.filterOrFail(Predicate.isNotNull, () => new SetlistForbidden({ message: "You must be signed in" })),
    )

    /**
     * Runs a write to the setlist, and names the rooms that show it. The gigs
     * are read before the write, so deleting the setlist still reaches them.
     */
    const writing = <A, E, R>(setlistId: string, write: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const db = yield* RequestDatabase
        const gigs = yield* db
          .selectFrom("app_public.gig_setlists")
          .select("gig_id")
          .where("setlist_id", "=", setlistId)
          .pipe(Effect.orDie)
        const result = yield* write
        return {
          result,
          rooms: [setlistId, ...gigs.map((gig) => gig.gig_id)],
          by: yield* writerName,
        } satisfies Written<A>
      })

    /** The username of the request's user, read in the write's own transaction. */
    const writerName = auth.getMe().pipe(Effect.map((user) => user?.username ?? null))

    const list = Effect.fn("Setlists.list")(function* (bandId: string) {
      yield* requireMember(bandId)
      const rows = yield* selectSetlists().pipe(
        Effect.flatMap((query) => query.where("s.band_id", "=", bandId).orderBy("s.name").orderBy("s.id")),
      )
      return yield* decodeSetlists(rows).pipe(Effect.orDie)
    })

    const create = Effect.fn("Setlists.create")(function* (payload: typeof SetlistInsert.Type) {
      const db = yield* RequestDatabase
      yield* requireMember(payload.band_id)
      const inserted = yield* db
        .insertInto("app_public.setlists")
        .values({ band_id: payload.band_id, name: payload.name })
        .returning("id")
        .pipe(Effect.head, Effect.orDie)
      return yield* setlistOrDie(inserted.id)
    })

    const update = Effect.fn("Setlists.update")(function* (id: string, payload: typeof SetlistUpdate.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* setlistOr404(id)
          // An empty SET is not valid SQL, and an empty payload changes nothing.
          if (Struct.keys(payload).length > 0) {
            yield* db.updateTable("app_public.setlists").set(payload).where("id", "=", id).pipe(Effect.orDie)
          }
          return yield* setlistOrDie(id)
        }),
      )
    })

    /** A new setlist named `name` with the setlist's songs and overrides, in no gig. */
    const copy = Effect.fn("Setlists.copy")(function* (id: string, name: string) {
      const source = yield* setlistOr404(id)
      return yield* setlistOrDie(yield* duplicate(source, name))
    })

    /**
     * Copies `source`'s entries, keys included, into a new setlist named `name`
     * in no gig, and returns its id. The caller has already checked `source`.
     */
    const duplicate = Effect.fn("Setlists.duplicate")(function* (
      source: { id: string; band_id: string },
      name: string,
    ) {
      const db = yield* RequestDatabase
      const created = yield* db
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
              sql<string>`${created.id}::uuid`.as("setlist_id"),
              "song_id",
              "position_key",
              "key_override",
              "tempo_override",
              "notes_override",
            ])
            .where("setlist_id", "=", source.id),
        )
        .pipe(Effect.orDie)
      return created.id
    })

    const remove = Effect.fn("Setlists.remove")(function* (id: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* setlistOr404(id)
          yield* db.deleteFrom("app_public.setlists").where("id", "=", id).pipe(Effect.orDie)
        }),
      )
    })

    const entries = Effect.fn("Setlists.entries")(function* (id: string) {
      yield* setlistOr404(id)
      return yield* entriesFor(id)
    })

    const addEntry = Effect.fn("Setlists.addEntry")(function* (id: string, payload: typeof SetlistEntryInsert.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* lockSetlist(id)
          const setlist = yield* setlistOr404(id)
          yield* requireBandSong(payload.song_id, setlist.band_id)
          // A new entry plays last.
          const last = yield* db
            .selectFrom("app_public.setlist_entries")
            .select("position_key")
            .where("setlist_id", "=", id)
            .orderBy("position_key", "desc")
            .orderBy("id", "desc")
            .pipe(
              Effect.head,
              Effect.map((row) => row.position_key),
              Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)),
            )
          const inserted = yield* db
            .insertInto("app_public.setlist_entries")
            .values({ setlist_id: id, song_id: payload.song_id, position_key: between(last, null) })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)
          return yield* entryOr404(inserted.id, id)
        }),
      )
    })

    const updateEntry = Effect.fn("Setlists.updateEntry")(function* (
      id: string,
      entryId: string,
      payload: typeof SetlistEntryUpdate.Type,
    ) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          const setlist = yield* setlistOr404(id)
          yield* entryOr404(entryId, id)
          if (payload.song_id !== undefined) yield* requireBandSong(payload.song_id, setlist.band_id)
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
      )
    })

    const removeEntry = Effect.fn("Setlists.removeEntry")(function* (id: string, entryId: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* setlistOr404(id)
          yield* db
            .deleteFrom("app_public.setlist_entries")
            .where("id", "=", entryId)
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)
        }),
      )
    })

    const move = Effect.fn("Setlists.move")(function* (id: string, payload: typeof Move.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
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
      )
    })

    /**
     * The setlist's event stream. Reading the setlist proves the caller may
     * see it; the stream holds no database connection, and runs after the
     * request's transaction ends.
     */
    const watch = Effect.fn("Setlists.watch")(function* (id: string, client: string) {
      yield* setlistOr404(id)
      return hub.watch(id, viewing(yield* me, client))
    })

    /** Records what one of the caller's connections to the setlist is doing. */
    const report = Effect.fn("Setlists.report")(function* (id: string, payload: typeof LivePresence.Type) {
      yield* setlistOr404(id)
      yield* reportAs(id, payload)
    })

    /** Records what the caller's connection to a room is doing; another user's connection is refused. */
    const reportAs = Effect.fnUntraced(function* (roomId: string, payload: typeof LivePresence.Type) {
      const user = yield* auth.getMe()
      if (!user || !(yield* hub.report(roomId, user.id, payload))) {
        return yield* new SetlistForbidden({ message: "That connection is not yours" })
      }
    })

    return {
      requireMember,
      me,
      writerName,
      reportAs,
      list,
      create,
      get: setlistOr404,
      update,
      copy,
      duplicate,
      remove,
      entries,
      addEntry,
      updateEntry,
      removeEntry,
      move,
      watch,
      report,
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide([Bands.layer, Auth.layer, LiveHub.layer]),
  )
}

/**
 * Refuses a song outside `bandId`. RLS hides another band's songs, so a
 * foreign id is caught here before the resolved view could join its title.
 */
const requireBandSong = Effect.fnUntraced(function* (songId: string, bandId: string) {
  const db = yield* RequestDatabase
  const forbidden = new SetlistForbidden({ message: "That song is not in this band" })
  const song = yield* db
    .selectFrom("app_public.songs")
    .select("band_id")
    .where("id", "=", songId)
    .pipe(Effect.head, Effect.catchTag("NoSuchElementError", () => Effect.fail(forbidden)))
  if (song.band_id !== bandId) return yield* forbidden
})

const lockSetlist = Effect.fnUntraced(function* (setlistId: string) {
  const db = yield* RequestDatabase
  yield* db.selectFrom("app_public.setlists").select("id").where("id", "=", setlistId).forUpdate().pipe(Effect.orDie)
})

/**
 * Setlists with what the wire shape adds to the row: the gigs that play each
 * one (soonest first), its song count and its summed duration. The subqueries
 * run under the caller's policies like the rest of the query.
 */
const selectSetlists = Effect.fnUntraced(function* () {
  const db = yield* RequestDatabase
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
const setlistOr404 = Effect.fnUntraced(function* (id: string) {
  return yield* selectSetlists().pipe(
    Effect.flatMap((query) => query.where("s.id", "=", id)),
    Effect.head,
    Effect.catchTag("NoSuchElementError", () => Effect.fail(new SetlistNotFound({ id }))),
    Effect.flatMap((row) => decodeSetlist(row).pipe(Effect.orDie)),
  )
})

/** A setlist that was just written: a miss here is a server defect, not a caller error. */
const setlistOrDie = (id: string) => setlistOr404(id).pipe(Effect.orDie)

/**
 * The resolved view rows for one setlist, ordered for display. The view applies
 * the entry's overrides over the song's defaults, so the client never resolves
 * inheritance itself.
 */
const entriesFor = Effect.fnUntraced(function* (setlistId: string) {
  const db = yield* RequestDatabase
  return yield* db
    .selectFrom("app_public.setlist_entries_resolved")
    .selectAll()
    .where("setlist_id", "=", setlistId)
    .orderBy("position_key", "asc")
    .orderBy("id", "asc")
    .pipe(Effect.flatMap((rows) => decodeEntries(rows).pipe(Effect.orDie)))
})

/** One entry, scoped to `setlistId` so the id alone cannot reach another band. */
const entryOr404 = Effect.fnUntraced(function* (entryId: string, setlistId: string) {
  const db = yield* RequestDatabase
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

/** A connection that has just opened a room, before it reports what it is doing. */
export const viewing = (user: { readonly id: string; readonly username: string }, client: string) => ({
  userId: user.id,
  viewer: { client, username: user.username, mode: "viewing" as const, at: null },
})
