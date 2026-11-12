import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Marks, MarkMissing, MarkRefused } from "../services/marks"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { MarkForbidden, MarkNotFound } from "../../api/marks"

/** A mark or stamp the player cannot see answers 404 with its id. */
export const markMissing = (e: MarkMissing) => Effect.fail(new MarkNotFound({ message: e.message, id: e.id }))
/** A mark refusal answers 403. The stamp handlers reuse it. */
export const markRefused = (e: MarkRefused) => Effect.fail(new MarkForbidden({ message: e.message }))

const asPlayer = asSignedIn(() => new MarkForbidden({ message: "You must be signed in" }))

export const MarksApiGroupLive = HttpApiBuilder.group(GigListApi, "marks", (handlers) =>
  handlers
    .handle("listMarks", ({ params: { chartId } }) =>
      Marks.use((marks) => marks.listForChart(chartId)).pipe(asPlayer, Effect.catchTags({ MarkRefused: markRefused })),
    )
    .handle("createMark", ({ payload }) =>
      Marks.use((marks) => marks.create(payload)).pipe(asPlayer, Effect.catchTags({ MarkRefused: markRefused })),
    )
    .handle("updateMark", ({ params: { id }, payload }) =>
      Marks.use((marks) => marks.update(id, payload)).pipe(
        asPlayer,
        Effect.catchTags({ MarkMissing: markMissing, MarkRefused: markRefused }),
      ),
    )
    .handle("deleteMark", ({ params: { id } }) =>
      Marks.use((marks) => marks.remove(id)).pipe(
        asPlayer,
        Effect.catchTags({ MarkMissing: markMissing }),
      ),
    ),
)
