import { Effect, Schema as S } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { sql } from "kysely"
import { Kysely, withAuthContext } from "../db"
import { SetlistHub } from "../services/setlist-hub"
import * as Auth from "../services/auth"
import { isBandMember } from "./scope"
import {
  SetListApi,
  CurrentSession,
  Setlist,
  SetlistEntry,
  SetlistForbidden,
  SetlistNotFound,
  SetlistSection,
  type SessionData,
} from "../../api/contracts"

const decodeSetlist = S.decodeUnknownEffect(Setlist)
const decodeSetlistArray = S.decodeUnknownEffect(S.Array(Setlist))
const decodeEntry = S.decodeUnknownEffect(SetlistEntry)
const decodeEntryArray = S.decodeUnknownEffect(S.Array(SetlistEntry))
const decodeSection = S.decodeUnknownEffect(SetlistSection)
const decodeSectionArray = S.decodeUnknownEffect(S.Array(SetlistSection))

/** Positions are renumbered in steps of this size whenever an arrangement is stored. */
const POSITION_STEP = 1000

/**
 * The setlist columns the wire shape needs. `gig_date` is cast to text so the
 * driver's `Date` does not shift the date across time zones.
 */
const SETLIST_SELECT = [
  "id",
  "band_id",
  "name",
  "description",
  sql<string | null>`gig_date::text`.as("gig_date"),
  "status",
  "created_at",
  "updated_at",
] as const

/** The pg driver hands back timestamps as Date; the wire schema uses strings. */
const toSetlistWire = <T extends { created_at: unknown; updated_at: unknown }>(
  row: T,
) => ({
  ...row,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at),
})

const assertBandMember = Effect.fnUntraced(function*(bandId: string) {
  if (!(yield* isBandMember(bandId))) {
    return yield* new SetlistForbidden({ message: "You are not a member of that band" })
  }
})

/** Run `query` as the session's user, or answer 403 if there is no session. */
const asSession = <A, E>(query: (session: SessionData) => Effect.Effect<A, E, Kysely>) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    if (!session.sessionId) {
      return yield* new SetlistForbidden({ message: "You must be signed in" })
    }
    return yield* query(session).pipe(withAuthContext(session.sessionId))
  })

/** Run a write as the session's user, then tell everyone watching the setlist that it changed. */
const asWriter = <A, E>(setlistId: string, query: (session: SessionData) => Effect.Effect<A, E, Kysely>) =>
  asSession(query).pipe(Effect.tap(() => announceChange(setlistId)))

const announceChange = Effect.fnUntraced(function*(setlistId: string) {
  const hub = yield* SetlistHub
  const session = yield* CurrentSession
  const me = yield* Auth.getMe(session.sessionId).pipe(Effect.orElseSucceed(() => null))
  yield* hub.changed(setlistId, me?.username ?? null)
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
  const db = yield* Kysely
  return yield* db
    .selectFrom("app_public.setlists")
    .select(SETLIST_SELECT)
    .where("id", "=", id)
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () => Effect.fail(new SetlistNotFound({ id }))),
      Effect.flatMap((row) => decodeSetlist(toSetlistWire(row)).pipe(Effect.orDie)),
    )
})

/** A setlist that was just written: a miss here is a server defect, not a caller error. */
const setlistOrDie = (id: string) => setlistOr404(id).pipe(Effect.orDie)

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
    .orderBy("position", "asc")
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
      Effect.catchTag("NoSuchElementError", () =>
        Effect.fail(new SetlistNotFound({ id: setlistId })),
      ),
      Effect.flatMap((row) => decodeEntry(row).pipe(Effect.orDie)),
    )
})

const SECTION_COLUMNS = ["id", "setlist_id", "name", "position"] as const

/** One section, scoped to `setlistId` so the id alone cannot reach another band's setlist. */
const sectionOr404 = Effect.fnUntraced(function*(sectionId: string, setlistId: string) {
  const db = yield* Kysely
  return yield* db
    .selectFrom("app_public.setlist_sections")
    .select(SECTION_COLUMNS)
    .where("id", "=", sectionId)
    .where("setlist_id", "=", setlistId)
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () => Effect.fail(new SetlistNotFound({ id: setlistId }))),
      Effect.flatMap((row) => decodeSection(row).pipe(Effect.orDie)),
    )
})

export const setlistsHandlers = HttpApiBuilder.group(SetListApi, "setlists", (handlers) =>
  handlers
    .handle("listSetlists", ({ params: { bandId } }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertBandMember(bandId)
          return yield* db
            .selectFrom("app_public.setlists")
            .select(SETLIST_SELECT)
            .where("band_id", "=", bandId)
            .orderBy(sql`gig_date desc nulls last`)
            .orderBy("created_at", "desc")
            .pipe(
              Effect.map((rows) => rows.map(toSetlistWire)),
              Effect.flatMap((rows) => decodeSetlistArray(rows).pipe(Effect.orDie)),
            )
        }),
      ),
    )
    .handle("createSetlist", ({ payload }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertBandMember(payload.band_id)
          const inserted = yield* db
            .insertInto("app_public.setlists")
            .values({
              band_id: payload.band_id,
              name: payload.name,
              description: payload.description,
              gig_date: payload.gig_date,
              status: payload.status,
            })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)

          return yield* setlistOrDie(inserted.id)
        }),
      ),
    )
    .handle("getSetlist", ({ params: { id } }) => asSession((_session) => setlistOr404(id)))
    .handle("updateSetlist", ({ params: { id }, payload }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          const existing = yield* setlistOr404(id)
          yield* assertBandMember(existing.band_id)
          yield* db
            .updateTable("app_public.setlists")
            .set({
              name: payload.name,
              description: payload.description,
              gig_date: payload.gig_date,
              status: payload.status,
            })
            .where("id", "=", id)
            .pipe(Effect.orDie)

          return yield* setlistOrDie(id)
        }),
      ),
    )
    .handle("deleteSetlist", ({ params: { id } }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          const existing = yield* setlistOr404(id)
          yield* assertBandMember(existing.band_id)
          yield* db.deleteFrom("app_public.setlists").where("id", "=", id).pipe(Effect.orDie)
        }),
      ),
    )
    .handle("listEntries", ({ params: { id } }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          yield* setlistOr404(id)
          return yield* entriesFor(id)
        }),
      ),
    )
    .handle("addEntry", ({ params: { id }, payload }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          const setlist = yield* setlistOr404(id)

          // The entry's song must be in the same band. RLS hides another band's
          // songs, so a foreign id is rejected here before the resolved view —
          // which runs as its owner and would join the foreign song's title —
          // can expose anything.
          const song = yield* db
            .selectFrom("app_public.songs")
            .select("band_id")
            .where("id", "=", payload.song_id)
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementError", () =>
                Effect.fail(new SetlistForbidden({ message: "That song is not in this band" })),
              ),
            )
          if (song.band_id !== setlist.band_id) {
            return yield* new SetlistForbidden({ message: "That song is not in this band" })
          }

          const inserted = yield* db
            .insertInto("app_public.setlist_entries")
            .values({
              setlist_id: id,
              song_id: payload.song_id,
              section_id: payload.section_id ?? null,
              position: payload.position,
            })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)

          return yield* entryOr404(inserted.id, id)
        }),
      ),
    )
    .handle("updateEntry", ({ params: { id, entryId }, payload }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          yield* db
            .updateTable("app_public.setlist_entries")
            .set({
              position: payload.position,
              section_id: payload.section_id,
              key_override: payload.key_override,
              tempo_override: payload.tempo_override,
              notes_override: payload.notes_override,
            })
            .where("id", "=", entryId)
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)

          return yield* entryOr404(entryId, id)
        }),
      ),
    )
    .handle("watchSetlist", ({ params: { id }, query: { client } }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        // Opening the stream is the visibility check; after that it holds no database connection.
        yield* asSession(() => setlistOr404(id))
        const me = yield* Auth.getMe(session.sessionId).pipe(Effect.orElseSucceed(() => null))
        if (!me) return yield* new SetlistForbidden({ message: "You must be signed in" })
        const hub = yield* SetlistHub
        return hub.watch(id, {
          userId: me.id,
          viewer: { client, username: me.username, mode: "viewing", at: null },
        })
      }),
    )
    .handle("reportPresence", ({ params: { id }, payload }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        yield* asSession(() => setlistOr404(id))
        if (!session.userId || !(yield* (yield* SetlistHub).report(id, session.userId, payload))) {
          return yield* new SetlistForbidden({ message: "That connection is not yours" })
        }
      }),
    )
    .handle("listSections", ({ params: { id } }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          return yield* db
            .selectFrom("app_public.setlist_sections")
            .select(SECTION_COLUMNS)
            .where("setlist_id", "=", id)
            .orderBy("position", "asc")
            .pipe(Effect.flatMap((rows) => decodeSectionArray(rows).pipe(Effect.orDie)))
        }),
      ),
    )
    .handle("addSection", ({ params: { id }, payload }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          // A new section plays last.
          const last = yield* db
            .selectFrom("app_public.setlist_sections")
            .select(sql<number>`coalesce(max(position), 0)`.as("position"))
            .where("setlist_id", "=", id)
            .pipe(Effect.head, Effect.orDie)
          const inserted = yield* db
            .insertInto("app_public.setlist_sections")
            .values({ setlist_id: id, name: payload.name, position: last.position + POSITION_STEP })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)
          return yield* sectionOr404(inserted.id, id)
        }),
      ),
    )
    .handle("renameSection", ({ params: { id, sectionId }, payload }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          yield* sectionOr404(sectionId, id)
          yield* db
            .updateTable("app_public.setlist_sections")
            .set({ name: payload.name })
            .where("id", "=", sectionId)
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)
          return yield* sectionOr404(sectionId, id)
        }),
      ),
    )
    .handle("deleteSection", ({ params: { id, sectionId } }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)
          yield* sectionOr404(sectionId, id)
          // The foreign key sets the section of its entries to null: they join the unsectioned group.
          yield* db
            .deleteFrom("app_public.setlist_sections")
            .where("id", "=", sectionId)
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)
        }),
      ),
    )
    .handle("arrange", ({ params: { id }, payload }) =>
      asWriter(id, (_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* setlistOr404(id)

          // Every id must belong to this setlist, or the write would reach another band's rows.
          const sections = yield* db
            .selectFrom("app_public.setlist_sections")
            .select("id")
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)
          const entries = yield* db
            .selectFrom("app_public.setlist_entries")
            .select("id")
            .where("setlist_id", "=", id)
            .pipe(Effect.orDie)
          const sectionIds = new Set(sections.map((r) => r.id))
          const entryIds = new Set(entries.map((r) => r.id))
          const named = payload.groups.flatMap((g) => g.entries)
          const sectionsNamed = payload.groups.flatMap((g) => (g.section_id === null ? [] : [g.section_id]))
          const wellFormed =
            named.every((e) => entryIds.has(e)) &&
            new Set(named).size === named.length &&
            sectionsNamed.every((s) => sectionIds.has(s)) &&
            new Set(sectionsNamed).size === sectionsNamed.length
          if (!wellFormed) {
            return yield* new SetlistForbidden({ message: "That arrangement names a section or song that is not in this setlist" })
          }

          for (const [groupIndex, group] of payload.groups.entries()) {
            if (group.section_id !== null) {
              yield* db
                .updateTable("app_public.setlist_sections")
                .set({ position: (groupIndex + 1) * POSITION_STEP })
                .where("id", "=", group.section_id)
                .pipe(Effect.orDie)
            }
            for (const [entryIndex, entryId] of group.entries.entries()) {
              yield* db
                .updateTable("app_public.setlist_entries")
                .set({ section_id: group.section_id, position: (entryIndex + 1) * POSITION_STEP })
                .where("id", "=", entryId)
                .pipe(Effect.orDie)
            }
          }
        }),
      ),
    )
    .handle("deleteEntry", ({ params: { id, entryId } }) =>
      asWriter(id, (_session) =>
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
    ),
)
