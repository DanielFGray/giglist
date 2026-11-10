import { Context, Effect, Layer, Option, Schema as S } from "effect"
import { sql } from "kysely"
import { RequestDatabase } from "../db"
import { LiveHub, type Written } from "./live-hub"
import { Setlists, viewing } from "./setlists"
import { between, placeAfter } from "../../components/position"
import {
  Gig,
  GigEntry,
  GigNotFound,
  SetlistForbidden,
  type GigDetails,
  type GigInsert,
  type GigSetlistInsert,
  type LivePresence,
  type Move,
} from "../../api/contracts"

const decodeGig = S.decodeUnknownEffect(Gig)
const decodeGigs = S.decodeUnknownEffect(S.Array(Gig))
const decodeGigEntries = S.decodeUnknownEffect(S.Array(GigEntry))

/**
 * A band's gigs and the setlists each plays, read and written as the request's
 * user. Row-level security makes "missing" and "another band's" the same 404.
 * A gig shares the setlists' errors, member check and live rooms.
 *
 * A write returns a `Written`: its result, and the rooms to tell once it
 * commits — the gig, and every setlist it played before or after the write,
 * since a setlist's page lists its gigs.
 */
export class Gigs extends Context.Service<Gigs>()("setlist/Gigs", {
  make: Effect.gen(function* () {
    const setlists = yield* Setlists
    const hub = yield* LiveHub

    /** Runs a write to the gig, and names the rooms that show it. */
    const writing = <A, E, R>(gigId: string, write: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const before = yield* playedBy(gigId)
        const result = yield* write
        const after = yield* playedBy(gigId)
        return {
          result,
          rooms: [...new Set([gigId, ...before, ...after])],
          by: yield* setlists.writerName,
        } satisfies Written<A>
      })

    const list = Effect.fn("Gigs.list")(function* (bandId: string) {
      yield* setlists.requireMember(bandId)
      return yield* selectGigs().pipe(
        Effect.flatMap((query) =>
          query
            .where("g.band_id", "=", bandId)
            .orderBy(sql`g.gig_date desc nulls last`)
            .orderBy("g.created_at", "desc"),
        ),
        Effect.flatMap(decodeGigs),
        Effect.orDie,
      )
    })

    const create = Effect.fn("Gigs.create")(function* (payload: typeof GigInsert.Type) {
      const db = yield* RequestDatabase
      yield* setlists.requireMember(payload.band_id)
      const inserted = yield* db.insertInto("app_public.gigs").values(payload).returning("id").pipe(Effect.head, Effect.orDie)
      return yield* gigOrDie(inserted.id)
    })

    const update = Effect.fn("Gigs.update")(function* (id: string, payload: typeof GigDetails.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* gigOr404(id)
          yield* db.updateTable("app_public.gigs").set(payload).where("id", "=", id).pipe(Effect.orDie)
          return yield* gigOrDie(id)
        }),
      )
    })

    const remove = Effect.fn("Gigs.remove")(function* (id: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* gigOr404(id)
          yield* db.deleteFrom("app_public.gigs").where("id", "=", id).pipe(Effect.orDie)
        }),
      )
    })

    const addSetlist = Effect.fn("Gigs.addSetlist")(function* (id: string, payload: typeof GigSetlistInsert.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* lockGig(id)
          const gig = yield* gigOr404(id)
          const forbidden = new SetlistForbidden({ message: "That setlist is not in this band" })
          const setlist = yield* db
            .selectFrom("app_public.setlists")
            .select("band_id")
            .where("id", "=", payload.setlist_id)
            .pipe(Effect.head, Effect.catchTag("NoSuchElementError", () => Effect.fail(forbidden)))
          if (setlist.band_id !== gig.band_id) return yield* forbidden
          if (gig.setlists.some((played) => played.id === payload.setlist_id)) {
            return yield* new SetlistForbidden({ message: "This gig already plays that setlist" })
          }
          // A new setlist plays last.
          const last = yield* db
            .selectFrom("app_public.gig_setlists")
            .select("position_key")
            .where("gig_id", "=", id)
            .orderBy("position_key", "desc")
            .orderBy("setlist_id", "desc")
            .pipe(
              Effect.head,
              Effect.map((row) => row.position_key),
              Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)),
            )
          yield* db
            .insertInto("app_public.gig_setlists")
            .values({ band_id: gig.band_id, gig_id: id, setlist_id: payload.setlist_id, position_key: between(last, null) })
            .pipe(Effect.orDie)
          return yield* gigOrDie(id)
        }),
      )
    })

    const removeSetlist = Effect.fn("Gigs.removeSetlist")(function* (id: string, setlistId: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* gigOr404(id)
          yield* db
            .deleteFrom("app_public.gig_setlists")
            .where("gig_id", "=", id)
            .where("setlist_id", "=", setlistId)
            .pipe(Effect.orDie)
          return yield* gigOrDie(id)
        }),
      )
    })

    /** Puts a copy of one of the gig's setlists in its place, in this gig only. */
    const copySetlist = Effect.fn("Gigs.copySetlist")(function* (id: string, setlistId: string, name: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* lockGig(id)
          const gig = yield* gigOr404(id)
          if (!gig.setlists.some((played) => played.id === setlistId)) {
            return yield* new SetlistForbidden({ message: "This gig does not play that setlist" })
          }
          const copy = yield* setlists.duplicate({ id: setlistId, band_id: gig.band_id }, name)
          // The copy takes the original's row, and so its place in the gig.
          yield* db
            .updateTable("app_public.gig_setlists")
            .set({ setlist_id: copy })
            .where("gig_id", "=", id)
            .where("setlist_id", "=", setlistId)
            .pipe(Effect.orDie)
          return yield* gigOrDie(id)
        }),
      )
    })

    const moveSetlist = Effect.fn("Gigs.moveSetlist")(function* (id: string, payload: typeof Move.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          yield* gigOr404(id)
          // Serialise all moves for one gig before reading neighbour keys.
          yield* lockGig(id)
          const rows = yield* db
            .selectFrom("app_public.gig_setlists")
            .select(["setlist_id as id", "position_key"])
            .where("gig_id", "=", id)
            .orderBy("position_key", "asc")
            .orderBy("setlist_id", "asc")
            .pipe(Effect.orDie)
          const writes = rows.some((row) => row.id === payload.id)
            ? placeAfter(rows.filter((row) => row.id !== payload.id), payload.id, payload.previous)
            : Option.none()
          if (Option.isNone(writes)) {
            return yield* new SetlistForbidden({ message: "That setlist or neighbour is not in this gig" })
          }
          yield* Effect.forEach(writes.value, (write) =>
            db
              .updateTable("app_public.gig_setlists")
              .set({ position_key: write.position_key })
              .where("gig_id", "=", id)
              .where("setlist_id", "=", write.id)
              .pipe(Effect.orDie),
          )
          return yield* gigOrDie(id)
        }),
      )
    })

    /** Every entry of every setlist the gig plays, in playing order, each with its setlist's name. */
    const entries = Effect.fn("Gigs.entries")(function* (id: string) {
      const db = yield* RequestDatabase
      yield* gigOr404(id)
      return yield* db
        .selectFrom("app_public.setlist_entries_resolved as r")
        .innerJoin("app_public.gig_setlists as gs", "gs.setlist_id", "r.setlist_id")
        .innerJoin("app_public.setlists as s", "s.id", "r.setlist_id")
        .selectAll("r")
        .select("s.name as setlist_name")
        .where("gs.gig_id", "=", id)
        .orderBy("gs.position_key")
        .orderBy("gs.setlist_id")
        .orderBy("r.position_key")
        .orderBy("r.id")
        .pipe(Effect.flatMap(decodeGigEntries), Effect.orDie)
    })

    /** The gig's event stream; see `Setlists.watch`. */
    const watch = Effect.fn("Gigs.watch")(function* (id: string, client: string) {
      yield* gigOr404(id)
      return hub.watch(id, viewing(yield* setlists.me, client))
    })

    /** Records what one of the caller's connections to the gig is doing. */
    const report = Effect.fn("Gigs.report")(function* (id: string, payload: typeof LivePresence.Type) {
      yield* gigOr404(id)
      yield* setlists.reportAs(id, payload)
    })

    return {
      list,
      create,
      get: gigOr404,
      update,
      remove,
      addSetlist,
      removeSetlist,
      copySetlist,
      moveSetlist,
      entries,
      watch,
      report,
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide([Setlists.layer, LiveHub.layer]))
}

/** The ids of the setlists a gig plays. */
const playedBy = Effect.fnUntraced(function* (gigId: string) {
  const db = yield* RequestDatabase
  const rows = yield* db.selectFrom("app_public.gig_setlists").select("setlist_id").where("gig_id", "=", gigId).pipe(Effect.orDie)
  return rows.map((row) => row.setlist_id)
})

const lockGig = Effect.fnUntraced(function* (gigId: string) {
  const db = yield* RequestDatabase
  yield* db.selectFrom("app_public.gigs").select("id").where("id", "=", gigId).forUpdate().pipe(Effect.orDie)
})

/**
 * Gigs with the setlists each plays, in order, with their song counts,
 * durations and how many gigs play them. `gig_date` and the times are cast
 * to text so the driver's `Date` does not shift them across time zones; the
 * times stay the venue's wall-clock `HH:MM:SS`.
 */
const selectGigs = Effect.fnUntraced(function* () {
  const db = yield* RequestDatabase
  return db
    .selectFrom("app_public.gigs as g")
    .select([
      "g.id",
      "g.band_id",
      "g.venue",
      sql<string | null>`g.gig_date::text`.as("gig_date"),
      "g.address",
      sql<string | null>`g.load_in_time::text`.as("load_in_time"),
      sql<string | null>`g.performance_time::text`.as("performance_time"),
      "g.notes",
      "g.created_at",
      "g.updated_at",
      sql`coalesce((
        select json_agg(json_build_object(
          'id', s.id,
          'name', s.name,
          'song_count', (select count(*) from app_public.setlist_entries e where e.setlist_id = s.id),
          'duration_seconds', (
            select coalesce(sum(songs.duration_seconds), 0)
            from app_public.setlist_entries e join app_public.songs on songs.id = e.song_id
            where e.setlist_id = s.id
          ),
          'gig_count', (select count(*) from app_public.gig_setlists other where other.setlist_id = s.id)
        ) order by gs.position_key, gs.setlist_id)
        from app_public.gig_setlists gs join app_public.setlists s on s.id = gs.setlist_id
        where gs.gig_id = g.id
      ), '[]'::json)`.as("setlists"),
    ])
})

/** A gig the caller may touch; RLS makes "missing" and "another band's" the same 404. */
const gigOr404 = Effect.fnUntraced(function* (id: string) {
  return yield* selectGigs().pipe(
    Effect.flatMap((query) => query.where("g.id", "=", id)),
    Effect.head,
    Effect.catchTag("NoSuchElementError", () => Effect.fail(new GigNotFound({ id }))),
    Effect.flatMap((row) => decodeGig(row).pipe(Effect.orDie)),
  )
})

/** A gig that was just written: a miss here is a server defect, not a caller error. */
const gigOrDie = (id: string) => gigOr404(id).pipe(Effect.orDie)
