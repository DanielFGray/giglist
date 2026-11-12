import { HttpApiBuilder } from "effect/http-api"
import { Charts } from "../services/charts"
import { asSignedIn } from "./scope"
import { ChartForbidden } from "../../api/charts"
import { GigListApi } from "../../api/contracts"

const asMember = asSignedIn(() => new ChartForbidden({ message: "You must be signed in" }))

export const ScoresApiGroupLive = HttpApiBuilder.group(GigListApi, "scores", (handlers) =>
  handlers
    .handle("uploadScore", ({ query, payload }) => Charts.use((charts) => charts.uploadScore(query, payload)).pipe(asMember))
    .handle("scoreFile", ({ params: { revisionId } }) =>
      Charts.use((charts) => charts.scoreFile(revisionId)).pipe(asMember),
    ),
)
