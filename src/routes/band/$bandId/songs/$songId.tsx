import { createFileRoute } from "@tanstack/react-router"
import { charts, songs } from "~/api/client"
import { MusicalKeys, type MusicalKeyType } from "~/api/contracts"
import { SongEditor } from "~/components/SongEditor"

export const Route = createFileRoute("/band/$bandId/songs/$songId")({
  // `key` is the key to show the charts in, for example a setlist entry's key.
  validateSearch: (search: Record<string, unknown>): { key?: MusicalKeyType } => {
    const key = MusicalKeys.find((k) => k === search.key)
    return key ? { key } : {}
  },
  loader: async ({ params }) => {
    const [song, songCharts] = await Promise.all([songs.byId(params.songId), charts.bySong(params.songId)])
    return { song, songCharts }
  },
  component: SongDetail,
})

function SongDetail() {
  const { bandId, songId } = Route.useParams()
  const { song, songCharts } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  // Keyed on the song so opening a different one starts its form from that song's values.
  return (
    <SongEditor
      key={songId}
      bandId={bandId}
      song={song}
      songCharts={songCharts}
      shownKey={search.key ?? song.key}
      onShownKeyChange={(key) => navigate({ search: key ? { key } : {}, replace: true })}
    />
  )
}
