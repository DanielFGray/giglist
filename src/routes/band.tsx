import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/band")({
  component: Band,
})

function Band() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Band</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage your band members and settings.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-300">Members</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Band member management coming soon.
          </p>
        </div>
      </div>
    </div>
  )
}
