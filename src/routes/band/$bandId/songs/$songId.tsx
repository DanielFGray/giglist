import { createFileRoute } from "@tanstack/react-router"
import { charts, songs } from "~/api/client"
import { MUSICAL_KEYS, type MusicalKey } from "gigbag.js/charts/key"
import { SongEditor } from "~/components/SongEditor"

export const Route = createFileRoute("/band/$bandId/songs/$songId")({
  // `key` is the key to show the charts in, for example a setlist entry's key.
  // `edit` is the page's edit mode; without it the song is read-only.
  validateSearch: (search: Record<string, unknown>): { key?: MusicalKey; edit?: true } => {
    const key = MUSICAL_KEYS.find((k) => k === search.key)
    return {
      ...(key ? { key } : {}),
      ...(search.edit === true ? { edit: true as const } : {}),
    }
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
      onShownKeyChange={(key) =>
        navigate({ search: (prev) => ({ ...prev, key: key ?? undefined }), replace: true })
      }
      editing={search.edit === true}
      // Replaced, not pushed: Back leaves the song, so it cannot drop edit mode and its unsaved edits without asking.
      // The page stays where it was scrolled to, on the chart the player chose.
      onEditingChange={(editing) =>
        navigate({ search: (prev) => ({ ...prev, edit: editing || undefined }), replace: true, resetScroll: false })
      }
    />
  )
}
