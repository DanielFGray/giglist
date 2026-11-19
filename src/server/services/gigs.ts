import { Context, Effect, Layer, Option, Schema as S } from "effect"
import { sql, type Kysely } from "kysely"
import { requestDb } from "../db"
import type { DB } from "../../../generated/DB.js"
import { IdRow } from "../rows"
import { LiveHub, type Written } from "./liveHub"
import { Places } from "./places"
import { Setlists, viewing } from "./setlists"
import { between, placeAfter } from "../../components/position"
import {
  Gig,
  GigEntry,
  GigSetlist,
  Location,
  type GigDetails,
  type GigInsert,
  type GigSetlistInsert,
  type VenueSuggestion,
} from "../../api/gigs"
import { type LivePresence, type Move } from "../../api/setlists"

export class GigMissing extends S.TaggedError<GigMissing, { readonly brand: unique symbol }>()("GigMissing", {
  message: S.String,
  id: S.String,
}) {}

export class GigRefused extends S.TaggedError<GigRefused, { readonly brand: unique symbol }>()("GigRefused", {
  message: S.String,
}) {}

/**
 * A band's gigs and the setlists each plays, read and written as the request's
 * user. Row-level security makes "missing" and "another band's" the same 404.
 * A gig shares the setlists' errors, member check and live rooms.
 *
 * A write returns a `Written`: its result, and the rooms to tell once it
 * commits — the gig, and every setlist it played before or after the write,
 * since a setlist's page lists its gigs.
 */
export class Gigs extends Context.Service<Gigs>()("giglist/gigs", {
  make: Effect.gen(function* () {
    const setlists = yield* Setlists
    const hub = yield* LiveHub
    const places = yield* Places

    /** Runs a write to the gig, and names the rooms that show it. */
    const writing = <A, E, R>(gigId: string, write: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const before = yield* playedBy(gigId)
        const result = yield* write
        const after = yield* playedBy(gigId)
        return {
          result,
          rooms: [...new Set([gigId, ...before, ...after])],
          by: yield* setlists.writerName(),
        } satisfies Written<A>
      })

    const list = Effect.fn("Gigs.list")(function* (bandId: string) {
      yield* setlists.requireMember(bandId)
      return yield* requestDb.all(Gig, (k) =>
        selectGigs(k)
          .where("g.band_id", "=", bandId)
          .orderBy(sql`g.gig_date desc nulls last`)
          .orderBy("g.created_at", "desc"),
      )
    })

    /**
     * The venues to offer for `query`: the band's own first, then the map's
     * finds, nearest the band's gig closest to today first. A find with the
     * same name and address as one of the band's is the same place, so it
     * shows once.
     */
    const suggestVenues = Effect.fn("Gigs.suggestVenues")(function* (bandId: string, query: string) {
      yield* setlists.requireMember(bandId)
      const near = yield* bandPoint(bandId)
      const [played, found] = yield* Effect.all([bandVenues(bandId, query), places.search(query, near)], {
        concurrency: "unbounded",
      })
      const same = (v: { venue: string; address: string | null }) => `${v.venue.toLowerCase()}\n${v.address ?? ""}`
      const known = new Set(played.map(same))
      return [
        ...played.map((v): typeof VenueSuggestion.Type => ({ ...v, source: "band" })),
        ...found.filter((v) => !known.has(same(v))).map((v): typeof VenueSuggestion.Type => ({ ...v, source: "map" })),
      ]
    })

    const create = Effect.fn("Gigs.create")(function* (payload: typeof GigInsert.Type) {
      yield* setlists.requireMember(payload.band_id)
      const inserted = yield* requestDb.one(IdRow, (k) =>
        k.insertInto("app_public.gigs").values(withPoint(payload)).returning("id"),
      )
      return yield* gigOrDie(inserted.id)
    })

    const update = Effect.fn("Gigs.update")(function* (id: string, payload: typeof GigDetails.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* gigOr404(id)
          yield* requestDb.exec((k) => k.updateTable("app_public.gigs").set(withPoint(payload)).where("id", "=", id))
          return yield* gigOrDie(id)
        }),
      )
    })

    const remove = Effect.fn("Gigs.remove")(function* (id: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* gigOr404(id)
          yield* requestDb.exec((k) => k.deleteFrom("app_public.gigs").where("id", "=", id))
        }),
      )
    })

    const addSetlist = Effect.fn("Gigs.addSetlist")(function* (id: string, payload: typeof GigSetlistInsert.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* lockGig(id)
          const gig = yield* gigOr404(id)
          const forbidden = new GigRefused({ message: "That setlist is not in this band" })
          const setlist = yield* requestDb.maybe(S.Struct({ band_id: S.String }), (k) =>
            k.selectFrom("app_public.setlists").select("band_id").where("id", "=", payload.setlist_id),
          )
          if (Option.isNone(setlist) || setlist.value.band_id !== gig.band_id) return yield* forbidden
          if (gig.setlists.some((played) => played.id === payload.setlist_id)) {
            return yield* new GigRefused({ message: "This gig already plays that setlist" })
          }
          // A new setlist plays last.
          const newest = yield* requestDb.maybe(S.Struct({ position_key: S.String }), (k) =>
            k
              .selectFrom("app_public.gig_setlists")
              .select("position_key")
              .where("gig_id", "=", id)
              .orderBy("position_key", "desc")
              .orderBy("setlist_id", "desc"),
          )
          const last = Option.match(newest, {
            onNone: () => null,
            onSome: (row) => row.position_key,
          })
          yield* requestDb.exec((k) =>
            k.insertInto("app_public.gig_setlists").values({
              band_id: gig.band_id,
              gig_id: id,
              setlist_id: payload.setlist_id,
              position_key: between(last, null),
            }),
          )
          return yield* gigOrDie(id)
        }),
      )
    })

    const removeSetlist = Effect.fn("Gigs.removeSetlist")(function* (id: string, setlistId: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* gigOr404(id)
          yield* requestDb.exec((k) =>
            k.deleteFrom("app_public.gig_setlists").where("gig_id", "=", id).where("setlist_id", "=", setlistId),
          )
          return yield* gigOrDie(id)
        }),
      )
    })

    /** Puts a copy of one of the gig's setlists in its place, in this gig only. */
    const copySetlist = Effect.fn("Gigs.copySetlist")(function* (id: string, setlistId: string, name: string) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* lockGig(id)
          const gig = yield* gigOr404(id)
          if (!gig.setlists.some((played) => played.id === setlistId)) {
            return yield* new GigRefused({ message: "This gig does not play that setlist" })
          }
          const copy = yield* setlists.duplicate({ id: setlistId, band_id: gig.band_id }, name)
          // The copy takes the original's row, and so its place in the gig.
          yield* requestDb.exec((k) =>
            k
              .updateTable("app_public.gig_setlists")
              .set({ setlist_id: copy })
              .where("gig_id", "=", id)
              .where("setlist_id", "=", setlistId),
          )
          return yield* gigOrDie(id)
        }),
      )
    })

    const moveSetlist = Effect.fn("Gigs.moveSetlist")(function* (id: string, payload: typeof Move.Type) {
      return yield* writing(
        id,
        Effect.gen(function* () {
          yield* gigOr404(id)
          // Serialise all moves for one gig before reading neighbour keys.
          yield* lockGig(id)
          const rows = yield* requestDb.all(S.Struct({ id: S.String, position_key: S.String }), (k) =>
            k
              .selectFrom("app_public.gig_setlists")
              .select(["setlist_id as id", "position_key"])
              .where("gig_id", "=", id)
              .orderBy("position_key", "asc")
              .orderBy("setlist_id", "asc"),
          )
          const writes = rows.some((row) => row.id === payload.id)
            ? placeAfter(
                rows.filter((row) => row.id !== payload.id),
                payload.id,
                payload.previous,
              )
            : Option.none()
          if (Option.isNone(writes)) {
            return yield* new GigRefused({
              message: "That setlist or neighbour is not in this gig",
            })
          }
          yield* Effect.forEach(writes.value, (write) =>
            requestDb.exec((k) =>
              k
                .updateTable("app_public.gig_setlists")
                .set({ position_key: write.position_key })
                .where("gig_id", "=", id)
                .where("setlist_id", "=", write.id),
            ),
          )
          return yield* gigOrDie(id)
        }),
      )
    })

    /** Every entry of every setlist the gig plays, in playing order, each with its setlist's name. */
    const entries = Effect.fn("Gigs.entries")(function* (id: string) {
      yield* gigOr404(id)
      return yield* requestDb.all(GigEntry, (k) =>
        k
          .selectFrom("app_public.setlist_entries_resolved as r")
          .innerJoin("app_public.gig_setlists as gs", "gs.setlist_id", "r.setlist_id")
          .innerJoin("app_public.setlists as s", "s.id", "r.setlist_id")
          .selectAll("r")
          .select("s.name as setlist_name")
          .where("gs.gig_id", "=", id)
          .orderBy("gs.position_key")
          .orderBy("gs.setlist_id")
          .orderBy("r.position_key")
          .orderBy("r.id"),
      )
    })

    /** The gig's event stream; see `Setlists.watch`. */
    const watch = Effect.fn("Gigs.watch")(function* (id: string, client: string) {
      yield* gigOr404(id)
      return hub.watch(id, viewing(yield* setlists.me(), client))
    })

    /** Records what one of the caller's connections to the gig is doing. */
    const report = Effect.fn("Gigs.report")(function* (id: string, payload: typeof LivePresence.Type) {
      yield* gigOr404(id)
      yield* setlists.reportAs(id, payload)
    })

    const get = Effect.fn("Gigs.get")(function* (id: string) {
      return yield* gigOr404(id)
    })

    return {
      list,
      suggestVenues,
      create,
      get,
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
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide([Setlists.layer, LiveHub.layer, Places.layer]),
  )
}

/** The ids of the setlists a gig plays. */
const playedBy = Effect.fnUntraced(function* (gigId: string) {
  const rows = yield* requestDb.all(S.Struct({ setlist_id: S.String }), (k) =>
    k.selectFrom("app_public.gig_setlists").select("setlist_id").where("gig_id", "=", gigId),
  )
  return rows.map((row) => row.setlist_id)
})

const lockGig = Effect.fnUntraced(function* (gigId: string) {
  yield* requestDb.exec((k) => k.selectFrom("app_public.gigs").select("id").where("id", "=", gigId).forUpdate())
})

/**
 * Gigs with the setlists each plays, in order, with their song counts,
 * durations and how many gigs play them. `gig_date` and the times are cast
 * to text so the driver's `Date` does not shift them across time zones; the
 * times stay the venue's wall-clock `HH:MM:SS`.
 */
const selectGigs = (k: Kysely<DB>) =>
  k.selectFrom("app_public.gigs as g").select([
    "g.id",
    "g.band_id",
    "g.venue",
    sql<string | null>`g.gig_date::text`.as("gig_date"),
    "g.address",
    location("g").as("location"),
    sql<string | null>`g.load_in_time::text`.as("load_in_time"),
    sql<string | null>`g.performance_time::text`.as("performance_time"),
    "g.notes",
    "g.created_at",
    "g.updated_at",
    sql<ReadonlyArray<typeof GigSetlist.Type>>`coalesce((
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

/** A gig the caller may touch; RLS makes "missing" and "another band's" the same 404. */
const gigOr404 = Effect.fnUntraced(function* (id: string) {
  const found = yield* requestDb.maybe(Gig, (k) => selectGigs(k).where("g.id", "=", id))
  return yield* Effect.fromOption(found, () => new GigMissing({ id, message: "That gig was not found" }))
})

/** A gig that was just written: a miss here is a server defect, not a caller error. */
const gigOrDie = (id: string) => gigOr404(id).pipe(Effect.catchTag("GigMissing", Effect.die))

/** A gig's details as the table's columns: the table keeps `location` as two. */
const withPoint = <A extends { readonly location: typeof Location.Type | null }>({ location: point, ...rest }: A) => ({
  ...rest,
  latitude: point?.latitude ?? null,
  longitude: point?.longitude ?? null,
})

/** The `location` of the gig row `table`, as a `Location` object or null. */
const location = (table: string) =>
  sql<typeof Location.Type | null>`case when ${sql.ref(`${table}.latitude`)} is null then null
    else json_build_object('latitude', ${sql.ref(`${table}.latitude`)}, 'longitude', ${sql.ref(`${table}.longitude`)}) end`

/**
 * Where the band plays now: the point of its gig closest to today that has
 * one, or null when no gig does.
 */
const bandPoint = Effect.fnUntraced(function* (bandId: string) {
  const point = yield* requestDb.maybe(Location, (k) =>
    k
      .selectFrom("app_public.gigs")
      .select(["latitude", "longitude"])
      .$narrowType<{ latitude: number; longitude: number }>()
      .where("band_id", "=", bandId)
      .where("latitude", "is not", null)
      .orderBy(sql`abs(gig_date - current_date) nulls last`)
      .orderBy("updated_at", "desc")
      .limit(1),
  )
  return Option.getOrNull(point)
})

const BandVenueRow = S.Struct({
  venue: S.String,
  address: S.NullOr(S.String),
  location: S.NullOr(Location),
})

/**
 * Up to five venues the band has played whose name contains `query`, ignoring
 * case: names that start with it first, then the most recently played. Each
 * venue shows once, with the address and point of its latest gig that saved
 * an address.
 */
const bandVenues = Effect.fnUntraced(function* (bandId: string, query: string) {
  return yield* requestDb.all(BandVenueRow, (k) => {
    const latest = k
      .selectFrom("app_public.gigs")
      .distinctOn(sql`lower(venue)`)
      .select(["venue", "address", "latitude", "longitude"])
      .select(sql<string | null>`max(gig_date) over (partition by lower(venue))`.as("last_played"))
      .where("band_id", "=", bandId)
      .where(sql<number>`strpos(lower(venue), lower(${query}))`, ">", 0)
      .orderBy(sql`lower(venue)`)
      .orderBy(sql`address is null`)
      .orderBy(sql`gig_date desc nulls last`)
      .orderBy("created_at", "desc")
    return (
      k
        .selectFrom(latest.as("v"))
        .select(["v.venue", "v.address", location("v").as("location")])
        // The query keeps only rows whose venue contains the text, so the venue is not null.
        .$narrowType<{ venue: string }>()
        .orderBy(sql`starts_with(lower(v.venue), lower(${query})) desc`)
        .orderBy(sql`v.last_played desc nulls last`)
        .orderBy("v.venue")
        .limit(5)
    )
  })
})
