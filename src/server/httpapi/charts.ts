import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Charts } from "../services/charts"
import { ChartReader } from "../services/chart-reader"
import { asSignedIn, requireSession } from "./scope"
import { ChartForbidden, GigListApi } from "../../api/contracts"

const unauthorized = () => new ChartForbidden({ message: "You must be signed in" })
const asMember = asSignedIn(unauthorized)

export const ChartsApiGroupLive = HttpApiBuilder.group(GigListApi, "charts", (handlers) =>
  handlers
    .handle("listCharts", ({ params: { songId } }) => Charts.use((charts) => charts.listForSong(songId)).pipe(asMember))
    // Signed in only, so strangers cannot spend the server's time on OCR. Reading
    // touches no table, so it runs outside a database transaction.
    .handle("readChartFile", ({ payload }) =>
      ChartReader.use((reader) => reader.read(payload)).pipe(
        Effect.map((text) => ({ text })),
        requireSession(unauthorized),
      ),
    )
    .handle("createLyricsChart", ({ payload }) => Charts.use((charts) => charts.createLyrics(payload)).pipe(asMember))
    .handle("saveRevision", ({ params: { id }, payload }) =>
      Charts.use((charts) => charts.saveRevision(id, payload)).pipe(asMember),
    )
    .handle("deleteChart", ({ params: { id } }) => Charts.use((charts) => charts.remove(id)).pipe(asMember)),
)

export const ScoresApiGroupLive = HttpApiBuilder.group(GigListApi, "scores", (handlers) =>
  handlers
    .handle("uploadScore", ({ query, payload }) => Charts.use((charts) => charts.uploadScore(query, payload)).pipe(asMember))
    .handle("scoreFile", ({ params: { revisionId } }) =>
      Charts.use((charts) => charts.scoreFile(revisionId)).pipe(asMember),
    ),
)
