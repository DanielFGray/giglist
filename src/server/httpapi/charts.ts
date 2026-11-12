import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Charts, ChartRefused, ChartRejected, ChartRevisionConflict } from "../services/charts"
import { ChartReader, ChartFileRejected } from "../services/chartReader"
import { asSignedIn, requireSession } from "./scope"
import { ChartConflict, ChartForbidden, ChartInvalid } from "../../api/charts"
import { GigListApi } from "../../api/contracts"

/** A chart the member may not touch answers 403. */
export const chartRefused = (e: ChartRefused) => Effect.fail(new ChartForbidden({ message: e.message }))
/** A chart edit that is based on an old revision answers 409. */
export const chartRevisionConflict = (e: ChartRevisionConflict) => Effect.fail(new ChartConflict({ message: e.message }))
/** A chart edit or upload the server will not store answers 400. */
export const chartRejected = (e: ChartRejected) => Effect.fail(new ChartInvalid({ message: e.message }))
/** A file the reader cannot read answers 400. */
export const chartFileRejected = (e: ChartFileRejected) => Effect.fail(new ChartInvalid({ message: e.message }))

const unauthorized = () => new ChartForbidden({ message: "You must be signed in" })
const asMember = asSignedIn(unauthorized)

export const ChartsApiGroupLive = HttpApiBuilder.group(GigListApi, "charts", (handlers) =>
  handlers
    .handle("listCharts", ({ params: { songId } }) =>
      Charts.use((charts) => charts.listForSong(songId)).pipe(asMember, Effect.catchTags({ ChartRefused: chartRefused })),
    )
    // Signed in only, so strangers cannot spend the server's time on OCR. Reading
    // touches no table, so it runs outside a database transaction.
    .handle("readChartFile", ({ payload }) =>
      ChartReader.use((reader) => reader.read(payload)).pipe(
        Effect.map((text) => ({ text })),
        requireSession(unauthorized),
        Effect.catchTags({ ChartFileRejected: chartFileRejected }),
      ),
    )
    .handle("createLyricsChart", ({ payload }) =>
      Charts.use((charts) => charts.createLyrics(payload)).pipe(
        asMember,
        Effect.catchTags({ ChartRefused: chartRefused }),
      ),
    )
    .handle("saveRevision", ({ params: { id }, payload }) =>
      Charts.use((charts) => charts.saveRevision(id, payload)).pipe(
        asMember,
        Effect.catchTags({
          ChartRefused: chartRefused,
          ChartRevisionConflict: chartRevisionConflict,
          ChartRejected: chartRejected,
        }),
      ),
    )
    .handle("deleteChart", ({ params: { id } }) =>
      Charts.use((charts) => charts.remove(id)).pipe(asMember),
    ),
)
