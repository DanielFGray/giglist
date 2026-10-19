import { createFileRoute } from "@tanstack/react-router"
import { bands, type PublicBandProfileInfo } from "~/api/client"

export const Route = createFileRoute("/b/$slug")({
  loader: async ({ params }) => {
    try {
      return { profile: await bands.publicProfile(params.slug) }
    } catch {
      return { profile: null }
    }
  },
  component: PublicBandPage,
})

function PublicBandPage() {
  const { profile } = Route.useLoaderData()

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

  return <PublicBandProfile profile={profile} />
}

function PublicBandProfile({ profile }: { profile: PublicBandProfileInfo }) {
  return (
    <div data-pwid="public-band-page" className="mx-auto max-w-2xl space-y-10 py-4">
      <header className="space-y-3">
        <p className="text-sm font-medium text-[var(--color-amber-accent)] tracking-wide">
          SetList
        </p>
        <h1
          data-pwid="public-band-name"
          className="text-4xl font-bold tracking-tight"
        >
          {profile.name}
        </h1>
        {profile.description && (
          <p
            data-pwid="public-band-description"
            className="text-base text-zinc-400 whitespace-pre-wrap max-w-prose"
          >
            {profile.description}
          </p>
        )}
      </header>

      {profile.show_members_publicly && profile.members.length > 0 && (
        <section data-pwid="public-band-members" className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Members</h2>
          <ul className="divide-y divide-[var(--color-border-subtle)] border border-[var(--color-border-subtle)] rounded-md">
            {profile.members.map((m) => (
              <li
                key={m.username}
                data-pwid={`public-band-member-${m.username}`}
                className="px-4 py-3 flex items-center gap-3"
              >
                <div className="size-9 rounded-full bg-[var(--color-amber-accent)] flex items-center justify-center text-xs font-bold text-zinc-950 overflow-hidden shrink-0">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt="" className="size-9 object-cover" />
                  ) : (
                    (m.name?.trim() || m.username)[0]?.toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {m.name ?? m.username}
                  </div>
                  <div className="text-xs text-zinc-500">@{m.username}</div>
                </div>
                {m.is_owner && (
                  <span className="text-xs text-[var(--color-amber-accent)] font-medium">
                    Owner
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.show_gig_dates_publicly && profile.gigs.length > 0 && (
        <section data-pwid="public-band-gigs" className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Dates</h2>
          <ul className="space-y-2">
            {profile.gigs.map((g) => (
              <li
                key={`${g.gig_date}-${g.name}`}
                data-pwid={`public-band-gig-${g.gig_date}`}
                className="flex items-baseline justify-between gap-4 text-sm border-b border-[var(--color-border-subtle)] pb-2"
              >
                <span className="font-medium">{g.name}</span>
                <time className="text-zinc-500 tabular-nums shrink-0" dateTime={g.gig_date}>
                  {formatGigDate(g.gig_date)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function formatGigDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}
