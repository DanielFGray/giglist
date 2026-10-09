import { Effect, Schema as S } from "effect"
import { HttpApiBuilder } from "@effect/platform"
import { sql } from "kysely"
import { Db, withSession, type KyselyDB } from "../db"
import { Song } from "../../api/contracts"
import {
  currentUserMemberBandIds,
  songFindById,
  songCreate,
  songUpdate,
  songDelete,
  songFindByBandId,
} from "../../../generated/queries.js"
import { SetListApi, CurrentSession, SongForbidden } from "../../api/contracts"

/**
 * The application connects as the table owner (DATABASE_URL) and
 * FORCE ROW LEVEL SECURITY is not set on these tables, so PostgreSQL does not
 * apply the app_public policies at all. Band scoping is enforced here rather
 * than trusted from the database. Setting the session with withSession is still
 * required: the PG functions that answer "is this user a member of that band"
 * read `my.session_id`.
 */

const decodeSong = S.decodeUnknown(Song)

/** The pg driver hands back timestamps as Date; the wire schema uses strings. */
const toWire = (row: Record<string, unknown>) => ({
  ...row,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at),
})

/** Runs `query` with the session set, so PG functions see the right user. */
const asSession = <A, E>(
  sessionId: string,
  query: (db: KyselyDB) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* withSession(db, sessionId, query(db))
  }).pipe(Effect.orDie)

// `current_user_member_band_ids()` is `setof uuid`, so each row carries the id
// under the function's own name rather than a `band_id` column.
type MemberBandRow = { current_user_member_band_ids: string }

const bandIdsFor = (sessionId: string) =>
  asSession(
    sessionId,
    (db) => currentUserMemberBandIds(db)(),
  ).pipe(
    Effect.map((rows) => rows as unknown as readonly MemberBandRow[]),
    Effect.map((rows) => rows.map((r) => r.current_user_member_band_ids)),
  )

/** Require that the current session is a member of `bandId`. */
export const assertBandMember = (bandId: string) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    if (!session.sessionId) {
      return yield* Effect.fail(
        new SongForbidden({ message: "You must be signed in" }),
      )
    }
    const ids = yield* bandIdsFor(session.sessionId).pipe(Effect.orDie)
    if (!ids.includes(bandId)) {
      return yield* Effect.fail(
        new SongForbidden({ message: "You are not a member of that band" }),
      )
    }
  })

/**
 * `band_id` and `id` arrive from the payload or the path, so both are
 * attacker-controlled. The band is checked against the session before any
 * read or write.
 */
export const songsHandlers = HttpApiBuilder.group(SetListApi, "songs", (handlers) =>
  handlers
    .handle("songFindByBandId", ({ path: { bandId } }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        yield* assertBandMember(bandId)
        return yield* asSession(session.sessionId, (db) =>
          songFindByBandId(db)({ band_id: bandId }).pipe(
            Effect.map((rows) => (rows as unknown as Record<string, unknown>[]).map(toWire)),
            Effect.andThen(S.decodeUnknown(S.Array(Song))),
            Effect.orDie,
          ),
        )
      }),
    )
    .handle("songCreate", ({ payload }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        yield* assertBandMember(payload.band_id)
        // created_by has no default and no trigger sets it.
        return yield* asSession(session.sessionId, (db) =>
          songCreate(db)({
            ...payload,
            created_by: session.userId,
          }).pipe(
            Effect.head,
            Effect.map(toWire),
            Effect.andThen(decodeSong),
            Effect.orDie,
          ),
        )
      }),
    )
    .handle("songUpdate", ({ path: { id }, payload }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        const existing = yield* asSession(session.sessionId, (db) =>
          songFindById(db)({ id }).pipe(Effect.head, Effect.orDie),
        )
        yield* assertBandMember(existing.band_id)
        return yield* asSession(session.sessionId, (db) =>
          songUpdate(db)({
            id,
            band_id: existing.band_id,
            created_by: existing.created_by,
            ...payload,
          }).pipe(
            Effect.head,
            Effect.map(toWire),
            Effect.andThen(decodeSong),
            Effect.orDie,
          ),
        )
      }),
    )
    .handle("songDelete", ({ path: { id } }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        const existing = yield* asSession(session.sessionId, (db) =>
          songFindById(db)({ id }).pipe(Effect.head, Effect.orDie),
        )
        yield* assertBandMember(existing.band_id)
        return yield* asSession(session.sessionId, (db) =>
          songDelete(db)({ id }).pipe(Effect.asVoid, Effect.orDie),
        )
      }),
    ),
)
