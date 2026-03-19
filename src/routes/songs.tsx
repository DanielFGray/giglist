import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/songs")({
  component: Songs,
})

function Songs() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Songs</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Your band's song catalog.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
        <p className="text-zinc-500 text-sm">No songs yet.</p>
        <button className="mt-4 px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition cursor-pointer">
          Add your first song
        </button>
      </div>
    </div>
  )
}
