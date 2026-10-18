import { createFileRoute } from "@tanstack/react-router"
import { SongEditor } from "~/components/SongEditor"

export const Route = createFileRoute("/band/$bandId/songs/new")({
  component: NewSong,
})

function NewSong() {
  const { bandId } = Route.useParams()

  // A new song has no charts yet, so there is no key to choose and nothing to switch.
  return <SongEditor bandId={bandId} song={null} songCharts={[]} shownKey={null} onShownKeyChange={() => undefined} />
}
