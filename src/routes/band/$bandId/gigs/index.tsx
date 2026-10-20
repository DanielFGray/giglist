import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { gigs, type GigInfo } from "~/api/client"
import { SubmitButton, TextField, errorMessage } from "~/components/form"
import { gigLabel, localToday, splitGigs } from "~/components/gig-label"
import { listLength } from "~/components/SetlistSummary"
import { formatGigDate, formatTimeOfDay } from "~/components/time"

export const Route = createFileRoute("/band/$bandId/gigs/")({
  loader: async ({ params }) => ({ gigs: await gigs.byBand(params.bandId) }),
  component: GigList,
})

function GigList() {
  const { bandId } = Route.useParams()
  const { gigs: list } = Route.useLoaderData()
  const { upcoming, past } = splitGigs(list, localToday())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gigs</h1>
        <p className="text-sm text-zinc-500 mt-1">Each gig plays one or more setlists, in order.</p>
      </div>

      <NewGig bandId={bandId} />

      {list.length === 0 ? (
        <div data-pwid="gigs-empty" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No gigs yet.</p>
        </div>
      ) : (
        <>
          <GigSection title="Upcoming" pwid="gigs-upcoming" bandId={bandId} gigs={upcoming} />
          <GigSection title="Past" pwid="gigs-past" bandId={bandId} gigs={past} />
        </>
      )}
    </div>
  )
}

function GigSection({ title, pwid, bandId, gigs: list }: { title: string; pwid: string; bandId: string; gigs: ReadonlyArray<GigInfo> }) {
  if (list.length === 0) return null
  return (
    <section data-pwid={pwid} className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-400">{title}</h2>
      {list.map((gig) => (
        <GigRow key={gig.id} bandId={bandId} gig={gig} />
      ))}
    </section>
  )
}

function GigRow({ bandId, gig }: { bandId: string; gig: GigInfo }) {
  const seconds = gig.setlists.reduce((sum, setlist) => sum + setlist.duration_seconds, 0)
  const songCount = gig.setlists.reduce((sum, setlist) => sum + setlist.song_count, 0)
  return (
    <Link
      to="/band/$bandId/gigs/$gigId"
      params={{ bandId, gigId: gig.id }}
      data-pwid="gig-row"
      className="block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 hover:border-[var(--color-amber-accent)]/40 transition-colors"
    >
      <div data-pwid="gig-row-label" className="font-medium truncate">{gigLabel(gig)}</div>
      <div className="text-sm text-zinc-500 mt-0.5 truncate">
        {[
          // Without a venue the label is already the date.
          gig.venue === null ? null : gig.gig_date === null ? "No date" : formatGigDate(gig.gig_date),
          gig.performance_time === null ? null : formatTimeOfDay(gig.performance_time),
          gig.setlists.length === 0
            ? "No setlists"
            : `${gig.setlists.map((setlist) => setlist.name).join(" + ")} · ${listLength({ song_count: songCount, duration_seconds: seconds })}`,
        ]
          .flatMap((part) => (part === null ? [] : [part]))
          .join(" · ")}
      </div>
    </Link>
  )
}

/** A gig starts with where and when; the rest is filled in on its page. */
function NewGig({ bandId }: { bandId: string }) {
  const router = useRouter()
  const [venue, setVenue] = useState("")
  const [date, setDate] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      data-pwid="gig-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setPending(true)
        setError(null)
        try {
          const gig = await gigs.create({
            band_id: bandId,
            venue: venue.trim() || null,
            gig_date: date || null,
            address: null,
            load_in_time: null,
            performance_time: null,
            notes: null,
          })
          await router.navigate({ to: "/band/$bandId/gigs/$gigId", params: { bandId, gigId: gig.id } })
        } catch (err) {
          setError(errorMessage(err))
          setPending(false)
        }
      }}
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
      <h2 className="text-sm font-semibold text-zinc-300">New gig</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] items-end">
        <TextField label="Venue" pwid="gig-venue" value={venue} onChange={setVenue} placeholder="The Echo Room" />
        <TextField label="Date" pwid="gig-date" type="date" value={date} onChange={setDate} />
        <SubmitButton pwid="gig-submit" disabled={pending} pending={pending} label="Create gig" pendingLabel="Creating…" />
      </div>
      {error && <div data-pwid="gig-form-error" className="text-sm text-red-400">{error}</div>}
    </form>
  )
}
