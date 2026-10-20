import { Effect, Schema as S } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Kysely, withAuthContext } from "../db"
import { explains } from "../../charts/changes"
import { anchorText, parseDoc } from "../../charts/doc"
import { guessKey, importPasted } from "../../charts/lyrics"
import { ChartReader } from "../services/chart-reader"
import { Chart, ChartConflict, ChartForbidden, ChartInvalid, CurrentSession, GigListApi, type SessionData } from "../../api/contracts"

export const decodeChart = S.decodeUnknownEffect(Chart)
const decodeCharts = S.decodeUnknownEffect(S.Array(Chart))

export type ChartRow = {
  id: string
  song_id: string
  kind: "lyrics" | "score"
  name: string
  written_key: string | null
  created_at: unknown
}

/** Run `query` as the session's user, or answer 403 if there is no session. */
export const asSession = <A, E>(query: (session: SessionData) => Effect.Effect<A, E, Kysely>) =>
  Effect.gen(function* () {
    const session = yield* signedIn
    return yield* query(session).pipe(withAuthContext(session.sessionId))
  })

/** The session, or 403 if the request has none. */
const signedIn = Effect.gen(function* () {
  const session = yield* CurrentSession
  if (!session.sessionId) {
    return yield* new ChartForbidden({ message: "You must be signed in" })
  }
  return session
})

/**
 * Require that the song is visible to the caller.
 *
 * RLS hides a song outside the caller's bands, so a missing song and a foreign
 * one look the same and both answer 403: the caller learns nothing about
 * another band's catalog.
 */
export const assertSongVisible = Effect.fnUntraced(function* (songId: string) {
  const db = yield* Kysely
  const rows = yield* db.selectFrom("app_public.songs").select("id").where("id", "=", songId).pipe(Effect.orDie)
  if (rows.length === 0) {
    return yield* new ChartForbidden({ message: "You are not a member of that band" })
  }
})

/** Joins each chart to the text of its newest revision, in the wire shape. */
export const withNewestRevision = Effect.fn("Charts.withNewestRevision")(function* (charts: ReadonlyArray<ChartRow>) {
  if (charts.length === 0) return []
  const db = yield* Kysely
  const revisions = yield* db
    .selectFrom("app_public.chart_revisions")
    .select(["id", "chart_id", "source"])
    .where("chart_id", "in", charts.map((c) => c.id))
    .distinctOn("chart_id")
    .orderBy("chart_id")
    .orderBy("created_at", "desc")
    .pipe(Effect.orDie)
  const newest = new Map(revisions.map((r) => [r.chart_id, r]))
  return charts.flatMap((chart) => {
    const revision = newest.get(chart.id)
    // A chart always has a revision; one without is not shown.
    return revision
      ? [{ ...chart, revision_id: revision.id, source: revision.source }]
      : []
  })
})

export const chartsHandlers = HttpApiBuilder.group(GigListApi, "charts", (handlers) =>
  handlers
    .handle("listCharts", ({ params: { songId } }) =>
      asSession(() =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertSongVisible(songId)
          const charts = yield* db
            .selectFrom("app_public.charts")
            .select(["id", "song_id", "kind", "name", "written_key", "created_at"])
            .where("song_id", "=", songId)
            .orderBy("created_at")
            .pipe(Effect.orDie)
          return yield* withNewestRevision(charts).pipe(Effect.flatMap(decodeCharts), Effect.orDie)
        }),
      ),
    )
    .handle("readChartFile", ({ payload }) =>
      Effect.gen(function* () {
        // Signed in only, so strangers cannot spend the server's time on OCR. Reading
        // touches no table, so it runs outside a database transaction.
        yield* signedIn
        const reader = yield* ChartReader
        return { text: yield* reader.read(payload) }
      }),
    )
    .handle("createLyricsChart", ({ payload }) =>
      asSession(() =>
        Effect.gen(function* () {
          const db = yield* Kysely
          yield* assertSongVisible(payload.song_id)
          // Both inserts share the request's transaction, so a failed revision leaves no chart.
          const writtenKey = payload.written_key ?? guessKey(payload.pasted)
          const chart = yield* db
            .insertInto("app_public.charts")
            .values({
              song_id: payload.song_id,
              kind: "lyrics",
              name: payload.name,
              written_key: writtenKey,
            })
            .returning(["id", "song_id", "kind", "name", "written_key", "created_at"])
            .pipe(Effect.head, Effect.orDie)
          yield* db
            .insertInto("app_public.chart_revisions")
            .values({ chart_id: chart.id, source: importPasted(payload.pasted, writtenKey) })
            .pipe(Effect.orDie)
          const [created] = yield* withNewestRevision([chart])
          return yield* decodeChart(created).pipe(Effect.orDie)
        }),
      ),
    )
    .handle("saveRevision", ({ params: { id }, payload }) =>
      asSession(() =>
        Effect.gen(function* () {
          const db = yield* Kysely
          // RLS hides a chart outside the caller's bands, so a miss is a 403.
          const [chart] = yield* db
            .selectFrom("app_public.charts")
            .select(["id", "song_id", "kind", "name", "written_key", "created_at"])
            .where("id", "=", id)
            .pipe(Effect.orDie)
          if (!chart) return yield* new ChartForbidden({ message: "You are not a member of that band" })
          if (chart.kind !== "lyrics") return yield* new ChartInvalid({ message: "Only a lyrics chart is edited here" })
          const [newest] = yield* withNewestRevision([chart])
          if (!newest || newest.revision_id !== payload.parent_id || newest.source === null) {
            return yield* new ChartConflict({ message: "The chart changed since you opened it" })
          }
          // A null change set is stored as null: a reader derives it from the two texts
          // when it follows a mark, and keeps the stricter slide check for derived steps.
          if (
            payload.changes !== null &&
            !explains(anchorText(parseDoc(newest.source)), anchorText(parseDoc(payload.source)), payload.changes)
          ) {
            return yield* new ChartInvalid({ message: "The changes do not explain the new text" })
          }
          yield* db
            .insertInto("app_public.chart_revisions")
            .values({
              chart_id: id,
              parent_id: payload.parent_id,
              source: payload.source,
              changes: payload.changes === null ? null : JSON.stringify(payload.changes),
            })
            .pipe(Effect.orDie)
          const [saved] = yield* withNewestRevision([chart])
          return yield* decodeChart(saved).pipe(Effect.orDie)
        }),
      ),
    )
    .handle("deleteChart", ({ params: { id } }) =>
      asSession(() =>
        Effect.gen(function* () {
          const db = yield* Kysely
          // RLS limits the delete to charts on the caller's songs.
          yield* db.deleteFrom("app_public.charts").where("id", "=", id).pipe(Effect.asVoid, Effect.orDie)
        }),
      ),
    ),
)
