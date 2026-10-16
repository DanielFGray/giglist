import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { Schema as S } from "effect"
import { setlists, songs, type SetlistEntryInfo, type SongInfo } from "~/api/client"
import {
  MusicalKeys,
  SetlistEntryUpdate,
  SetlistUpdate,
  type MusicalKeyType,
} from "~/api/contracts"
import { SelectField, SubmitButton, TextAreaField, TextField, NumberField, errorMessage, fieldError } from "~/components/form"
import { formatDuration } from "~/components/duration"

export const Route = createFileRoute("/band/$bandId/setlists/$setlistId")({
  loader: async ({ params }) => {
    const [setlist, entries, bandSongs] = await Promise.all([
      setlists.get(params.setlistId),
      setlists.entries(params.setlistId),
      songs.byBand(params.bandId),
    ])
    return { setlist, entries, bandSongs }
  },
  component: SetlistEditor,
})

const statusOptions = [
  { value: "draft" as const, label: "Draft" },
  { value: "rehearsal" as const, label: "Rehearsal" },
  { value: "final" as const, label: "Final" },
]

const keyOptions: ReadonlyArray<{ value: MusicalKeyType | ""; label: string }> = [
  { value: "", label: "Inherit" },
  ...MusicalKeys.map((key) => ({ value: key, label: key })),
]

/** The entry's own overrides, reconstructed from the resolved row. A null
 *  override means the entry inherits the song's value. */
const updatePayload = (
  entry: SetlistEntryInfo,
  position: number,
): (typeof SetlistEntryUpdate)["Encoded"] => ({
  position,
  section_id: entry.section_id,
  key_override: entry.key_overridden ? entry.key : null,
  tempo_override: entry.tempo_overridden ? entry.tempo_bpm : null,
  notes_override: entry.notes_overridden ? entry.notes : null,
})

function SetlistEditor() {
  const { bandId, setlistId } = Route.useParams()
  const { setlist, entries, bandSongs } = Route.useLoaderData()
  const router = useRouter()

  const totalSeconds = entries.reduce((sum, entry) => sum + (entry.duration_seconds ?? 0), 0)
  const refresh = () => router.invalidate()

  const move = async (index: number, delta: number) => {
    const entry = entries[index]
    const neighbour = entries[index + delta]
    if (entry === undefined || neighbour === undefined) return
    await setlists.updateEntry(setlistId, entry.id, updatePayload(entry, neighbour.position))
    await setlists.updateEntry(setlistId, neighbour.id, updatePayload(neighbour, entry.position))
    await refresh()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{setlist.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {setlist.gig_date ?? "No date"} · {entries.length}{" "}
            {entries.length === 1 ? "song" : "songs"}
            {totalSeconds > 0 && <> · {formatDuration(totalSeconds)}</>}
          </p>
        </div>
        <Link
          to="/band/$bandId/setlists"
          params={{ bandId }}
          data-pwid="setlist-back"
          className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 shrink-0"
        >
          All setlists
        </Link>
      </div>

      <SetlistDetails
        setlistId={setlistId}
        bandId={bandId}
        defaults={{
          name: setlist.name,
          description: setlist.description,
          gig_date: setlist.gig_date,
          status: setlist.status,
        }}
        onSaved={refresh}
      />

      <SongPicker
        setlistId={setlistId}
        bandSongs={bandSongs}
        nextPosition={(entries.at(-1)?.position ?? 0) + 1000}
        onAdded={refresh}
      />

      {entries.length === 0 ? (
        <div data-pwid="setlist-entries-empty" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No songs in this setlist yet.</p>
        </div>
      ) : (
        <ol data-pwid="setlist-entries" className="space-y-2">
          {entries.map((entry, index) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === entries.length - 1}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onChanged={refresh}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function SetlistDetails({
  setlistId,
  bandId,
  defaults,
  onSaved,
}: {
  setlistId: string
  bandId: string
  defaults: (typeof SetlistUpdate)["Encoded"]
  onSaved: () => Promise<void>
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [initial] = useState(defaults)

  const form = useForm({
    defaultValues: initial,
    validators: { onChange: S.toStandardSchemaV1(SetlistUpdate) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await setlists.update(setlistId, value)
        await onSaved()
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  const remove = async () => {
    setServerError(null)
    try {
      await setlists.remove(setlistId)
      await router.invalidate()
      await router.navigate({ to: "/band/$bandId/setlists", params: { bandId } })
    } catch (e) {
      setServerError(errorMessage(e))
    }
  }

  return (
    <form
      data-pwid="setlist-details"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <form.Field name="name">
          {(field) => (
            <TextField
              label="Name"
              pwid="setlist-name"
              value={field.state.value}
              onChange={field.handleChange}
              error={fieldError(field)}
              required
            />
          )}
        </form.Field>

        <form.Field name="gig_date">
          {(field) => (
            <TextField
              label="Gig date"
              pwid="setlist-date"
              type="date"
              value={field.state.value ?? ""}
              onChange={(value) => field.handleChange(value === "" ? null : value)}
              error={fieldError(field)}
            />
          )}
        </form.Field>

        <form.Field name="status">
          {(field) => (
            <SelectField
              label="Status"
              pwid="setlist-status"
              value={field.state.value}
              onChange={(value) => {
                if (value !== null) field.handleChange(value)
              }}
              options={statusOptions}
              error={fieldError(field)}
            />
          )}
        </form.Field>
      </div>

      {serverError && (
        <div data-pwid="setlist-details-error" className="text-sm text-red-400">{serverError}</div>
      )}

      <div className="flex gap-2">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="setlist-save"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Save details"
              pendingLabel="Saving…"
            />
          )}
        </form.Subscribe>
        <button
          data-pwid="setlist-delete"
          type="button"
          onClick={remove}
          className="px-4 py-2 rounded-md border border-red-500/20 text-sm text-red-400 cursor-pointer"
        >
          Delete setlist
        </button>
      </div>
    </form>
  )
}

function SongPicker({
  setlistId,
  bandSongs,
  nextPosition,
  onAdded,
}: {
  setlistId: string
  bandSongs: readonly SongInfo[]
  nextPosition: number
  onAdded: () => Promise<void>
}) {
  const [songId, setSongId] = useState("")
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    setError(null)
    const chosen = bandSongs.find((song) => song.id === songId)
    if (chosen === undefined) return
    try {
      await setlists.addEntry(setlistId, { song_id: chosen.id, position: nextPosition })
      setSongId("")
      await onAdded()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (bandSongs.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        This band has no songs yet — add some to its catalog first.
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-2">
      <h2 className="text-sm font-semibold text-zinc-300">Add a song</h2>
      <div className="flex gap-2">
        <select
          data-pwid="song-picker"
          value={songId}
          onChange={(e) => setSongId(e.target.value)}
          className="flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
        >
          <option value="">Choose a song…</option>
          {bandSongs.map((song) => (
            <option key={song.id} value={song.id}>
              {song.title}
              {song.artist === null ? "" : ` — ${song.artist}`}
            </option>
          ))}
        </select>
        <button
          data-pwid="song-picker-add"
          type="button"
          onClick={add}
          disabled={songId === ""}
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      {error && <div data-pwid="song-picker-error" className="text-sm text-red-400">{error}</div>}
    </div>
  )
}

function EntryRow({
  entry,
  position,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onChanged,
}: {
  entry: SetlistEntryInfo
  position: number
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => Promise<void>
  onMoveDown: () => Promise<void>
  onChanged: () => Promise<void>
}) {
  const { bandId, setlistId } = Route.useParams()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setError(null)
    try {
      await setlists.removeEntry(setlistId, entry.id)
      await onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const meta = [
    entry.key,
    entry.tempo_bpm === null ? null : `${entry.tempo_bpm} BPM`,
    entry.duration_seconds === null ? null : formatDuration(entry.duration_seconds),
  ].flatMap((part) => (part == null ? [] : [part]))

  return (
    <li data-pwid="setlist-entry" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span data-pwid="entry-position" className="text-xs text-zinc-500 w-5 pt-1 shrink-0">{position}</span>
          <div className="min-w-0">
            <div data-pwid="entry-title" className="font-medium truncate">{entry.title}</div>
            <div className="text-sm text-zinc-500 mt-0.5">
              {meta.length > 0 ? meta.join(" · ") : "no details"}
              {entry.key_overridden && " (overridden)"}
            </div>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            data-pwid="entry-up"
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Move up"
            className="px-2 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↑
          </button>
          <button
            data-pwid="entry-down"
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Move down"
            className="px-2 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↓
          </button>
          <Link
            data-pwid="entry-chart"
            to="/band/$bandId/songs/$songId"
            params={{ bandId, songId: entry.song_id }}
            search={entry.key ? { key: entry.key } : {}}
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
          >
            Chart
          </Link>
          <button
            data-pwid="entry-edit"
            type="button"
            onClick={() => setEditing(!editing)}
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
          >
            Overrides
          </button>
          <button
            data-pwid="entry-remove"
            type="button"
            onClick={remove}
            className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer"
          >
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <EntryOverrides
          entry={entry}
          setlistId={setlistId}
          onSaved={async () => {
            setEditing(false)
            await onChanged()
          }}
        />
      )}
      {error && <div data-pwid="entry-error" className="mt-2 text-xs text-red-400">{error}</div>}
    </li>
  )
}

function EntryOverrides({
  entry,
  setlistId,
  onSaved,
}: {
  entry: SetlistEntryInfo
  setlistId: string
  onSaved: () => Promise<void>
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [initial] = useState(() => updatePayload(entry, entry.position))

  const form = useForm({
    defaultValues: initial,
    validators: { onChange: S.toStandardSchemaV1(SetlistEntryUpdate) },
    onSubmit: async ({ value }) => {
      setServerError(null)
      try {
        await setlists.updateEntry(setlistId, entry.id, value)
        await onSaved()
      } catch (e) {
        setServerError(errorMessage(e))
      }
    },
  })

  return (
    <form
      data-pwid="entry-overrides"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
      className="mt-3 pt-3 border-t border-[var(--color-border-subtle)] grid gap-3 sm:grid-cols-3"
    >
      <form.Field name="key_override">
        {(field) => (
          <SelectField
            label="Key"
            pwid="override-key"
            value={field.state.value}
            onChange={(value) => field.handleChange(value === "" ? null : value)}
            options={keyOptions}
            error={fieldError(field)}
          />
        )}
      </form.Field>

      <form.Field name="tempo_override">
        {(field) => (
          <NumberField
            label="Tempo (BPM)"
            pwid="override-tempo"
            value={field.state.value}
            onChange={field.handleChange}
            error={fieldError(field)}
            min={1}
            max={999}
          />
        )}
      </form.Field>

      <form.Field name="notes_override">
        {(field) => (
          <TextAreaField
            label="Notes"
            pwid="override-notes"
            rows={2}
            value={field.state.value ?? ""}
            onChange={(value) => field.handleChange(value === "" ? null : value)}
            error={fieldError(field)}
          />
        )}
      </form.Field>

      {serverError && (
        <div data-pwid="entry-overrides-error" className="sm:col-span-3 text-sm text-red-400">{serverError}</div>
      )}

      <div className="sm:col-span-3">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <SubmitButton
              pwid="override-save"
              disabled={!canSubmit || isSubmitting}
              pending={isSubmitting}
              label="Save overrides"
              pendingLabel="Saving…"
            />
          )}
        </form.Subscribe>
      </div>
    </form>
  )
}
