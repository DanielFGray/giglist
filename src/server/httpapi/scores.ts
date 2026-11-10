import { createHash } from "node:crypto"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { RequestDatabase } from "../db"
import { ChartForbidden, ChartInvalid, GigListApi } from "../../api/contracts"
import { MAX_SCORE_BYTES, scoreFormat } from "../../charts/score-file"
import { asSession, assertSongVisible, decodeChart, withNewestRevision } from "./charts"

export const scoresHandlers = HttpApiBuilder.group(GigListApi, "scores", (handlers) =>
  handlers
    .handle("uploadScore", ({ query, payload }) =>
      asSession(() =>
        Effect.gen(function* () {
          if (payload.length > MAX_SCORE_BYTES) {
            return yield* new ChartInvalid({ message: "That file is too large for a score" })
          }
          if (scoreFormat(payload) === null) {
            return yield* new ChartInvalid({ message: "That is not a Guitar Pro file" })
          }
          const db = yield* RequestDatabase
          yield* assertSongVisible(query.song_id)
          const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
          // The chart, its revision and the file share the request's transaction. The database
          // checks that the stored bytes hash to the revision's sha256.
          const chart = yield* db
            .insertInto("app_public.charts")
            .values({ song_id: query.song_id, kind: "score", name: query.name, written_key: null })
            .returning(["id", "song_id", "kind", "name", "written_key", "created_at"])
            .pipe(Effect.head, Effect.orDie)
          const revision = yield* db
            .insertInto("app_public.chart_revisions")
            .values({
              chart_id: chart.id,
              file_key: query.file_name,
              file_sha256: createHash("sha256").update(bytes).digest(),
            })
            .returning("id")
            .pipe(Effect.head, Effect.orDie)
          yield* db
            .insertInto("app_public.score_files")
            .values({ revision_id: revision.id, bytes })
            .pipe(Effect.orDie)
          const [created] = yield* withNewestRevision([chart])
          return yield* decodeChart(created).pipe(Effect.orDie)
        }),
      ),
    )
    .handle("scoreFile", ({ params: { revisionId } }) =>
      asSession(() =>
        Effect.gen(function* () {
          const db = yield* RequestDatabase
          // RLS hides a file outside the caller's bands, so a miss is a 403.
          const rows = yield* db
            .selectFrom("app_public.score_files")
            .select("bytes")
            .where("revision_id", "=", revisionId)
            .pipe(Effect.orDie)
          const file = rows[0]
          if (!file) return yield* new ChartForbidden({ message: "You are not a member of that band" })
          return new Uint8Array(file.bytes)
        }),
      ),
    ),
)
