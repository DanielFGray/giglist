import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { songs, type ChartInfo, type SongInfo, type SongUpdateData } from "~/api/client"
import { type MusicalKey } from "alphatab-kit/charts/key"
import { ClickTrack } from "./ClickTrack"
import { songFromScore } from "./song-from-score"
import { SongCharts } from "./SongCharts"
import { SongForm, songValues } from "./SongForm"
import { formatDuration } from "./duration"
import { errorMessage } from "./form"

/**
 * The page of one saved song: charts, metadata form and danger zone. A new song
 * is saved when it is added, so this is also where it is first written.
 *
 * One layout serves both modes. `editing` enables the form and shows Save,
 * Cancel and the danger zone; otherwise the form is read-only behind one Edit
 * button. On a narrow screen a read-only form collapses to a one-line summary under the title. The caller holds the mode, so the URL can carry it.
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
  shownKey: MusicalKey | null
  onShownKeyChange: (key: MusicalKey | null) => void
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const router = useRouter()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Hiding the details gives the charts the whole width. Editing needs the form, so it always shows them.
  const [detailsHidden, setDetailsHidden] = useState(false)
  const showDetails = editing || !detailsHidden
  // Wide lets the page use the whole window; `main` in the root layout reads the marker below.
  const [wide, setWide] = useState(false)

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

  const summary = songSummary(song)
  return (
    // Desktop: charts beside a sticky info sidebar. Mobile: a compact header, with the fields behind Edit.
    <div data-wide={wide ? "" : undefined} className={`flex flex-col gap-4 lg:grid ${showDetails ? "lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-8" : ""}`}>
      <header className="lg:col-span-full lg:mb-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{song.title}</h1>
          <div className="flex shrink-0 gap-2">
            {song.tempo_bpm !== null && (
              <ClickTrack
                bpm={song.tempo_bpm}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
              />
            )}
            <button
              type="button"
              data-pwid="song-wide"
              aria-pressed={wide}
              onClick={() => setWide(!wide)}
              className="max-lg:hidden px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer aria-pressed:bg-[var(--color-surface-raised)]"
            >
              {wide ? "Fit width" : "Full width"}
            </button>
            {!editing && showDetails && (
              <>
                <button
                  type="button"
                  data-pwid="song-edit"
                  onClick={() => onEditingChange(true)}
                  className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
                >
                  Edit
                </button>
                <button
                  type="button"
                  data-pwid="song-details-hide"
                  onClick={() => setDetailsHidden(true)}
                  className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
                >
                  Hide details
                </button>
              </>
            )}
            {!showDetails && (
              <button
                type="button"
                data-pwid="song-details-show"
                onClick={() => setDetailsHidden(false)}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
              >
                Details
              </button>
            )}
          </div>
        </div>
        {summary && (
          <p data-pwid="song-summary" className="text-sm text-zinc-400 lg:hidden">
            {summary}
          </p>
        )}
        {song.notes && <p className="text-sm text-zinc-500 line-clamp-2 lg:hidden">{song.notes}</p>}
      </header>

      <div className="space-y-6 min-w-0 max-lg:order-2 lg:row-start-2">
        <SongCharts
          songId={song.id}
          songKey={song.key}
          tempo={song.tempo_bpm}
          shownKey={shownKey}
          onShownKeyChange={onShownKeyChange}
          list={songCharts}
          onChanged={() => router.invalidate()}
          pageEditing={editing}
          onScoreRead={async (meta) => {
            const next = songFromScore(song, meta)
            if (next) await songs.update(song.id, next)
          }}
        />
      </div>

      {showDetails && (
        <aside className="space-y-6 max-lg:order-1 lg:row-start-2 lg:col-start-2 lg:sticky lg:top-4 lg:self-start">
          {/* Keyed on the mode and the save time so Cancel, and a change made elsewhere on the page (a score filling in the title), start a fresh form from the saved song. */}
          <SongForm
            key={`${editing ? "editing" : "reading"}-${song.updated_at.getTime()}`}
            pwid="song-edit-form"
            defaults={songValues(song)}
            readOnly={!editing}
            submitLabel="Save changes"
            pendingLabel="Saving…"
            onSubmit={save}
          >
            {editing && (
              <button
                type="button"
                data-pwid="song-cancel"
                onClick={() => onEditingChange(false)}
                className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
              >
                Cancel
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
        </aside>
      )}
    </div>
  )
}

/** The one-line form of a song's facts, for the mobile header: "Artist · G · 120 BPM · capo 2 · 3:45". */
function songSummary(song: SongInfo): string {
  return [
    song.artist,
    song.key,
    song.tempo_bpm !== null ? `${song.tempo_bpm} BPM` : null,
    song.capo ? `capo ${song.capo}` : null,
    song.duration_seconds !== null ? formatDuration(song.duration_seconds) : null,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ")
}
