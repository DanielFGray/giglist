import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { Option, Schema as S } from "effect"
import { songs, type SongInfo, type SongUpdateData } from "~/api/client"
import { errorMessage } from "~/components/form"
import { DURATION, formatDuration, parseDuration } from "~/components/duration"
import { BLANK_SONG } from "~/components/SongForm"
import { Grid, type GridColumn } from "~/components/Grid"
import { keepOrder } from "~/components/grid-keys"
import { matchKeys } from "~/components/key-options"
import { MUSICAL_KEYS } from "alphatab-kit/charts/key"

const SortKey = S.Literals(["added", "title", "artist", "key", "tempo"])
type SortKey = (typeof SortKey)["Type"]

/**
 * The list's filter state lives in the URL, so a sorted or filtered view is
 * linkable and survives back/forward. Both parts are optional: a link to the
 * bare list needs no search, and the component supplies the defaults.
 */
const SongSearch = S.Struct({
  q: S.optional(S.String),
  sort: S.optional(SortKey),
})

type SongSearchParams = (typeof SongSearch)["Type"]

/** An empty filter, typed so the validated search is not widened to `{}`. */
const EMPTY_SEARCH: SongSearchParams = {}

export const Route = createFileRoute("/band/$bandId/songs/")({
  validateSearch: (search) =>
    Option.match(S.decodeOption(SongSearch)(search), {
      onNone: () => EMPTY_SEARCH,
      onSome: (value) => value,
    }),
  loader: async ({ params }) => ({ songs: await songs.byBand(params.bandId) }),
  component: SongCatalog,
})

/** Case-insensitive match against the fields a player would search by. */
const matches = (song: SongInfo, needle: string): boolean =>
  [song.title, song.artist ?? "", song.key ?? ""].some((field) =>
    field.toLowerCase().includes(needle),
  )

/** A comparator per sort key, so the select and the comparator share one union. */
const COMPARATORS: Record<SortKey, (a: SongInfo, b: SongInfo) => number> = {
  added: (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
  title: (a, b) => a.title.localeCompare(b.title),
  artist: (a, b) => (a.artist ?? "").localeCompare(b.artist ?? "") || a.title.localeCompare(b.title),
  key: (a, b) => (a.key ?? "").localeCompare(b.key ?? "") || a.title.localeCompare(b.title),
  tempo: (a, b) => (a.tempo_bpm ?? 0) - (b.tempo_bpm ?? 0) || a.title.localeCompare(b.title),
}

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "added", label: "Order added" },
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "key", label: "Key" },
  { value: "tempo", label: "Tempo" },
]

function SongCatalog() {
  const { bandId } = Route.useParams()
  const { songs: list } = Route.useLoaderData()
  const search = Route.useSearch()
  const sort = search.sort ?? "added"
  const q = search.q ?? ""
  const navigate = Route.useNavigate()
  const router = useRouter()

  const needle = q.trim().toLowerCase()
  const sorted = list.filter((song) => needle === "" || matches(song, needle)).toSorted(COMPARATORS[sort])

  // The grid sorts when the sort or search changes, not when a cell does: an
  // edited or new row keeps its place until the person sorts again.
  const view = `${sort}\u0000${needle}`
  const [order, setOrder] = useState({ view, keys: sorted.map((song) => song.id) })
  const keys = order.view === view ? keepOrder(order.keys, sorted.map((song) => song.id)) : sorted.map((song) => song.id)
  if (order.view !== view || keys.join() !== order.keys.join()) setOrder({ view, keys })
  const byId = new Map(list.map((song) => [song.id, song]))
  const rows = keys.flatMap((id) => byId.get(id) ?? [])

  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // A song is saved the moment it is added, so its charts can be written before it has a name.
  const add = async () => {
    setAdding(true)
    try {
      const created = await songs.create({ ...BLANK_SONG, band_id: bandId })
      await router.invalidate()
      await router.navigate({
        to: "/band/$bandId/songs/$songId",
        params: { bandId, songId: created.id },
        search: { edit: true },
      })
    } catch (e) {
      setAddError(errorMessage(e))
      setAdding(false)
    }
  }

  const update = async (song: SongInfo, data: SongUpdateData) => {
    await songs.update(song.id, data)
    await router.invalidate()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Songs</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Your band's song catalog. Type in a cell to change it; type a title in the last row to add a song.
          </p>
        </div>
        <button
          type="button"
          data-pwid="song-new"
          disabled={adding}
          onClick={() => void add()}
          title="A blank song opened in the editor; a Guitar Pro file added to it fills in its title and details"
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition shrink-0 cursor-pointer disabled:opacity-60"
        >
          Add from a score
        </button>
      </div>

      {addError && <div data-pwid="song-new-error" className="text-sm text-red-400">{addError}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-48 text-sm">
          <span className="block text-zinc-300 mb-1">Search</span>
          <input
            data-pwid="songs-search"
            type="search"
            value={q}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({ ...prev, q: e.target.value }),
                replace: true,
              })
            }
            placeholder="Title, artist or key"
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
          />
        </label>
        <label className="text-sm">
          <span className="block text-zinc-300 mb-1">Sort by</span>
          <select
            data-pwid="songs-sort"
            value={sort}
            onChange={(e) => {
              const next = SORT_OPTIONS.find((option) => option.value === e.target.value)
              if (next !== undefined) {
                void navigate({
                  search: (prev) => ({ ...prev, sort: next.value }),
                  replace: true,
                })
              }
            }}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {needle !== "" && rows.length === 0 && (
        <p data-pwid="songs-no-match" className="text-sm text-zinc-500">No songs match “{q}”.</p>
      )}

      <Grid
        label="Songs"
        pwid="songs-grid"
        rows={rows}
        rowKey={(song) => song.id}
        columns={songColumns(update)}
        newRow={{
          column: "title",
          placeholder: list.length === 0 ? "Type a song title to start" : "New song…",
          create: async (title) => {
            const created = await songs.create({ ...BLANK_SONG, band_id: bandId, title })
            await router.invalidate()
            return created
          },
        }}
        actions={(song) => <SongActions bandId={bandId} song={song} onDeleted={() => router.invalidate()} />}
      />
      <p className="text-xs text-zinc-500">
        Arrows or Tab move · type or Enter to edit · Enter saves and goes down · Esc cancels · Delete clears
      </p>
    </div>
  )
}

/** The catalog's columns. `update` saves one song and resolves once the page has reloaded it. */
function songColumns(update: (song: SongInfo, data: SongUpdateData) => Promise<void>): ReadonlyArray<GridColumn<SongInfo>> {
  return [
    {
      key: "title",
      label: "Title",
      width: "28%",
      view: (song) => song.title,
      edit: {
        kind: "text",
        text: (song) => song.title,
        save: (song, value) => {
          if (value === "") return Promise.reject(new Error("A song needs a title"))
          return update(song, { title: value })
        },
      },
    },
    {
      key: "artist",
      label: "Artist",
      width: "22%",
      view: (song) => song.artist,
      edit: { kind: "text", text: (song) => song.artist ?? "", save: (song, value) => update(song, { artist: value || null }) },
    },
    {
      key: "key",
      label: "Key",
      width: "6rem",
      view: (song) => song.key,
      edit: {
        kind: "choice",
        text: (song) => song.key ?? "",
        choices: (query) => matchKeys(query).map((key) => ({ value: key, label: key })),
        save: (song, value) => update(song, { key: MUSICAL_KEYS.find((key) => key === value) ?? null }),
      },
    },
    {
      key: "tempo",
      label: "BPM",
      width: "5rem",
      align: "right",
      view: (song) => song.tempo_bpm,
      edit: {
        kind: "text",
        inputMode: "numeric",
        text: (song) => (song.tempo_bpm === null ? "" : String(song.tempo_bpm)),
        save: (song, value) => update(song, { tempo_bpm: wholeNumber(value, 1, 999, "Tempo") }),
      },
    },
    {
      key: "duration",
      label: "Length",
      width: "5.5rem",
      align: "right",
      view: (song) => formatDuration(song.duration_seconds),
      edit: {
        kind: "text",
        placeholder: "m:ss",
        text: (song) => formatDuration(song.duration_seconds),
        save: (song, value) => {
          if (value !== "" && !DURATION.test(value)) return Promise.reject(new Error("Length is minutes:seconds, like 3:45"))
          return update(song, { duration_seconds: parseDuration(value) })
        },
      },
    },
    {
      key: "capo",
      label: "Capo",
      width: "4.5rem",
      align: "right",
      view: (song) => (song.capo === null || song.capo === 0 ? null : song.capo),
      edit: {
        kind: "text",
        inputMode: "numeric",
        text: (song) => (song.capo === null ? "" : String(song.capo)),
        save: (song, value) => update(song, { capo: wholeNumber(value, 0, 12, "Capo") }),
      },
    },
    {
      key: "notes",
      label: "Notes",
      view: (song) => <span className="block max-w-72 truncate text-zinc-400">{song.notes}</span>,
      edit: { kind: "text", text: (song) => song.notes ?? "", save: (song, value) => update(song, { notes: value || null }) },
    },
  ]
}

/**
 * A whole number typed into a cell, or null for an empty cell. Rejects text
 * outside [min, max] with a message naming the column.
 */
function wholeNumber(text: string, min: number, max: number, name: string): number | null {
  if (text === "") return null
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} is a whole number from ${min} to ${max}`)
  }
  return value
}

function SongActions({ bandId, song, onDeleted }: { bandId: string; song: SongInfo; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const button = "px-2 py-1 rounded-md border text-xs cursor-pointer"
  return (
    <span className="inline-flex items-center gap-1.5">
      {error && <span data-pwid="song-delete-error" className="text-xs text-red-400">{error}</span>}
      <Link
        to="/band/$bandId/songs/$songId"
        params={{ bandId, songId: song.id }}
        data-pwid="song-open"
        tabIndex={-1}
        className={`${button} border-[var(--color-border-subtle)] text-zinc-300`}
      >
        Charts
      </Link>
      <button
        type="button"
        data-pwid="song-delete"
        tabIndex={-1}
        aria-label={`Delete ${song.title}`}
        onClick={async () => {
          setError(null)
          try {
            await songs.remove(song.id)
            onDeleted()
          } catch (e) {
            setError(errorMessage(e))
          }
        }}
        className={`${button} border-red-500/20 text-red-400`}
      >
        Delete
      </button>
    </span>
  )
}
