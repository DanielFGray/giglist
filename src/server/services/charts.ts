import { createHash } from "node:crypto"
import { Context, Effect, Layer, Schema as S, Struct } from "effect"
import { requestDb } from "../db"
import { IdRow } from "../rows"
import { explains } from "gigbag.js/charts/changes"
import { anchorText, parseDoc } from "gigbag.js/charts/doc"
import { guessKey, importPasted } from "gigbag.js/charts/lyrics"
import { MAX_SCORE_BYTES, scoreFormat } from "gigbag.js/charts/score-file"
import { Chart, type ChartRevisionInsert, type LyricsChartInsert, type ScoreUploadQuery } from "../../api/charts"

export class ChartRefused extends S.TaggedError<ChartRefused, { readonly brand: unique symbol }>()("ChartRefused", {
  message: S.String,
}) {}

export class ChartRevisionConflict extends S.TaggedError<ChartRevisionConflict, { readonly brand: unique symbol }>()(
  "ChartRevisionConflict",
  { message: S.String },
) {}

export class ChartRejected extends S.TaggedError<ChartRejected, { readonly brand: unique symbol }>()("ChartRejected", {
  message: S.String,
}) {}

const CHART_COLUMNS = ["id", "song_id", "kind", "name", "written_key", "created_at"] as const

/** A chart as its table holds it; the wire shape adds the newest revision's id and text. */
const ChartRow = S.Struct(Struct.omit(Chart.fields, ["revision_id", "source"]))
type ChartRow = typeof ChartRow.Type

const RevisionRow = S.Struct({ id: S.String, chart_id: S.String, source: S.NullOr(S.String) })

type ScoreUpload = S.Struct.Type<typeof ScoreUploadQuery>

/**
 * A song's charts: lyrics charts, each a chain of revisions, and scores, whose
 * one revision holds a Guitar Pro file. Read and written as the request's
 * user; row-level security hides another band's charts, so a missing chart and
 * a foreign one both answer 403.
 */
export class Charts extends Context.Service<Charts>()("giglist/charts", {
  make: Effect.sync(() => {
    const notMember = () => new ChartRefused({ message: "You are not a member of that band" })

    /** Require that the song is visible to the caller. */
    const requireSong = Effect.fnUntraced(function* (songId: string) {
      const rows = yield* requestDb.all(IdRow, (k) =>
        k.selectFrom("app_public.songs").select("id").where("id", "=", songId),
      )
      if (rows.length === 0) return yield* notMember()
    })

    /** Joins each chart to the text of its newest revision, in the wire shape. */
    const withNewestRevision = Effect.fn("Charts.withNewestRevision")(function* (charts: ReadonlyArray<ChartRow>) {
      if (charts.length === 0) return []
      const revisions = yield* requestDb.all(RevisionRow, (k) =>
        k
          .selectFrom("app_public.chart_revisions")
          .select(["id", "chart_id", "source"])
          .where(
            "chart_id",
            "in",
            charts.map((c) => c.id),
          )
          .distinctOn("chart_id")
          .orderBy("chart_id")
          .orderBy("created_at", "desc"),
      )
      const newest = new Map(revisions.map((r) => [r.chart_id, r]))
      return charts.flatMap((chart) => {
        const revision = newest.get(chart.id)
        // A chart always has a revision; one without is not shown.
        return revision ? [{ ...chart, revision_id: revision.id, source: revision.source }] : []
      })
    })

    /** The chart as the wire shape, with its newest revision. */
    const present = (chart: ChartRow) => withNewestRevision([chart]).pipe(Effect.map(([created]) => created))

    const listForSong = Effect.fn("Charts.listForSong")(function* (songId: string) {
      yield* requireSong(songId)
      const charts = yield* requestDb.all(ChartRow, (k) =>
        k.selectFrom("app_public.charts").select(CHART_COLUMNS).where("song_id", "=", songId).orderBy("created_at"),
      )
      return yield* withNewestRevision(charts)
    })

    const createLyrics = Effect.fn("Charts.createLyrics")(function* (payload: typeof LyricsChartInsert.Type) {
      yield* requireSong(payload.song_id)
      // Both inserts share the request's transaction, so a failed revision leaves no chart.
      const writtenKey = payload.written_key ?? guessKey(payload.pasted)
      const chart = yield* requestDb.one(ChartRow, (k) =>
        k
          .insertInto("app_public.charts")
          .values({
            song_id: payload.song_id,
            kind: "lyrics",
            name: payload.name,
            written_key: writtenKey,
          })
          .returning(CHART_COLUMNS),
      )
      yield* requestDb.exec((k) =>
        k
          .insertInto("app_public.chart_revisions")
          .values({ chart_id: chart.id, source: importPasted(payload.pasted, writtenKey) }),
      )
      return yield* present(chart)
    })

    const saveRevision = Effect.fn("Charts.saveRevision")(function* (
      id: string,
      payload: typeof ChartRevisionInsert.Type,
    ) {
      const found = yield* requestDb.maybe(ChartRow, (k) =>
        k.selectFrom("app_public.charts").select(CHART_COLUMNS).where("id", "=", id),
      )
      if (found._tag === "None") return yield* notMember()
      const chart = found.value
      if (chart.kind !== "lyrics") return yield* new ChartRejected({ message: "Only a lyrics chart is edited here" })
      const [newest] = yield* withNewestRevision([chart])
      if (!newest || newest.revision_id !== payload.parent_id || newest.source === null) {
        return yield* new ChartRevisionConflict({
          message: "The chart changed since you opened it",
        })
      }
      // A null change set is stored as null: a reader derives it from the two texts
      // when it follows a mark, and keeps the stricter slide check for derived steps.
      if (
        payload.changes !== null &&
        !explains(anchorText(parseDoc(newest.source)), anchorText(parseDoc(payload.source)), payload.changes)
      ) {
        return yield* new ChartRejected({ message: "The changes do not explain the new text" })
      }
      yield* requestDb.exec((k) =>
        k.insertInto("app_public.chart_revisions").values({
          chart_id: id,
          parent_id: payload.parent_id,
          source: payload.source,
          changes: payload.changes === null ? null : JSON.stringify(payload.changes),
        }),
      )
      return yield* present(chart)
    })

    const remove = Effect.fn("Charts.remove")(function* (id: string) {
      // RLS limits the delete to charts on the caller's songs.
      yield* requestDb.exec((k) => k.deleteFrom("app_public.charts").where("id", "=", id))
    })

    /** Stores a Guitar Pro file byte for byte as a new score chart's only revision. */
    const uploadScore = Effect.fn("Charts.uploadScore")(function* (upload: ScoreUpload, payload: Uint8Array) {
      if (payload.length > MAX_SCORE_BYTES) {
        return yield* new ChartRejected({ message: "That file is too large for a score" })
      }
      if (scoreFormat(payload) === null) {
        return yield* new ChartRejected({ message: "That is not a Guitar Pro file" })
      }
      yield* requireSong(upload.song_id)
      const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      // The chart, its revision and the file share the request's transaction. The database
      // checks that the stored bytes hash to the revision's sha256.
      const chart = yield* requestDb.one(ChartRow, (k) =>
        k
          .insertInto("app_public.charts")
          .values({ song_id: upload.song_id, kind: "score", name: upload.name, written_key: null })
          .returning(CHART_COLUMNS),
      )
      const revision = yield* requestDb.one(IdRow, (k) =>
        k
          .insertInto("app_public.chart_revisions")
          .values({
            chart_id: chart.id,
            file_key: upload.file_name,
            file_sha256: createHash("sha256").update(bytes).digest(),
          })
          .returning("id"),
      )
      yield* requestDb.exec((k) => k.insertInto("app_public.score_files").values({ revision_id: revision.id, bytes }))
      return yield* present(chart)
    })

    const scoreFile = Effect.fn("Charts.scoreFile")(function* (revisionId: string) {
      // RLS hides a file outside the caller's bands, so a miss is a 403.
      const file = yield* requestDb.maybe(S.Struct({ bytes: S.Uint8Array }), (k) =>
        k.selectFrom("app_public.score_files").select("bytes").where("revision_id", "=", revisionId),
      )
      if (file._tag === "None") return yield* notMember()
      return new Uint8Array(file.value.bytes)
    })

    return { listForSong, createLyrics, saveRevision, remove, uploadScore, scoreFile }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}
