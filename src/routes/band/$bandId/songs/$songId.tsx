import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { charts, songs } from "~/api/client"
import { MusicalKeys, type MusicalKeyType } from "~/api/contracts"
import { ClickTrack } from "~/components/ClickTrack"
import { SongCharts } from "~/components/SongCharts"
import { SongForm, songValues } from "~/components/SongForm"
import { errorMessage } from "~/components/form"

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
  const router = useRouter()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const remove = async () => {
    setDeleteError(null)
    try {
      await songs.remove(songId)
      await router.invalidate()
      await router.navigate({ to: "/band/$bandId/songs", params: { bandId } })
    } catch (e) {
      setDeleteError(errorMessage(e))
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{song.title}</h1>
        {song.tempo_bpm !== null && (
          <ClickTrack
            bpm={song.tempo_bpm}
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          />
        )}
      </div>

      <SongCharts
        songId={songId}
        songKey={song.key}
        shownKey={search.key ?? song.key}
        onShownKeyChange={(key) => navigate({ search: key ? { key } : {}, replace: true })}
        list={songCharts}
        onChanged={() => router.invalidate()}
      />

      {/* Keyed on the song so editing a different one starts from its values. */}
      <SongForm
        key={songId}
        pwid="song-edit-form"
        defaults={songValues(song)}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        onSubmit={async (payload) => {
          await songs.update(songId, payload)
          await router.invalidate()
          await router.navigate({ to: "/band/$bandId/songs", params: { bandId } })
        }}
      >
        <Link
          to="/band/$bandId/songs"
          params={{ bandId }}
          data-pwid="song-cancel"
          className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
        >
          Cancel
        </Link>
      </SongForm>

      <div className="rounded-lg border border-red-500/20 p-4 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-300">Danger zone</h2>
        <button
          data-pwid="song-delete"
          onClick={remove}
          className="px-4 py-2 rounded-md border border-red-500/20 text-sm text-red-400 cursor-pointer"
        >
          Delete song
        </button>
        {deleteError && (
          <div data-pwid="song-delete-error" className="text-sm text-red-400">{deleteError}</div>
        )}
      </div>
    </div>
  )
}
