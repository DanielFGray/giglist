import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Charts } from "../services/charts"
import { chartRefused, chartRejected } from "./charts"
import { asSignedIn } from "./scope"
import { ChartForbidden } from "../../api/charts"
import { GigListApi } from "../../api/contracts"

const asMember = asSignedIn(() => new ChartForbidden({ message: "You must be signed in" }))

export const ScoresApiGroupLive = HttpApiBuilder.group(GigListApi, "scores", (handlers) =>
  handlers
    .handle("uploadScore", ({ query, payload }) =>
      Charts.use((charts) => charts.uploadScore(query, payload)).pipe(
        asMember,
        Effect.catchTags({ ChartRefused: chartRefused, ChartRejected: chartRejected }),
      ),
    )
    .handle("scoreFile", ({ params: { revisionId } }) =>
      Charts.use((charts) => charts.scoreFile(revisionId)).pipe(asMember, Effect.catchTags({ ChartRefused: chartRefused })),
    ),
)
