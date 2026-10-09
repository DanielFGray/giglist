import { useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAuth } from "~/components/AuthContext"
import { bands, type BandMember } from "~/api/client"

export const Route = createFileRoute("/band/")({
  component: BandPage,
})

function BandPage() {
  const { currentBand } = useAuth()

  if (!currentBand) {
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

  return (
    <div data-pwid="band-page" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{currentBand.name}</h1>
        <p className="text-sm text-zinc-500 mt-1">Band settings and members</p>
      </div>

      <MembersList bandId={currentBand.id} />
      <InviteForm bandId={currentBand.id} />
    </div>
  )
}

function MembersList({ bandId }: { bandId: string }) {
  const [members, setMembers] = useState<BandMember[]>([])
  const [loaded, setLoaded] = useState(false)

  if (!loaded) {
    void bands.members(bandId).then((r) => {
      setMembers([...r])
      setLoaded(true)
    })
    return <div className="text-sm text-zinc-500">Loading members...</div>
  }

  return (
    <div data-pwid="band-members" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] divide-y divide-[var(--color-border-subtle)]">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-300">Members</h2>
      </div>
      {members.map((m) => (
        <div key={m.id} className="px-4 py-3 flex items-center gap-3">
          <div className="size-8 rounded-full bg-zinc-800 border border-[var(--color-border-subtle)] flex items-center justify-center text-xs font-medium text-zinc-400">
            {(m.name ?? m.username)[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{m.name ?? m.username}</div>
            <div className="text-xs text-zinc-500">@{m.username}</div>
          </div>
          {m.is_owner && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-amber-accent)]/10 text-[var(--color-amber-accent)] font-medium">
              Owner
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function InviteForm({ bandId }: { bandId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const value = (form.get("invitee") as string).trim()

    const isEmail = value.includes("@")
    const result = await bands.invite(
      bandId,
      isEmail ? { email: value } : { username: value },
    )

    if (result.ok) {
      setSuccess(true)
      e.currentTarget.reset()
    } else {
      setError(result.error)
    }
    setLoading(false)
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-300">Invite a member</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          data-pwid="band-invite-input"
          name="invitee"
          type="text"
          required
          placeholder="Username or email"
          className="flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
        />
        <button
          data-pwid="band-invite-submit"
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          Invite
        </button>
      </form>
      {error && (
        <div data-pwid="band-invite-error" className="text-sm text-red-400">{error}</div>
      )}
      {success && (
        <div data-pwid="band-invite-success" className="text-sm text-green-400">Invitation sent!</div>
      )}
    </div>
  )
}
