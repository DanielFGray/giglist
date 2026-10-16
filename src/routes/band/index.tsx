import { Navigate, createFileRoute, Link } from "@tanstack/react-router"
import { useAuth } from "~/components/AuthContext"

export const Route = createFileRoute("/band/")({
  component: BandLanding,
})

/** `/band` is a way in, not a page: it opens the user's first band, or invites
 *  them to create one when they belong to none. */
function BandLanding() {
  const { bands } = useAuth()

  if (bands.length === 0) {
    return (
      <div data-pwid="band-empty" className="min-h-[40vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-zinc-500">You're not in any bands yet.</p>
          <Link
            to="/band/new"
            data-pwid="band-create-cta"
            className="inline-block px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition cursor-pointer"
          >
            Create your first band
          </Link>
        </div>
      </div>
    )
  }

  return <Navigate to="/band/$bandId" params={{ bandId: bands[0].id }} />
}
