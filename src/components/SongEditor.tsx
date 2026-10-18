import { useState } from "react"
import { Link, useRouter } from "@tanstack/react-router"
import { songs, type ChartInfo, type SongInfo, type SongUpdateData } from "~/api/client"
import { type MusicalKeyType } from "~/api/contracts"
import { ClickTrack } from "./ClickTrack"
import { SongCharts } from "./SongCharts"
import { SongForm, songValues } from "./SongForm"
import { errorMessage } from "./form"

/**
 * The page of one saved song: charts, metadata form and danger zone. A new song
 * is saved when it is added, so this is also where it is first written.
 */
export function SongEditor({
  bandId,
  song,
  songCharts,
  shownKey,
  onShownKeyChange,
}: {
  bandId: string
  song: SongInfo
  songCharts: ReadonlyArray<ChartInfo>
  shownKey: MusicalKeyType | null
  onShownKeyChange: (key: MusicalKeyType | null) => void
}) {
  const router = useRouter()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const leave = async () => {
    await router.invalidate()
    await router.navigate({ to: "/band/$bandId/songs", params: { bandId } })
  }

  const save = async (payload: SongUpdateData) => {
    await songs.update(song.id, payload)
    await leave()
  }

  const remove = async () => {
    setDeleteError(null)
    try {
      await songs.remove(song.id)
      await leave()
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
        songId={song.id}
        songKey={song.key}
        tempo={song.tempo_bpm}
        shownKey={shownKey}
        onShownKeyChange={onShownKeyChange}
        list={songCharts}
        onChanged={() => router.invalidate()}
      />

      <SongForm
        pwid="song-edit-form"
        defaults={songValues(song)}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        onSubmit={save}
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
          type="button"
          onClick={remove}
          className="px-4 py-2 rounded-md border border-red-500/20 text-sm text-red-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
