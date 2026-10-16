import { Effect, Schema as S } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Kysely, withAuthContext } from "../db"
import { isBandMember } from "./scope"
import {
  Song,
  SetListApi,
  CurrentSession,
  SongForbidden,
  type SessionData,
} from "../../api/contracts"
import {
  songFindById,
  songCreate,
  songDelete,
  songFindByBandId,
} from "../../../generated/queries.js"

const decodeSong = S.decodeUnknownEffect(Song)

/** The pg driver hands back timestamps as Date; the wire schema uses strings. */
const toWire = <T extends { created_at: unknown; updated_at: unknown }>(
  row: T,
) => ({
  ...row,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at),
})

/**
 * Require that the session is a member of `bandId`.
 *
 * The policies already refuse a non-member, so this exists to turn "the query
 * returned nothing" into a 403 the browser can show. Both run in the same
 * transaction, so they cannot disagree about who the user is.
 */
const assertBandMember = Effect.fnUntraced(function*(bandId: string) {
    if (!(yield* isBandMember(bandId))) {
      return yield* new SongForbidden({ message: "You are not a member of that band" })
    }
  })

/** Run `query` as the session's user, or answer 403 if there is no session. */
const asSession = <A, E>(
  query: (session: SessionData) => Effect.Effect<A, E, Kysely>,
) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    if (!session.sessionId) {
      return yield* new SongForbidden({ message: "You must be signed in" })
    }
    return yield* query(session).pipe(withAuthContext(session.sessionId))
  })

/**
 * Reads the song, so the handler can authorise its band before touching it.
 *
 * With RLS on, a song the caller is not a member of is not visible: the query
 * returns nothing, so a missing row and a foreign song look the same. Both are
 * answered 403 — a caller outside the band must not learn the song exists.
 */
const songRow = Effect.fnUntraced(function*(id: string) {
    const db = yield* Kysely
    return yield* songFindById(db)({ id }).pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () =>
        Effect.fail(
          new SongForbidden({ message: "You are not a member of that band" }),
        ),
      ),
    )
  })

export const songsHandlers = HttpApiBuilder.group(SetListApi, "songs", (handlers) =>
  handlers
    .handle("songFindById", ({ params: { id } }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const row = yield* songRow(id)
          return yield* decodeSong(toWire(row)).pipe(Effect.orDie)
        }),
      ),
    )
    .handle("songFindByBandId", ({ params: { bandId } }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertBandMember(bandId)
          return yield* songFindByBandId(db)({ band_id: bandId }).pipe(
            Effect.map((rows) => rows.map(toWire)),
            Effect.andThen(S.decodeUnknownEffect(S.Array(Song))),
            Effect.orDie,
          )
        }),
      ),
    )
    .handle("songCreate", ({ payload }) =>
      asSession((session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertBandMember(payload.band_id)
          // created_by has no default and no trigger sets it.
          return yield* songCreate(db)({
            ...payload,
            created_by: session.userId,
          }).pipe(
            Effect.head,
            Effect.map(toWire),
            Effect.andThen(decodeSong),
            Effect.orDie,
          )
        }),
      ),
    )
    .handle("songUpdate", ({ params: { id }, payload }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          const existing = yield* songRow(id)
          yield* assertBandMember(existing.band_id)
          // Not the generated songUpdate: it also writes band_id and
          // created_by, and the visitor role may update only the song's own
          // fields. The where clause plus the update policy do the scoping.
          return yield* db
            .updateTable("app_public.songs")
            .set({
              title: payload.title,
              artist: payload.artist,
              key: payload.key,
              tempo_bpm: payload.tempo_bpm,
              duration_seconds: payload.duration_seconds,
              capo: payload.capo,
              notes: payload.notes,
            })
            .where("id", "=", id)
            .returningAll()
            .pipe(
              Effect.head,
              Effect.map(toWire),
              Effect.andThen(decodeSong),
              Effect.orDie,
            )
        }),
      ),
    )
    .handle("songDelete", ({ params: { id } }) =>
      asSession((_session) =>
        Effect.gen(function* () {
          const db = yield* Kysely
          const existing = yield* songRow(id)
          yield* assertBandMember(existing.band_id)
          return yield* songDelete(db)({ id }).pipe(Effect.asVoid, Effect.orDie)
        }),
      ),
    ),
)
