import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"
import { sql } from "kysely"
import { runtime } from "~/server/runtime"
import { Db, withSession } from "~/server/db"

if (process.env.NODE_ENV === "production") {
  throw new Error("Testing API must not be loaded in production")
}

export const Route = createFileRoute("/api/testing/seed-band")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}))
        const name = body.name ?? "Test Band"
        const slug = body.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        const sessionId = body.sessionId

        if (!sessionId) {
          return Response.json({ error: "sessionId required" }, { status: 400 })
        }

        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const db = yield* Db
            return yield* withSession(db, sessionId,
              db
                .selectFrom(
                  sql<{ id: string; slug: string; name: string }>`app_public.create_band(
                    slug => ${slug}::citext,
                    name => ${name}
                  )`.as("b"),
                )
                .selectAll()
                .where(sql`b is not null`)
                .pipe(Effect.head, Effect.orDie),
            )
          }),
        )

        return Response.json({
          id: result.id,
          slug: result.slug,
          name: result.name,
        })
      },
    },
  },
})
