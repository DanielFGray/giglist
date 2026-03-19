import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"
import { sql } from "kysely"
import { runtime } from "~/server/runtime"
import { Db } from "~/server/db"

if (process.env.NODE_ENV === "production") {
  throw new Error("Testing API must not be loaded in production")
}

export const Route = createFileRoute("/api/testing/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}))
        const username = body.username ?? "test_admin"
        const password = body.password ?? "testpassword123"
        const email = body.email ?? `${username}@test.local`
        const name = body.name ?? username

        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const db = yield* Db

            const userId = yield* db
              .selectFrom("app_public.users")
              .select("id")
              .where("username", "=", username)
              .pipe(
                Effect.head,
                Effect.map((u) => u.id),
                Effect.catchTag("NoSuchElementException", () =>
                  db
                    .selectFrom(
                      sql<{ id: string }>`app_private.really_create_user(
                        username => ${username}::citext,
                        email => ${email},
                        email_is_verified => true,
                        name => ${name},
                        avatar_url => ${null},
                        password => ${password}::text
                      )`.as("u"),
                    )
                    .select("id")
                    .pipe(
                      Effect.head,
                      Effect.orDie,
                      Effect.map((u) => u.id),
                    ),
                ),
              )

            const session = yield* db
              .insertInto("app_private.sessions" as any)
              .values({ user_id: userId })
              .returning(["uuid"])
              .pipe(Effect.head, Effect.orDie)

            return {
              id: userId,
              username,
              email,
              name,
              sessionId: session.uuid as string,
            }
          }),
        )

        return new Response(
          JSON.stringify({
            id: result.id,
            username: result.username,
            email: result.email,
            name: result.name,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": `session=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
            },
          },
        )
      },
    },
  },
})
