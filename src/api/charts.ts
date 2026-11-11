import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { SessionMiddleware } from "./session"
import { musicalKey } from "./songs"

// --- Charts schemas ---

/**
 * A chart with the text of its newest revision. `source` is the stored
 * ChordPro text, which the browser draws with `renderLyrics` and edits as
 * chords over lyrics (`exportChords`); it is null for a score, whose bytes are
 * fetched separately.
 */
export const Chart = S.Struct({
  id: S.String.check(S.isUUID()),
  song_id: S.String.check(S.isUUID()),
  kind: S.Literals(["lyrics", "score"]),
  name: S.String,
  written_key: S.NullOr(musicalKey),
  revision_id: S.String.check(S.isUUID()),
  source: S.NullOr(S.String),
  created_at: S.Date,
})

/** A lyrics chart made from text pasted as chords over lyrics. */
export const LyricsChartInsert = S.Struct({
  song_id: S.String.check(S.isUUID()),
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  written_key: S.NullOr(musicalKey),
  pasted: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(100000))),
})

export class ChartForbidden extends S.TaggedError<ChartForbidden, { readonly brand: unique symbol }>()("ChartForbidden", {
  message: S.String,
}) {}

/** One replacement in a change set: `[from, to)` of the earlier anchor text became `insert` characters; optional `source` names the exact earlier anchor range copied as a move. */
export const ChartChange = S.Struct({
  from: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  to: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  insert: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  source: S.optional(S.Int.check(S.isGreaterThanOrEqualTo(0))),
})

/**
 * A new revision of a lyrics chart, saved by the editor. `parent_id` must be
 * the chart's newest revision and `changes` must explain how the text became
 * `source` (docs/adr/0001).
 */
export const ChartRevisionInsert = S.Struct({
  parent_id: S.String.check(S.isUUID()),
  // An empty source is a chart whose last block was deleted; it parses to one empty line.
  source: S.String.pipe(S.check(S.isMaxLength(200000))),
  changes: S.NullOr(S.Array(ChartChange).pipe(S.check(S.isMaxLength(10000)))),
})

/** Someone saved a newer revision since the editor loaded the chart. */
export class ChartConflict extends S.TaggedError<ChartConflict, { readonly brand: unique symbol }>()("ChartConflict", {
  message: S.String,
}) {}

/** The revision is not one the editor could have made from its parent. */
export class ChartInvalid extends S.TaggedError<ChartInvalid, { readonly brand: unique symbol }>()("ChartInvalid", {
  message: S.String,
}) {}

/** An uploaded file as the raw request or response body. */
const fileBytes = S.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "application/octet-stream" }))

export const ChartsApiGroup = HttpApiGroup.make("charts")
  .add(
    HttpApiEndpoint.get("listCharts", "/song/:songId", {
      params: { songId: S.String.check(S.isUUID()) },
      success: S.Array(Chart),
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createLyricsChart", "/", {
      payload: LyricsChartInsert,
      success: Chart.pipe(HttpApiSchema.status(201)),
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    // The body is a PDF or an image; the answer is the chords and lyrics read
    // from it, as text for the paste box. Nothing is stored.
    HttpApiEndpoint.post("readChartFile", "/read", {
      payload: fileBytes,
      success: S.Struct({ text: S.String }),
      error: [
        ChartForbidden.pipe(HttpApiSchema.status(403)),
        ChartInvalid.pipe(HttpApiSchema.status(400)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.post("saveRevision", "/:id/revisions", {
      params: { id: S.String.check(S.isUUID()) },
      payload: ChartRevisionInsert,
      success: Chart.pipe(HttpApiSchema.status(201)),
      error: [
        ChartForbidden.pipe(HttpApiSchema.status(403)),
        ChartConflict.pipe(HttpApiSchema.status(409)),
        ChartInvalid.pipe(HttpApiSchema.status(400)),
      ],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteChart", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/charts")

// --- Scores ---

/** Where a score upload goes and what it is called; the request body is the file itself. */
export const ScoreUploadQuery = {
  song_id: S.String.check(S.isUUID()),
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  file_name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(255))),
}

export const ScoresApiGroup = HttpApiGroup.make("scores")
  .add(
    // The body is the Guitar Pro file, stored byte for byte as the chart's first revision.
    HttpApiEndpoint.post("uploadScore", "/", {
      query: ScoreUploadQuery,
      payload: fileBytes,
      success: Chart.pipe(HttpApiSchema.status(201)),
      error: [
        ChartForbidden.pipe(HttpApiSchema.status(403)),
        ChartInvalid.pipe(HttpApiSchema.status(400)),
      ],
    }),
  )
  .add(
    // A revision never changes, so the same URL always answers the same bytes.
    HttpApiEndpoint.get("scoreFile", "/:revisionId/file", {
      params: { revisionId: S.String.check(S.isUUID()) },
      success: fileBytes,
      error: ChartForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/scores")
