import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { PublicUsers } from "../services/public-user"
import { withAuthContext } from "../db"
import { GigListApi, PublicUserNotFound } from "../../api/contracts"

/**
 * Signed-out visitors still run as the visitor role, with no session id, so
 * the profile reads exactly what the `public_user*` functions grant the visitor.
 */
export const publicUsersHandlers = HttpApiBuilder.group(
  GigListApi,
  "publicUsers",
  (handlers) =>
    Effect.gen(function* () {
      const users = yield* PublicUsers
      return handlers.handle(
        "getPublicUser",
        Effect.fnUntraced(function* ({ params: { username } }) {
          return yield* users.getPublicUserProfile(username).pipe(
            withAuthContext(undefined),
            Effect.catchTag("PublicUserMissing", (e) => Effect.fail(new PublicUserNotFound({ username: e.username }))),
          )
        }),
      )
    }),
)
