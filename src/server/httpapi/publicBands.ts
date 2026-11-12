import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Bands } from "../services/bands"
import { withAuthContext } from "../db"
import { PublicBandNotFound } from "../../api/bands"
import { GigListApi } from "../../api/contracts"

/**
 * Signed-out visitors still run as the visitor role, with no session id, so the
 * page reads exactly what the `public_band*` functions grant the visitor.
 */
export const PublicBandsApiGroupLive = HttpApiBuilder.group(GigListApi, "publicBands", (handlers) =>
  handlers.handle("getPublicBand", ({ params: { slug } }) =>
    Bands.use((bands) => bands.getPublicBandProfile(slug)).pipe(
      withAuthContext,
      Effect.catchTag("PublicBandMissing", (e) => Effect.fail(new PublicBandNotFound({ slug: e.slug }))),
    ),
  ),
)
