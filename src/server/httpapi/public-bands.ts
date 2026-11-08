import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Bands } from "../services/band"
import { withAuthContext } from "../db"
import { GigListApi, PublicBandNotFound } from "../../api/contracts"

/**
 * Signed-out visitors still run as the visitor role, with no session id, so the
 * page reads exactly what the `public_band*` functions grant the visitor.
 */
export const publicBandsHandlers = HttpApiBuilder.group(
  GigListApi,
  "publicBands",
  (handlers) =>
    Effect.gen(function* () {
      const bands = yield* Bands
      return handlers.handle(
        "getPublicBand",
        Effect.fnUntraced(function* ({ params: { slug } }) {
          return yield* bands.getPublicBandProfile(slug).pipe(
            withAuthContext(undefined),
            Effect.catchTag("PublicBandMissing", (e) => Effect.fail(new PublicBandNotFound({ slug: e.slug }))),
          )
        }),
      )
    }),
)
