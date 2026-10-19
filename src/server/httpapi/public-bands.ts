import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import * as BandService from "../services/band"
import { withAuthContext } from "../db"
import { SetListApi, PublicBandNotFound } from "../../api/contracts"

/**
 * Signed-out visitors still run as the visitor role so `select_public` on bands
 * and the security-definer helpers apply. No session id is set.
 */
export const publicBandsHandlers = HttpApiBuilder.group(
  SetListApi,
  "publicBands",
  (handlers) =>
    handlers.handle(
      "getPublicBand",
      Effect.fnUntraced(function* ({ params: { slug } }) {
        return yield* BandService.getPublicBandProfile(slug).pipe(
          withAuthContext(undefined),
          Effect.mapError((e) => {
            if (e._tag === "PublicBandMissing") {
              return new PublicBandNotFound({ slug: e.slug })
            }
            return new PublicBandNotFound({ slug })
          }),
        )
      }),
    ),
)
