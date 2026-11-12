import { HttpApiBuilder } from "effect/http-api"
import { Marks } from "../services/marks"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { MarkForbidden } from "../../api/marks"

const asPlayer = asSignedIn(() => new MarkForbidden({ message: "You must be signed in" }))

export const MarksApiGroupLive = HttpApiBuilder.group(GigListApi, "marks", (handlers) =>
  handlers
    .handle("listMarks", ({ params: { chartId } }) => Marks.use((marks) => marks.listForChart(chartId)).pipe(asPlayer))
    .handle("createMark", ({ payload }) => Marks.use((marks) => marks.create(payload)).pipe(asPlayer))
    .handle("updateMark", ({ params: { id }, payload }) => Marks.use((marks) => marks.update(id, payload)).pipe(asPlayer))
    .handle("deleteMark", ({ params: { id } }) => Marks.use((marks) => marks.remove(id)).pipe(asPlayer)),
)
