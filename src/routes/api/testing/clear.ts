import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"
import { runtime } from "~/server/runtime"
import { Db } from "~/server/db"

if (process.env.NODE_ENV === "production") {
  throw new Error("Testing API must not be loaded in production")
}

export const Route = createFileRoute("/api/testing/clear")({
  server: {
    handlers: {
      POST: async () => {
        await runtime.runPromise(
          Effect.gen(function* () {
            const db = yield* Db
            // Bands with test names (users cascade via FK)
            yield* db
              .deleteFrom("app_public.bands")
              .where("name", "like", "Test:%")
            yield* db
              .deleteFrom("app_public.bands")
              .where("slug", "like", "test-%")
            yield* db
              .deleteFrom("app_public.users")
              .where("username", "like", "test_%")
          }),
        )

        return Response.json({ success: true })
      },
    },
  },
})
