import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-form"
import { ToggleButton } from "react-aria-components"
import { songs, type ChartInfo, type SongInfo, type SongUpdateData } from "~/api/client"
import { type MusicalKey } from "gigbag.js/charts/key"
import { ClickTrack } from "./ClickTrack"
import { songFromScore } from "./song-from-score"
import { SongCharts } from "./SongCharts"
import { useChartDrafts } from "./use-chart-drafts"
import { SongForm, useSongForm, type SongFormApi } from "./SongForm"
import { formatDuration } from "./duration"
import { errorMessage } from "./form"
import { button } from "./ui/button"

/**
 * The page of one saved song: charts, details form and danger zone. A new song
 * is saved when it is added, so this is also where it is first written.
 *
 * The page has one edit mode. `editing` enables the details form, opens one
 * chart's editor at a time, and shows the edit bar; edits to the details and
 * to every chart wait for the bar's Save, which stores them all and returns
 * to reading. Adding or deleting a chart is not an edit: it happens at once.
 * On a narrow screen the read-only details collapse to a one-line summary
 * under the title. The caller holds the mode, so the URL can carry it.
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

  const drafts = useChartDrafts(songCharts)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  /** Stores the details, when changed, then every changed chart. A chart that fails keeps its draft and its error, and the page stays in edit mode. */
  const save = async (details: SongUpdateData) => {
    setDetailsError(null)
    if (form.state.isDirty) {
      try {
        await songs.update(song.id, details)
      } catch (e) {
        setDetailsError(errorMessage(e))
        return
      }
      // The saved values become the form's defaults, so the form reads as unchanged.
      form.reset(form.state.values)
    }
    const saved = await drafts.save()
    await router.invalidate()
    if (saved) leave()
  }

  const form = useSongForm(song, save)

  const edit = (chartId: string | null) => {
    drafts.editing.open(chartId)
    onEditingChange(true)
  }

  /** Leaves edit mode. The drafts left are dropped; the form keeps what it holds, which after a save is the saved song. */
  const leave = () => {
    drafts.clear()
    setDetailsError(null)
    onEditingChange(false)
  }

  const remove = async () => {
    if (!window.confirm(`Delete "${song.title}" and all its charts?`)) return
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
            <ToggleButton
              data-pwid="song-wide"
              isSelected={wide}
              onChange={setWide}
              className="max-lg:hidden px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-[var(--color-amber-accent)] data-[selected]:bg-[var(--color-surface-raised)]"
            >
              {wide ? "Fit width" : "Full width"}
            </ToggleButton>
            {!editing && (
              <button
                type="button"
                data-pwid="song-edit"
                onClick={() => edit(null)}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
              >
                Edit
              </button>
            )}
            {!editing && (
              <button
                type="button"
                data-pwid={showDetails ? "song-details-hide" : "song-details-show"}
                onClick={() => setDetailsHidden(showDetails)}
                className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
              >
                {showDetails ? "Hide details" : "Details"}
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
          editing={editing ? drafts.editing : null}
          onEdit={edit}
          onScoreRead={(meta) => {
            // A score fills in an untitled song's details; like any edit to them, they wait for Save.
            const next = songFromScore(form.state.values, meta)
            if (next) {
              form.setFieldValue("title", next.title)
              form.setFieldValue("artist", next.artist)
              form.setFieldValue("tempo_bpm", next.tempo_bpm)
            }
          }}
        />
      </div>

      {showDetails && (
        <aside className="space-y-6 max-lg:order-1 lg:row-start-2 lg:col-start-2 lg:sticky lg:top-4 lg:self-start">
          <SongForm form={form} pwid="song-edit-form" readOnly={!editing} error={detailsError} />

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

      {editing && (
        <EditBar
          form={form}
          changedCharts={drafts.changed}
          canUndo={drafts.canUndo}
          onUndo={drafts.undo}
          onDone={leave}
          onDiscard={() => {
            form.reset()
            leave()
          }}
        />
      )}
    </div>
  )
}

/**
 * The bar at the bottom of the window in edit mode, so Save is in reach
 * anywhere in a long chart. With nothing changed, Save reads Done and just
 * leaves edit mode; Save submits the details form, whose submit saves the page.
 */
function EditBar({
  form,
  changedCharts,
  canUndo,
  onUndo,
  onDone,
  onDiscard,
}: {
  form: SongFormApi
  changedCharts: number
  canUndo: boolean
  onUndo: () => void
  onDone: () => void
  onDiscard: () => void
}) {
  const details = useStore(form.store, (state) => state.isDirty)
  const saving = useStore(form.store, (state) => state.isSubmitting)
  const valid = useStore(form.store, (state) => state.canSubmit)
  const unsaved = details || changedCharts > 0
  return (
    <div
      data-pwid="edit-bar"
      className="sticky bottom-0 z-20 order-3 -mx-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 lg:col-span-full lg:row-start-3"
    >
      <button
        data-pwid="editor-save"
        type="button"
        onClick={() => (unsaved ? void form.handleSubmit() : onDone())}
        disabled={saving || !valid}
        className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : unsaved ? "Save changes" : "Done"}
      </button>
      <button data-pwid="editor-undo" type="button" onClick={onUndo} disabled={!canUndo} className={button()}>
        Undo
      </button>
      {unsaved && (
        <button data-pwid="editor-cancel" type="button" onClick={onDiscard} className={button()}>
          Discard changes
        </button>
      )}
      {unsaved && (
        <span data-pwid="edit-unsaved" className="text-sm text-zinc-400">
          {unsavedLabel(details, changedCharts)}
        </span>
      )}
    </div>
  )
}

/** "Details and 2 charts unsaved", for the edit bar. */
function unsavedLabel(details: boolean, chartCount: number): string {
  const chartsPart = chartCount === 0 ? null : chartCount === 1 ? "1 chart" : `${chartCount} charts`
  const parts = [details ? "Details" : null, chartsPart].filter((part) => part !== null)
  return `${parts.join(" and ")} unsaved`
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
