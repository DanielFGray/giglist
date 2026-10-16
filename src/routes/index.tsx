import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { bands as bandsApi, type BandInvitationInfo } from "~/api/client"
import { useActiveBandId, useAuth } from "~/components/AuthContext"
import { errorMessage } from "~/components/form"

export const Route = createFileRoute("/")({
  // Empty for a signed-out visitor.
  loader: async () => ({ invitations: await bandsApi.invitations() }),
  component: Home,
})

/** A launchpad, not a stub: every link here goes to a page that works. */
function Home() {
  const { user, bands } = useAuth()
  const bandId = useActiveBandId()
  const band = bands.find((b) => b.id === bandId)
  const { invitations } = Route.useLoaderData()

  if (user === null) {
    return (
      <div data-pwid="dashboard" className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Setlists</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Sign in to build setlists for your band.
          </p>
        </div>
        <div data-pwid="dashboard-signed-out" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center space-y-4">
          <p className="text-zinc-500 text-sm">
            Sign in, or create an account, to get started.
          </p>
          <div className="flex justify-center gap-2">
            <Link
              to="/login"
              data-pwid="dashboard-signin"
              className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              data-pwid="dashboard-signup"
              className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-pwid="dashboard" className="space-y-6">
      <Invitations invitations={invitations} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setlists</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {band === undefined
            ? "Your band's setlists will appear here."
            : `${band.name} — running orders for gigs and rehearsals.`}
        </p>
      </div>

      {band === undefined || bandId === null ? (
        <div data-pwid="dashboard-no-band" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center space-y-4">
          <p className="text-zinc-500 text-sm">Create a band to start building setlists.</p>
          <Link
            to="/band/new"
            data-pwid="dashboard-create-band"
            className="inline-block px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition"
          >
            Create your first band
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/band/$bandId/setlists"
            params={{ bandId }}
            data-pwid="dashboard-setlists"
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-6 hover:border-[var(--color-amber-accent)]/40 transition-colors"
          >
            <div className="font-semibold">Setlists</div>
            <div className="text-sm text-zinc-500 mt-1">
              Build a running order and add songs from the catalog.
            </div>
          </Link>
          <Link
            to="/band/$bandId/songs"
            params={{ bandId }}
            data-pwid="dashboard-songs"
            className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-6 hover:border-[var(--color-amber-accent)]/40 transition-colors"
          >
            <div className="font-semibold">Song catalog</div>
            <div className="text-sm text-zinc-500 mt-1">
              Every song your band can play, with keys and tempos.
            </div>
          </Link>
        </div>
      )}
    </div>
  )
}

/** Bands that invited the signed-in user; accepting one makes them a member. */
function Invitations({ invitations }: { invitations: ReadonlyArray<BandInvitationInfo> }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  if (invitations.length === 0) return null

  const answer = async (write: () => Promise<unknown>) => {
    setError(null)
    try {
      await write()
    } catch (e) {
      setError(errorMessage(e))
    }
    // The root route holds the user's bands, so reloading it is what shows the new one.
    await router.invalidate()
  }

  return (
    <section data-pwid="invitations" className="rounded-lg border border-[var(--color-amber-accent)]/40 bg-[var(--color-amber-accent)]/10 p-4 space-y-3">
      <h2 className="text-sm font-semibold">You are invited</h2>
      <ul className="space-y-2">
        {invitations.map((invitation) => (
          <li key={invitation.id} data-pwid="invitation" className="flex items-center justify-between gap-3">
            <span className="text-sm">Join <strong>{invitation.band_name}</strong></span>
            <span className="flex gap-2">
              <button
                data-pwid="invitation-accept"
                type="button"
                onClick={() => void answer(() => bandsApi.acceptInvitation(invitation.id))}
                className="px-3 py-1.5 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-xs font-semibold cursor-pointer"
              >
                Accept
              </button>
              <button
                data-pwid="invitation-decline"
                type="button"
                onClick={() => void answer(() => bandsApi.declineInvitation(invitation.id))}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
              >
                Decline
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <div data-pwid="invitation-error" className="text-sm text-red-400">{error}</div>}
    </section>
  )
}
