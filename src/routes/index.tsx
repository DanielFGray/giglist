import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { Db } from "~/server/db"
import { runtime } from "~/server/runtime"

const getHealth = createServerFn({ method: "GET" }).handler(async () => {
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db.selectNoFrom(({ fn }) => [
        fn<string>("now", []).as("now"),
      ])
      return { status: "ok" as const, dbTime: String(row.now) }
    }),
  ).catch((e) => ({ status: "error" as const, dbTime: String(e) }))

  return result
})

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => getHealth(),
})

function Home() {
  const health = Route.useLoaderData()

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">SetList</h1>
        <p className="text-zinc-400">
          Collaborative setlist manager for bands
        </p>
        <div className="text-sm text-zinc-500">
          API:{" "}
          <span
            className={
              health.status === "ok" ? "text-green-400" : "text-red-400"
            }
          >
            {health.status}
          </span>
          <span className="ml-2 text-zinc-600">{health.dbTime}</span>
        </div>
      </div>
    </div>
  )
}
