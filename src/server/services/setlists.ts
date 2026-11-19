import { Context, Effect, Layer, Option, Predicate, Schema as S, Struct } from "effect"
import { sql, type Kysely } from "kysely"
import { requestDb } from "../db"
import type { DB } from "../../../generated/DB.js"
import { IdRow } from "../rows"
import { Auth } from "./auth"
import { Bands } from "./bands"
import { LiveHub, type Written } from "./liveHub"
import { between, placeAfter } from "../../components/position"
import {
  GigRef,
  LivePresence,
  Setlist,
  SetlistEntry,
  type Move,
  type SetlistEntryInsert,
  type SetlistEntryUpdate,
  type SetlistInsert,
  type SetlistUpdate,
} from "../../api/setlists"

export class SetlistMissing extends S.TaggedError<SetlistMissing, { readonly brand: unique symbol }>()(
  "SetlistMissing",
  { message: S.String, id: S.String },
) {}

export class SetlistRefused extends S.TaggedError<SetlistRefused, { readonly brand: unique symbol }>()(
  "SetlistRefused",
  { message: S.String },
) {}

/**
 * A band's setlists and their entries, read and written as the request's user.
 * Row-level security hides another band's setlists, so a missing one and a
 * foreign one are the same 404.
 *
 * A write returns a `Written`: its result, and the rooms to tell once it
 * commits — the setlist and every gig that plays it. A setlist and a gig are
 * each a room of the LiveHub; `watch` opens one and `report` updates a viewer.
 */
export class Setlists extends Context.Service<Setlists>()("giglist/setlists", {
  make: Effect.gen(function* () {
    const bands = yield* Bands
    const auth = yield* Auth
    const hub = yield* LiveHub

    const requireMember = Effect.fn("Setlists.requireMember")(function* (bandId: string) {
      if (!(yield* bands.isMember(bandId))) {
        return yield* new SetlistRefused({ message: "You are not a member of that band" })
      }
    })

    /** The signed-in user, read in the request's transaction. */
    const me = Effect.fn("Setlists.me")(function* () {
      return yield* auth
        .getMe()
        .pipe(Effect.filterOrFail(Predicate.isNotNull, () => new SetlistRefused({ message: "You must be signed in" })))
    })

    /**
     * Runs a write to the setlist, and names the rooms that show it. The gigs
     * are read before the write, so deleting the setlist still reaches them.
     */
    const writing = <A, E, R>(setlistId: string, write: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const gigs = yield* requestDb.all(S.Struct({ gig_id: S.String }), (k) =>
          k.selectFrom("app_public.gig_setlists").select("gig_id").where("setlist_id", "=", setlistId),
        )
        const result = yield* write
        return {
          result,
          rooms: [setlistId, ...gigs.map((gig) => gig.gig_id)],
          by: yield* writerName(),
        } satisfies Written<A>
      })

    /** The username of the request's user, read in the write's own transaction. */
    const writerName = Effect.fn("Setlists.writerName")(function* () {
      return (yield* auth.getMe())?.username ?? null
    })

    const list = Effect.fn("Setlists.list")(function* (bandId: string) {
      yield* requireMember(bandId)
      return yield* requestDb.all(Setlist, (k) =>
        selectSetlists(k).where("s.band_id", "=", bandId).orderBy("s.name").orderBy("s.id"),
      )
    })

    const create = Effect.fn("Setlists.create")(function* (payload: typeof SetlistInsert.Type) {
      yield* requireMember(payload.band_id)
      const inserted = yield* requestDb.one(IdRow, (k) =>
        k.insertInto("app_public.setlists").values({ band_id: payload.band_id, name: payload.name }).returning("id"),
      )
      return yield* setlistOrDie(inserted.id)
    })

    const update = Effect.fn("Setlists.update")(function* (id: string, payload: typeof SetlistUpdate.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* setlistOr404(id)
          // An empty SET is not valid SQL, and an empty payload changes nothing.
          if (Struct.keys(payload).length > 0) {
            yield* requestDb.exec((k) => k.updateTable("app_public.setlists").set(payload).where("id", "=", id))
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
      const created = yield* requestDb.one(IdRow, (k) =>
        k.insertInto("app_public.setlists").values({ band_id: source.band_id, name }).returning("id"),
      )
      // The entries keep their keys, so the copy plays in the same order.
      yield* requestDb.exec((k) =>
        k
          .insertInto("app_public.setlist_entries")
          .columns(["setlist_id", "song_id", "position_key", "key_override", "tempo_override", "notes_override"])
          .expression(
            k
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
          ),
      )
      return created.id
    })

    const remove = Effect.fn("Setlists.remove")(function* (id: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* setlistOr404(id)
          yield* requestDb.exec((k) => k.deleteFrom("app_public.setlists").where("id", "=", id))
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
          yield* lockSetlist(id)
          const setlist = yield* setlistOr404(id)
          yield* requireBandSong(payload.song_id, setlist.band_id)
          // A new entry plays last.
          const newest = yield* requestDb.maybe(S.Struct({ position_key: S.String }), (k) =>
            k
              .selectFrom("app_public.setlist_entries")
              .select("position_key")
              .where("setlist_id", "=", id)
              .orderBy("position_key", "desc")
              .orderBy("id", "desc"),
          )
          const last = Option.match(newest, {
            onNone: () => null,
            onSome: (row) => row.position_key,
          })
          const inserted = yield* requestDb.one(IdRow, (k) =>
            k
              .insertInto("app_public.setlist_entries")
              .values({
                setlist_id: id,
                song_id: payload.song_id,
                position_key: between(last, null),
              })
              .returning("id"),
          )
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
          const setlist = yield* setlistOr404(id)
          yield* entryOr404(entryId, id)
          if (payload.song_id !== undefined) yield* requireBandSong(payload.song_id, setlist.band_id)
          // An empty SET is not valid SQL, and an empty payload changes nothing.
          if (Struct.keys(payload).length > 0) {
            yield* requestDb.exec((k) =>
              k
                .updateTable("app_public.setlist_entries")
                .set(payload)
                .where("id", "=", entryId)
                .where("setlist_id", "=", id),
            )
          }
          return yield* entryOr404(entryId, id)
        }),
      )
    })

    const removeEntry = Effect.fn("Setlists.removeEntry")(function* (id: string, entryId: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* setlistOr404(id)
          yield* requestDb.exec((k) =>
            k.deleteFrom("app_public.setlist_entries").where("id", "=", entryId).where("setlist_id", "=", id),
          )
        }),
      )
    })

    const move = Effect.fn("Setlists.move")(function* (id: string, payload: typeof Move.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* setlistOr404(id)
          // Serialise all moves for one setlist before reading neighbour keys.
          yield* lockSetlist(id)
          const rows = yield* requestDb.all(S.Struct({ id: S.String, position_key: S.String }), (k) =>
            k
              .selectFrom("app_public.setlist_entries")
              .select(["id", "position_key"])
              .where("setlist_id", "=", id)
              .orderBy("position_key", "asc")
              .orderBy("id", "asc"),
          )
          const writes = rows.some((row) => row.id === payload.id)
            ? placeAfter(
                rows.filter((row) => row.id !== payload.id),
                payload.id,
                payload.previous,
              )
            : Option.none()
          if (Option.isNone(writes)) {
            return yield* new SetlistRefused({
              message: "That entry or neighbour is not in this setlist",
            })
          }
          yield* Effect.forEach(writes.value, (write) =>
            requestDb.exec((k) =>
              k
                .updateTable("app_public.setlist_entries")
                .set({ position_key: write.position_key })
                .where("id", "=", write.id),
            ),
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
      return hub.watch(id, viewing(yield* me(), client))
    })

    /** Records what one of the caller's connections to the setlist is doing. */
    const report = Effect.fn("Setlists.report")(function* (id: string, payload: typeof LivePresence.Type) {
      yield* setlistOr404(id)
      yield* reportAs(id, payload)
    })

    /** Records what the caller's connection to a room is doing; another user's connection is refused. */
    const reportAs = Effect.fn("Setlists.reportAs")(function* (roomId: string, payload: typeof LivePresence.Type) {
      const user = yield* auth.getMe()
      if (!user || !(yield* hub.report(roomId, user.id, payload))) {
        return yield* new SetlistRefused({ message: "That connection is not yours" })
      }
    })

    const get = Effect.fn("Setlists.get")(function* (id: string) {
      return yield* setlistOr404(id)
    })

    return {
      requireMember,
      me,
      writerName,
      reportAs,
      list,
      create,
      get,
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
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide([Bands.layer, Auth.layer, LiveHub.layer]))
}

/**
 * Refuses a song outside `bandId`. RLS hides another band's songs, so a
 * foreign id is caught here before the resolved view could join its title.
 */
const requireBandSong = Effect.fnUntraced(function* (songId: string, bandId: string) {
  const forbidden = new SetlistRefused({ message: "That song is not in this band" })
  const song = yield* requestDb.maybe(S.Struct({ band_id: S.String }), (k) =>
    k.selectFrom("app_public.songs").select("band_id").where("id", "=", songId),
  )
  if (Option.isNone(song) || song.value.band_id !== bandId) return yield* forbidden
})

const lockSetlist = Effect.fnUntraced(function* (setlistId: string) {
  yield* requestDb.exec((k) => k.selectFrom("app_public.setlists").select("id").where("id", "=", setlistId).forUpdate())
})

/**
 * Setlists with what the wire shape adds to the row: the gigs that play each
 * one (soonest first), its song count and its summed duration. The subqueries
 * run under the caller's policies like the rest of the query.
 */
const selectSetlists = (k: Kysely<DB>) =>
  k.selectFrom("app_public.setlists as s").select([
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
    sql<ReadonlyArray<typeof GigRef.Type>>`coalesce((
        select json_agg(json_build_object('id', g.id, 'venue', g.venue, 'gig_date', g.gig_date::text)
                        order by g.gig_date nulls last, g.id)
        from app_public.gig_setlists gs join app_public.gigs g on g.id = gs.gig_id
        where gs.setlist_id = s.id
      ), '[]'::json)`.as("gigs"),
  ])

/**
 * A setlist the caller may touch.
 *
 * RLS hides a setlist outside the caller's bands, so "missing" and "not yours"
 * are the same answer — the caller learns nothing about another band.
 *
 * The runner's row Schema is where a mismatch (the server disagreeing with its
 * own schema) becomes a defect, so only the real 404 stays in the error channel.
 */
const setlistOr404 = Effect.fnUntraced(function* (id: string) {
  const found = yield* requestDb.maybe(Setlist, (k) => selectSetlists(k).where("s.id", "=", id))
  return yield* Effect.fromOption(found, () => new SetlistMissing({ id, message: "That setlist was not found" }))
})

/** A setlist that was just written: a miss here is a server defect, not a caller error. */
const setlistOrDie = (id: string) => setlistOr404(id).pipe(Effect.catchTag("SetlistMissing", Effect.die))

/**
 * The resolved view rows for one setlist, ordered for display. The view applies
 * the entry's overrides over the song's defaults, so the client never resolves
 * inheritance itself.
 */
const entriesFor = (setlistId: string) =>
  requestDb.all(SetlistEntry, (k) =>
    k
      .selectFrom("app_public.setlist_entries_resolved")
      .selectAll()
      .where("setlist_id", "=", setlistId)
      .orderBy("position_key", "asc")
      .orderBy("id", "asc"),
  )

/** One entry, scoped to `setlistId` so the id alone cannot reach another band. */
const entryOr404 = Effect.fnUntraced(function* (entryId: string, setlistId: string) {
  const found = yield* requestDb.maybe(SetlistEntry, (k) =>
    k
      .selectFrom("app_public.setlist_entries_resolved")
      .selectAll()
      .where("id", "=", entryId)
      .where("setlist_id", "=", setlistId),
  )
  return yield* Effect.fromOption(
    found,
    () => new SetlistMissing({ id: setlistId, message: "That setlist was not found" }),
  )
})

/** A connection that has just opened a room, before it reports what it is doing. */
export const viewing = (user: { readonly id: string; readonly username: string }, client: string) => ({
  userId: user.id,
  viewer: { client, username: user.username, mode: "viewing" as const, at: null },
})
