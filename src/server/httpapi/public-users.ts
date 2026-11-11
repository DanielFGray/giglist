import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { PublicUsers } from "../services/public-user"
import { withAuthContext } from "../db"
import { GigListApi } from "../../api/contracts"
import { PublicUserNotFound } from "../../api/public-users"

/**
 * Signed-out visitors still run as the visitor role, with no session id, so
 * the profile reads exactly what the `public_user*` functions grant the visitor.
 */
export const PublicUsersApiGroupLive = HttpApiBuilder.group(GigListApi, "publicUsers", (handlers) =>
  handlers.handle("getPublicUser", ({ params: { username } }) =>
    PublicUsers.use((users) => users.getPublicUserProfile(username)).pipe(
      withAuthContext,
      Effect.catchTag("PublicUserMissing", (e) => Effect.fail(new PublicUserNotFound({ username: e.username }))),
    ),
  ),
)
