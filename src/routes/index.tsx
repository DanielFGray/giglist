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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setlists</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Your band's setlists will appear here.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
        <p className="text-zinc-500 text-sm">No setlists yet.</p>
        <button className="mt-4 px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition cursor-pointer">
          Create your first setlist
        </button>
      </div>

      <div className="text-xs text-zinc-600 font-mono">
        db:{" "}
        <span
          className={
            health.status === "ok" ? "text-green-500" : "text-red-500"
          }
        >
          {health.status}
        </span>
        <span className="ml-2">{health.dbTime}</span>
      </div>
    </div>
  )
}
