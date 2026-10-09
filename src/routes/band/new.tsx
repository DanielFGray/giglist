import { useState } from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { bands } from "~/api/client"

export const Route = createFileRoute("/band/new")({
  component: NewBand,
})

function NewBand() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const name = form.get("name") as string
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")

    const result = await bands.create({ slug, name })
    if (result.ok) {
      await router.invalidate()
      await router.navigate({ to: "/band" })
    } else {
      setError(result.error)
    }
    setLoading(false)
  }

  return (
    <div data-pwid="new-band-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create your band</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Get started by naming your band
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div data-pwid="new-band-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-sm font-medium text-zinc-300">
              Band name
            </label>
            <input
              data-pwid="new-band-name"
              id="name"
              name="name"
              type="text"
              required
              autoFocus
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
              placeholder="The Rolling Stones"
            />
          </div>

          <button
            data-pwid="new-band-submit"
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[var(--color-amber-accent)] text-zinc-950 py-2 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create band"}
          </button>
        </form>
      </div>
    </div>
  )
}
