import { Effect } from "effect"
import { HttpApiBuilder } from "@effect/platform"
import { sql } from "kysely"
import { Db } from "../db"
import * as Auth from "../services/auth"
import { SetListApi, sessionCookie } from "../../api/contracts"

if (process.env.NODE_ENV === "production") {
  throw new Error("Testing API must not be loaded in production")
}

const isSecure = process.env.NODE_ENV === "production"

export const testingHandlers = HttpApiBuilder.group(SetListApi, "testing", (handlers) =>
  handlers
    .handle("clear", () =>
      Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .deleteFrom("app_public.bands")
          .where("name", "like", "Test:%")
        yield* db
          .deleteFrom("app_public.bands")
          .where("slug", "like", "test-%")
        yield* db
          .deleteFrom("app_public.users")
          .where("username", "like", "test_%")
        return { success: true }
      }).pipe(Effect.orDie),
    )
    .handle("seedBand", ({ payload }) =>
      Effect.gen(function* () {
        yield* Auth.register({
          username: payload.username,
          email: `${payload.username}@test.local`,
          password: payload.password,
        }).pipe(Effect.catchAll(() => Effect.void))

        const session = yield* Auth.login({
          id: payload.username,
          password: payload.password,
        })

        const db = yield* Db
        yield* db.withTransaction(
          Effect.gen(function* () {
            yield* db.selectNoFrom([
              sql<string>`set_config('my.session_id', ${session.sessionId}, true)`.as("_"),
            ])
            yield* db
              .selectFrom(
                sql`app_public.create_band(
                  slug => ${payload.bandSlug}::citext,
                  name => ${payload.bandName}
                )`.as("b"),
              )
              .selectAll()
          }),
        )

        return { success: true }
      }).pipe(
        Effect.catchAll(() => Effect.succeed({ success: true })),
      ),
    )
    .handle("testLogin", ({ payload }) =>
      Effect.gen(function* () {
        // Ensure user exists (idempotent)
        yield* Auth.register({
          username: payload.username,
          email: `${payload.username}@test.local`,
          password: payload.password,
        }).pipe(Effect.catchAll(() => Effect.void))

        const result = yield* Auth.login({ id: payload.username, password: payload.password })
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { success: true }
      }).pipe(
        Effect.catchAll(() => Effect.succeed({ success: false })),
      ),
    ),
)
