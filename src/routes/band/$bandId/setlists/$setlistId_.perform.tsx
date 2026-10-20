import { createFileRoute } from "@tanstack/react-router"
import { setlists } from "~/api/client"
import { PerformView } from "~/components/PerformView"
import { indexFromSearch } from "~/components/perform"

export const Route = createFileRoute("/band/$bandId/setlists/$setlistId_/perform")({
  // `at` is the 1-based number of the song on screen, so the URL is the whole state of the stage view.
  validateSearch: (search: Record<string, unknown>): { at?: number } => {
    const at = Number(search.at)
    return Number.isInteger(at) && at > 0 ? { at } : {}
  },
  loader: async ({ params }) => {
    const [setlist, entries] = await Promise.all([setlists.get(params.setlistId), setlists.entries(params.setlistId)])
    return { setlist, order: entries.map((entry) => ({ entry, set: null })) }
  },
  component: PerformSetlist,
})

/** The stage view of one setlist, as a rehearsal plays it. A gig plays its setlists from the gig's own perform page. */
function PerformSetlist() {
  const { bandId, setlistId } = Route.useParams()
  const { setlist, order } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <PerformView
      title={setlist.name}
      order={order}
      room={{ kind: "setlist", id: setlistId }}
      index={indexFromSearch(Route.useSearch().at, order.length)}
      onShow={(index) => void navigate({ search: { at: index + 1 }, replace: true })}
      onExit={() => void navigate({ to: "/band/$bandId/setlists/$setlistId", params: { bandId, setlistId } })}
      emptyText="This setlist has no songs yet."
    />
  )
}
