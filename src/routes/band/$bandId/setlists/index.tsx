import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { setlists, type SetlistInfo } from "~/api/client"
import { gigLabel } from "~/components/gig-label"
import { NameForm, StatusBadge, listLength } from "~/components/SetlistSummary"

export const Route = createFileRoute("/band/$bandId/setlists/")({
  loader: async ({ params }) => ({ setlists: await setlists.byBand(params.bandId) }),
  component: SetlistList,
})

function SetlistList() {
  const { bandId } = Route.useParams()
  const { setlists: list } = Route.useLoaderData()
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setlists</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Running orders of songs. A gig plays one or more of them, and one setlist can serve many gigs.
        </p>
      </div>

      <NameForm
        pwid="setlist-form"
        label="New setlist name"
        placeholder="Name a new setlist, like “Summer set” or “Acoustic hour”"
        submitLabel="Create setlist"
        onSubmit={async (name) => {
          const created = await setlists.create({ band_id: bandId, name })
          await router.navigate({
            to: "/band/$bandId/setlists/$setlistId",
            params: { bandId, setlistId: created.id },
          })
        }}
      />

      {list.length === 0 ? (
        <div data-pwid="setlists-empty" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No setlists yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((setlist) => (
            <SetlistRow key={setlist.id} bandId={bandId} setlist={setlist} />
          ))}
        </div>
      )}
    </div>
  )
}

function SetlistRow({ bandId, setlist }: { bandId: string; setlist: SetlistInfo }) {
  return (
    <Link
      to="/band/$bandId/setlists/$setlistId"
      params={{ bandId, setlistId: setlist.id }}
      data-pwid="setlist-row"
      className="block rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 hover:border-[var(--color-amber-accent)]/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div data-pwid="setlist-row-label" className="font-medium truncate">{setlist.name}</div>
          <div className="text-sm text-zinc-500 mt-0.5 truncate">
            {[listLength(setlist), setlist.gigs.length === 0 ? "In no gig" : `For ${setlist.gigs.map((gig) => gigLabel(gig)).join(", ")}`].join(" · ")}
          </div>
        </div>
        <StatusBadge status={setlist.status} />
      </div>
    </Link>
  )
}
