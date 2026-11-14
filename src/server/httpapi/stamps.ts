import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Marks } from "../services/marks"
import { asSignedIn } from "./scope"
import { GigListApi } from "../../api/contracts"
import { MarkForbidden } from "../../api/marks"

import { markMissing } from "./marks"

const asPlayer = asSignedIn(() => new MarkForbidden({ message: "You must be signed in" }))

export const StampsApiGroupLive = HttpApiBuilder.group(GigListApi, "stamps", (handlers) =>
  handlers
    .handle("listStamps", () =>
      Marks.use((marks) => marks.listStamps()).pipe(asPlayer),
    )
    .handle("createStamp", ({ payload }) =>
      Marks.use((marks) => marks.createStamp(payload)).pipe(asPlayer),
    )
    .handle("deleteStamp", ({ params: { id } }) =>
      Marks.use((marks) => marks.removeStamp(id)).pipe(
        asPlayer,
        Effect.catchTags({ MarkMissing: markMissing }),
      ),
    ),
)
