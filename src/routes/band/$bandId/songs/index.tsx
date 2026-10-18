import { useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { Option, Schema as S } from "effect"
import { songs, type SongInfo } from "~/api/client"
import { errorMessage } from "~/components/form"
import { formatDuration } from "~/components/duration"
import { BLANK_SONG } from "~/components/SongForm"

const SortKey = S.Literals(["title", "artist", "key", "tempo"])
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
  title: (a, b) => a.title.localeCompare(b.title),
  artist: (a, b) => (a.artist ?? "").localeCompare(b.artist ?? "") || a.title.localeCompare(b.title),
  key: (a, b) => (a.key ?? "").localeCompare(b.key ?? "") || a.title.localeCompare(b.title),
  tempo: (a, b) => (a.tempo_bpm ?? 0) - (b.tempo_bpm ?? 0) || a.title.localeCompare(b.title),
}

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "key", label: "Key" },
  { value: "tempo", label: "Tempo" },
]

function SongCatalog() {
  const { bandId } = Route.useParams()
  const { songs: list } = Route.useLoaderData()
  const search = Route.useSearch()
  const sort = search.sort ?? "title"
  const q = search.q ?? ""
  const navigate = Route.useNavigate()
  const router = useRouter()
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

  const needle = q.trim().toLowerCase()
  const visible = list
    .filter((song) => needle === "" || matches(song, needle))
    .toSorted(COMPARATORS[sort])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Songs</h1>
          <p className="text-sm text-zinc-500 mt-1">Your band's song catalog.</p>
        </div>
        <button
          type="button"
          data-pwid="song-new"
          disabled={adding}
          onClick={() => void add()}
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition shrink-0 cursor-pointer disabled:opacity-60"
        >
          Add song
        </button>
      </div>

      {addError && <div data-pwid="song-new-error" className="text-sm text-red-400">{addError}</div>}

      {list.length > 0 && (
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
      )}

      {list.length === 0 ? (
        <div data-pwid="songs-empty" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No songs yet.</p>
        </div>
      ) : visible.length === 0 ? (
        <div data-pwid="songs-no-match" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No songs match “{q}”.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((song) => (
            <SongRow
              key={song.id}
              bandId={bandId}
              song={song}
              onDeleted={() => router.invalidate()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SongRow({
  bandId,
  song,
  onDeleted,
}: {
  bandId: string
  song: SongInfo
  onDeleted: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const meta = [
    song.artist,
    song.key,
    song.tempo_bpm === null ? null : `${song.tempo_bpm} BPM`,
    song.duration_seconds === null ? null : formatDuration(song.duration_seconds),
    song.capo === null || song.capo === 0 ? null : `capo ${song.capo}`,
  ].flatMap((part) => (part == null ? [] : [part]))

  return (
    <div data-pwid="song-row" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium">
            <Link
              to="/band/$bandId/songs/$songId"
              params={{ bandId, songId: song.id }}
              data-pwid="song-row-title"
              className="hover:underline"
            >
              {song.title}
            </Link>
          </div>
          <div data-pwid="song-row-meta" className="text-sm text-zinc-500 mt-0.5">
            {meta.length > 0 ? meta.join(" · ") : "no details"}
          </div>
          {song.notes !== null && song.notes !== "" && (
            <div data-pwid="song-row-notes" className="text-xs text-zinc-600 mt-1 line-clamp-2">
              {song.notes}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            to="/band/$bandId/songs/$songId"
            params={{ bandId, songId: song.id }}
            search={{ edit: true }}
            data-pwid="song-edit"
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
          >
            Edit
          </Link>
          <button
            data-pwid="song-delete"
            onClick={async () => {
              setError(null)
              try {
                await songs.remove(song.id)
                onDeleted()
              } catch (e) {
                setError(errorMessage(e))
              }
            }}
            className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
      {error && (
        <div data-pwid="song-delete-error" className="mt-2 text-xs text-red-400">{error}</div>
      )}
    </div>
  )
}
