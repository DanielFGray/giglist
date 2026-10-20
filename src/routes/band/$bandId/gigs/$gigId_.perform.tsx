import { createFileRoute } from "@tanstack/react-router"
import { gigs } from "~/api/client"
import { gigLabel } from "~/components/gig-label"
import { PerformView } from "~/components/PerformView"
import { indexFromSearch } from "~/components/perform"

export const Route = createFileRoute("/band/$bandId/gigs/$gigId_/perform")({
  // `at` is the 1-based number of the song on screen, counted across all the gig's setlists.
  validateSearch: (search: Record<string, unknown>): { at?: number } => {
    const at = Number(search.at)
    return Number.isInteger(at) && at > 0 ? { at } : {}
  },
  loader: async ({ params }) => {
    const [gig, entries] = await Promise.all([gigs.get(params.gigId), gigs.entries(params.gigId)])
    return { gig, order: entries.map((entry) => ({ entry, set: entry.setlist_name })) }
  },
  component: PerformGig,
})

/** The stage view of a gig: its setlists one after the other, each song headed by the name of its set. */
function PerformGig() {
  const { bandId, gigId } = Route.useParams()
  const { gig, order } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <PerformView
      title={gigLabel(gig)}
      order={order}
      room={{ kind: "gig", id: gigId }}
      index={indexFromSearch(Route.useSearch().at, order.length)}
      onShow={(index) => void navigate({ search: { at: index + 1 }, replace: true })}
      onExit={() => void navigate({ to: "/band/$bandId/gigs/$gigId", params: { bandId, gigId } })}
      emptyText="This gig plays no songs yet."
    />
  )
}
