import { useState } from "react"
import { Link, useRouter } from "@tanstack/react-router"
import { songs, type ChartInfo, type SongInfo, type SongUpdateData } from "~/api/client"
import { type MusicalKeyType } from "~/api/contracts"
import { ClickTrack } from "./ClickTrack"
import { SongCharts } from "./SongCharts"
import { SongForm, emptySong, songValues } from "./SongForm"
import { errorMessage } from "./form"

/**
 * The page for adding a song (`song` is null) and for editing one. Both show the
 * same sections in the same order. Charts and delete need a saved song, so on the
 * add page they wait for the song to exist and say so.
 */
export function SongEditor({
  bandId,
  song,
  songCharts,
  shownKey,
  onShownKeyChange,
}: {
  bandId: string
  song: SongInfo | null
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

  // A new song opens its own page, where its charts can be added; a saved edit returns to the list.
  const save = async (payload: SongUpdateData) => {
    if (song) {
      await songs.update(song.id, payload)
      await leave()
      return
    }
    const created = await songs.create({ ...payload, band_id: bandId })
    await router.invalidate()
    await router.navigate({ to: "/band/$bandId/songs/$songId", params: { bandId, songId: created.id } })
  }

  const remove = async () => {
    if (!song) return
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
        <h1 className="text-2xl font-bold tracking-tight">{song ? song.title : "Add a song"}</h1>
        {song && song.tempo_bpm !== null && (
          <ClickTrack
            bpm={song.tempo_bpm}
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          />
        )}
      </div>

      <SongCharts
        songId={song?.id ?? null}
        songKey={song?.key ?? null}
        tempo={song?.tempo_bpm ?? null}
        shownKey={shownKey}
        onShownKeyChange={onShownKeyChange}
        list={songCharts}
        onChanged={() => router.invalidate()}
      />

      <SongForm
        pwid={song ? "song-edit-form" : "song-form"}
        defaults={song ? songValues(song) : emptySong()}
        submitLabel={song ? "Save changes" : "Add song"}
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
          disabled={!song}
          onClick={remove}
          className="px-4 py-2 rounded-md border border-red-500/20 text-sm text-red-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Delete song
        </button>
        {!song && <p className="text-sm text-zinc-500">Save the song first; then it can be deleted here.</p>}
        {deleteError && (
          <div data-pwid="song-delete-error" className="text-sm text-red-400">{deleteError}</div>
        )}
      </div>
    </div>
  )
}
