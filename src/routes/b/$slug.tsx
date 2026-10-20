import { useEffect } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { bands } from "~/api/client"
import { BandPage } from "~/components/BandPage"

export const Route = createFileRoute("/b/$slug")({
  loader: async ({ params }) => ({ profile: await bands.publicProfile(params.slug) }),
  component: PublicBandRoute,
})

/** Full-window, over the app's own header: the page belongs to the band. */
function PublicBandRoute() {
  const { profile } = Route.useLoaderData()
  const title = profile?.name ?? "Band not found"

  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])

  if (profile === null) {
    return (
      <div
        data-pwid="public-band-missing"
        className="min-h-[50vh] flex flex-col items-center justify-center gap-2 text-center"
      >
        <h1 className="text-2xl font-bold tracking-tight">Band not found</h1>
        <p className="text-sm text-zinc-500">That public profile does not exist.</p>
      </div>
    )
  }

  return (
    <div className="[--stick-top:0px] fixed inset-0 z-50 bg-[var(--color-surface)]">
      <BandPage profile={profile} className="h-full" />
    </div>
  )
}
