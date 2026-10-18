import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { songs, type ChartInfo, type SongInfo, type SongUpdateData } from "~/api/client"
import { type MusicalKeyType } from "~/api/contracts"
import { ClickTrack } from "./ClickTrack"
import { SongCharts } from "./SongCharts"
import { SongForm, songValues } from "./SongForm"
import { errorMessage } from "./form"

/**
 * The page of one saved song: charts, metadata form and danger zone. A new song
 * is saved when it is added, so this is also where it is first written.
 *
 * One layout serves both modes. `editing` enables the form and shows Save,
 * Cancel and the danger zone; otherwise the form is read-only behind one Edit
 * button. The caller holds the mode, so the URL can carry it.
 */
export function SongEditor({
  bandId,
  song,
  songCharts,
  shownKey,
  onShownKeyChange,
  editing,
  onEditingChange,
}: {
  bandId: string
  song: SongInfo
  songCharts: ReadonlyArray<ChartInfo>
  shownKey: MusicalKeyType | null
  onShownKeyChange: (key: MusicalKeyType | null) => void
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const router = useRouter()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const save = async (payload: SongUpdateData) => {
    await songs.update(song.id, payload)
    await router.invalidate()
    onEditingChange(false)
  }

  const remove = async () => {
    setDeleteError(null)
    try {
      await songs.remove(song.id)
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
        songId={song.id}
        songKey={song.key}
        tempo={song.tempo_bpm}
        shownKey={shownKey}
        onShownKeyChange={onShownKeyChange}
        list={songCharts}
        onChanged={() => router.invalidate()}
      />

      {/* Keyed on the mode so Cancel discards unsaved edits: a fresh form starts from the saved song. */}
      <SongForm
        key={editing ? "editing" : "reading"}
        pwid="song-edit-form"
        defaults={songValues(song)}
        readOnly={!editing}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        onSubmit={save}
      >
        {editing ? (
          <button
            type="button"
            data-pwid="song-cancel"
            onClick={() => onEditingChange(false)}
            className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            data-pwid="song-edit"
            onClick={() => onEditingChange(true)}
            className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          >
            Edit
          </button>
        )}
      </SongForm>

      {editing && (
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
      )}
    </div>
  )
}
