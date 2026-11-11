import { useEffect, useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { Option, Schema as S } from "effect"
import { gigs, setlists, songs, type GigInfo, type SetlistEntryInfo, type SetlistEntryUpdateData } from "~/api/client"
import { SetlistStatus } from "~/api/setlists"
import { MusicalKeys } from "~/api/songs"
import { errorMessage } from "~/components/form"
import { useAuth } from "~/components/AuthContext"
import { formatDuration } from "~/components/duration"
import { gigLabel, localToday, splitGigs } from "~/components/gig-label"
import { useLive } from "~/components/live"
import { Viewers } from "~/components/Viewers"
import { moveTo, stepMove } from "~/components/arrangement"
import { Grid, type GridColumn } from "~/components/Grid"
import { matchKeys } from "~/components/key-options"
import { matchSongs } from "~/components/song-match"
import { NameForm, StatusBadge, listLength } from "~/components/SetlistSummary"

export const Route = createFileRoute("/band/$bandId/setlists/$setlistId")({
  loader: async ({ params }) => {
    const [setlist, entries, bandSongs, bandGigs] = await Promise.all([
      setlists.get(params.setlistId),
      setlists.entries(params.setlistId),
      songs.byBand(params.bandId),
      gigs.byBand(params.bandId),
    ])
    return { setlist, entries, bandSongs, bandGigs }
  },
  component: SetlistPage,
})

/** An inherited value, shown grey so a player can tell it from this list's own. */
const inherited = (value: string | number | null) =>
  value === null ? null : <span className="text-zinc-500">{value}</span>

function SetlistPage() {
  const { bandId, setlistId } = Route.useParams()
  const { setlist, entries, bandSongs, bandGigs } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const refresh = () => router.invalidate()

  // Someone else writing the setlist reloads it here and says who did.
  const me = useAuth().user?.username
  const [changedBy, setChangedBy] = useState<string | null>(null)
  const { client, viewers } = useLive({ kind: "setlist", id: setlistId }, { mode: "viewing", at: null }, (by) => {
    void refresh()
    if (by !== null && by !== me) setChangedBy(by)
  })
  useEffect(() => {
    if (changedBy === null) return
    const timer = setTimeout(() => setChangedBy(null), 6000)
    return () => clearTimeout(timer)
  }, [changedBy])

  /** Runs a server write, then reloads; a failure is shown instead of leaving the list stale. */
  const act = async (write: () => Promise<unknown>) => {
    setError(null)
    try {
      await write()
    } catch (e) {
      setError(errorMessage(e))
    }
    await refresh()
  }

  const ids = entries.map((entry) => entry.id)
  const move = (found: Option.Option<{ id: string; previous: string | null }>) =>
    Option.match(found, {
      onNone: () => undefined,
      onSome: (step) => void act(() => setlists.move(setlistId, step)),
    })

  const update = async (entry: SetlistEntryInfo, data: SetlistEntryUpdateData) => {
    await setlists.updateEntry(setlistId, entry.id, data)
    await refresh()
  }

  // Songs already in the list are not offered again, so the choices shrink as the list grows.
  const songChoices = (query: string) => {
    const inList = new Set(entries.map((entry) => entry.song_id))
    return matchSongs(bandSongs.filter((song) => !inList.has(song.id)), query)
      .slice(0, 20)
      .map((song) => ({ value: song.id, label: song.title, hint: song.artist ?? undefined }))
  }

  const columns: ReadonlyArray<GridColumn<SetlistEntryInfo>> = [
    {
      key: "number",
      label: "#",
      width: "3rem",
      align: "right",
      view: (entry) => <span className="text-zinc-500">{ids.indexOf(entry.id) + 1}</span>,
    },
    {
      key: "title",
      label: "Song",
      width: "28%",
      view: (entry) => entry.title,
      edit: {
        kind: "choice",
        text: () => "",
        choices: songChoices,
        save: (entry, songId) => {
          if (songId === "") return Promise.reject(new Error("Ctrl+Delete removes a song from the list"))
          return update(entry, { song_id: songId })
        },
      },
    },
    { key: "artist", label: "Artist", width: "20%", view: (entry) => <span className="text-zinc-400">{entry.artist}</span> },
    {
      key: "key",
      label: "Key",
      width: "6rem",
      view: (entry) => (entry.key_overridden ? entry.key : inherited(entry.key)),
      edit: {
        kind: "choice",
        text: (entry) => (entry.key_overridden ? (entry.key ?? "") : ""),
        choices: (query) => matchKeys(query).map((key) => ({ value: key, label: key })),
        save: (entry, value) => update(entry, { key_override: MusicalKeys.find((key) => key === value) ?? null }),
      },
    },
    {
      key: "tempo",
      label: "BPM",
      width: "5rem",
      align: "right",
      view: (entry) => (entry.tempo_overridden ? entry.tempo_bpm : inherited(entry.tempo_bpm)),
      edit: {
        kind: "text",
        inputMode: "numeric",
        text: (entry) => (entry.tempo_overridden && entry.tempo_bpm !== null ? String(entry.tempo_bpm) : ""),
        save: (entry, value) => update(entry, { tempo_override: tempo(value) }),
      },
    },
    {
      key: "duration",
      label: "Length",
      width: "5.5rem",
      align: "right",
      view: (entry) => <span className="text-zinc-400">{formatDuration(entry.duration_seconds)}</span>,
    },
    {
      key: "notes",
      label: "Notes",
      view: (entry) => (
        <span className="block max-w-72 truncate">{entry.notes_overridden ? entry.notes : inherited(entry.notes)}</span>
      ),
      edit: {
        kind: "text",
        text: (entry) => (entry.notes_overridden ? (entry.notes ?? "") : ""),
        save: (entry, value) => update(entry, { notes_override: value || null }),
      },
    },
  ]

  const button = "px-2 py-1 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SetlistName key={setlist.name} name={setlist.name} onRename={(name) => act(() => setlists.update(setlistId, { name }))} />
          <p data-pwid="setlist-summary" className="text-sm text-zinc-500 mt-1 flex items-center gap-2">
            <StatusBadge status={setlist.status} />
            {listLength(setlist)}
          </p>
          <p data-pwid="setlist-gigs" className="text-sm text-zinc-500 mt-1">
            {setlist.gigs.length === 0 ? (
              "No gig plays this list yet."
            ) : (
              <>
                Played at{" "}
                {setlist.gigs.map((gig, index) => (
                  <span key={gig.id}>
                    {index > 0 && ", "}
                    <Link
                      to="/band/$bandId/gigs/$gigId"
                      params={{ bandId, gigId: gig.id }}
                      data-pwid="setlist-gig"
                      className="text-zinc-300 underline decoration-zinc-600 hover:decoration-[var(--color-amber-accent)]"
                    >
                      {gigLabel(gig)}
                    </Link>
                  </span>
                ))}
                {setlist.gigs.length > 1 && ". A change here reaches every one of them; to change it for one gig, use Copy for this gig on that gig's page."}
              </>
            )}
          </p>
          <AddToGig
            gigs={bandGigs.filter((gig) => !setlist.gigs.some((playing) => playing.id === gig.id))}
            onAdd={(gigId) => act(() => gigs.addSetlist(gigId, setlistId))}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <label className="text-xs text-zinc-400 flex items-center gap-1.5">
            Status
            <select
              data-pwid="setlist-status"
              value={setlist.status}
              onChange={(e) => {
                Option.map(S.decodeUnknownOption(SetlistStatus)(e.target.value), (status) =>
                  act(() => setlists.update(setlistId, { status })),
                )
              }}
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs"
            >
              {SetlistStatus.literals.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <Link
            to="/band/$bandId/setlists/$setlistId/perform"
            params={{ bandId, setlistId }}
            data-pwid="setlist-perform"
            className="px-3 py-1.5 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-xs font-semibold"
          >
            Perform
          </Link>
          <Link
            to="/band/$bandId/setlists"
            params={{ bandId }}
            data-pwid="setlist-back"
            className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300"
          >
            All setlists
          </Link>
        </div>
      </div>

      <Viewers viewers={viewers} me={client} />
      {changedBy !== null && (
        <div data-pwid="setlist-changed" role="status" className="rounded-md border border-[var(--color-amber-accent)]/40 bg-[var(--color-amber-accent)]/10 px-3 py-2 text-sm text-zinc-200">
          {changedBy} changed this setlist. You are looking at the latest version.
        </div>
      )}

      {bandSongs.length === 0 && (
        <p data-pwid="setlist-no-songs" className="text-sm text-zinc-500">
          The band has no songs yet.{" "}
          <Link to="/band/$bandId/songs" params={{ bandId }} className="text-zinc-300 underline">Add songs to the catalog</Link>{" "}
          to put them in a setlist.
        </p>
      )}

      <Grid
        label={`Songs in ${setlist.name}`}
        pwid="setlist-grid"
        rows={entries}
        rowKey={(entry) => entry.id}
        columns={columns}
        newRow={{
          column: "title",
          placeholder: entries.length === 0 ? "Type a song title to add it" : "Add a song…",
          create: async (songId) => {
            const created = await setlists.addEntry(setlistId, { song_id: songId })
            await refresh()
            return created
          },
        }}
        onMoveRow={(id, index) => move(moveTo(ids, id, index))}
        onDeleteRow={(id) => void act(() => setlists.removeEntry(setlistId, id))}
        actions={(entry) => (
          <span className="inline-flex gap-1">
            <button type="button" tabIndex={-1} data-pwid="entry-up" aria-label={`Move ${entry.title} up`} onClick={() => move(stepMove(ids, entry.id, -1))} className={button}>↑</button>
            <button type="button" tabIndex={-1} data-pwid="entry-down" aria-label={`Move ${entry.title} down`} onClick={() => move(stepMove(ids, entry.id, 1))} className={button}>↓</button>
            <Link
              data-pwid="entry-chart"
              tabIndex={-1}
              to="/band/$bandId/songs/$songId"
              params={{ bandId, songId: entry.song_id }}
              search={entry.key ? { key: entry.key } : {}}
              className={button}
            >
              Chart
            </Link>
            <button
              type="button"
              tabIndex={-1}
              data-pwid="entry-remove"
              aria-label={`Remove ${entry.title}`}
              onClick={() => void act(() => setlists.removeEntry(setlistId, entry.id))}
              className={`${button} !border-red-500/20 !text-red-400`}
            >
              Remove
            </button>
          </span>
        )}
      />
      {error && <div data-pwid="setlist-error" className="text-sm text-red-400">{error}</div>}
      <p className="text-xs text-zinc-500">
        Key, BPM and notes here change this list only; clear one to use the song's own (grey). Alt+↑/↓ moves a song,
        Ctrl+Delete removes it.
      </p>

      <SetlistActions bandId={bandId} setlistId={setlistId} name={setlist.name} gigCount={setlist.gigs.length} />
    </div>
  )
}

/**
 * Adds this setlist to one more gig, after the setlists that gig already
 * plays. Upcoming gigs come first, soonest first.
 */
function AddToGig({ gigs: offered, onAdd }: { gigs: ReadonlyArray<GigInfo>; onAdd: (gigId: string) => Promise<void> }) {
  if (offered.length === 0) return null
  const { upcoming, past } = splitGigs(offered, localToday())
  const options = (list: ReadonlyArray<GigInfo>) =>
    list.map((gig) => (
      <option key={gig.id} value={gig.id}>{gigLabel(gig)}</option>
    ))
  return (
    <select
      data-pwid="setlist-add-gig"
      aria-label="Add this setlist to a gig"
      value=""
      onChange={(e) => void onAdd(e.target.value)}
      className="mt-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-zinc-300"
    >
      <option value="" disabled>Add to a gig…</option>
      {upcoming.length > 0 && <optgroup label="Upcoming">{options(upcoming)}</optgroup>}
      {past.length > 0 && <optgroup label="Past">{options(past)}</optgroup>}
    </select>
  )
}

/** A tempo override typed into a cell, or null to inherit the song's. */
function tempo(text: string): number | null {
  if (text === "") return null
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > 999) throw new Error("Tempo is a whole number from 1 to 999")
  return value
}

/** The heading, edited in place: Enter or leaving the field saves it, Escape puts it back. */
function SetlistName({ name, onRename }: { name: string; onRename: (name: string) => Promise<void> }) {
  const [text, setText] = useState(name)
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === "") setText(name)
    else if (trimmed !== name) void onRename(trimmed)
  }
  return (
    <input
      data-pwid="setlist-label"
      aria-label="Setlist name"
      value={text}
      maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          setText(name)
          e.currentTarget.blur()
        }
      }}
      className="w-full bg-transparent text-2xl font-bold tracking-tight focus:outline-none border-b border-transparent focus:border-[var(--color-amber-accent)]"
    />
  )
}

/** Copy the list for one gig, or delete it. */
function SetlistActions({ bandId, setlistId, name, gigCount }: { bandId: string; setlistId: string; name: string; gigCount: number }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-300">Copy this setlist</h2>
        <p className="text-xs text-zinc-500">The copy has the same songs and changes, and plays in no gig until you add it to one.</p>
        <NameForm
          key={name}
          pwid="setlist-copy"
          label="Name of the copy"
          placeholder="Name of the copy"
          submitLabel="Copy"
          initial={`${name} (copy)`}
          onSubmit={async (copyName) => {
            const copy = await setlists.copy(setlistId, copyName)
            await router.navigate({ to: "/band/$bandId/setlists/$setlistId", params: { bandId, setlistId: copy.id } })
          }}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-pwid="setlist-delete"
          onClick={async () => {
            setError(null)
            try {
              await setlists.remove(setlistId)
              await router.navigate({ to: "/band/$bandId/setlists", params: { bandId } })
            } catch (e) {
              setError(errorMessage(e))
            }
          }}
          className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer"
        >
          Delete setlist
        </button>
        {gigCount > 0 && (
          <span className="text-xs text-zinc-500">
            {gigCount === 1 ? "The gig that plays it" : `The ${gigCount} gigs that play it`} will no longer play it.
          </span>
        )}
        {error && <span data-pwid="setlist-delete-error" className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
