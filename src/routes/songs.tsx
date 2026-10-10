import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useAuth } from "~/components/AuthContext"
import { songs, type SongInfo } from "~/api/client"
import { MusicalKeys, type MusicalKeyType } from "~/api/contracts"

export const Route = createFileRoute("/songs")({
  component: Songs,
})

function Songs() {
  const { currentBand } = useAuth()

  if (!currentBand) {
    return (
      <div data-pwid="no-band" className="min-h-[40vh] flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-zinc-500">
          Pick a band first — a song catalog belongs to one band.
        </p>
        <Link
          to="/band/new"
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition"
        >
          Create your first band
        </Link>
      </div>
    )
  }

  // Keyed on band id: switching bands must refetch, not keep the old band's songs.
  return <SongCatalog key={currentBand.id} bandId={currentBand.id} />
}

function SongCatalog({ bandId }: { bandId: string }) {
  const [list, setList] = useState<readonly SongInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    songs
      .byBand(bandId)
      .then((rows) => {
        if (live) setList(rows)
      })
      .catch((e: unknown) => {
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [bandId])

  const reload = () => {
    setList(null)
    setError(null)
    songs
      .byBand(bandId)
      .then(setList)
      .catch((e: unknown) => setError(String(e)))
  }

  if (error) {
    return (
      <div data-pwid="songs-error" className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
        Could not load the song catalog. {error}
        <button onClick={reload} className="ml-3 underline cursor-pointer">
          Try again
        </button>
      </div>
    )
  }

  if (list === null) {
    return <div data-pwid="songs-loading" className="text-zinc-500 text-sm">Loading songs…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Songs</h1>
        <p className="text-sm text-zinc-500 mt-1">Your band's song catalog.</p>
      </div>

      {/* One form at a time: two would duplicate the song-* test hooks. */}
      {editing === null && <SongForm bandId={bandId} onSaved={reload} />}

      {list.length === 0 ? (
        <div data-pwid="songs-empty" className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-8 text-center">
          <p className="text-zinc-500 text-sm">No songs yet.</p>
        </div>
      ) : (
        <SongTable
          songs={list}
          onChanged={reload}
          editing={editing}
          onEditingChange={setEditing}
        />
      )}
    </div>
  )
}

type SongFormProps = {
  bandId: string
  /** Set while editing an existing song. */
  song?: SongInfo
  onSaved: () => void
  onCancel?: () => void
}

function SongForm({ bandId, song, onSaved, onCancel }: SongFormProps) {
  const [title, setTitle] = useState(song?.title ?? "")
  const [artist, setArtist] = useState(song?.artist ?? "")
  const [key, setKey] = useState<MusicalKeyType | "">(song?.key ?? "")
  const [tempo, setTempo] = useState(song?.tempo_bpm?.toString() ?? "")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)

    const result = song
      ? await songs.update(song.id, {
          title,
          artist: artist || null,
          key: key || null,
          tempo_bpm: Number(tempo) || null,
          duration_seconds: song.duration_seconds,
          capo: song.capo,
          notes: song.notes,
        })
      : await songs.create({
          band_id: bandId,
          title,
          artist: artist || null,
          key: key || null,
          tempo_bpm: Number(tempo) || null,
          duration_seconds: null,
          capo: null,
          notes: null,
        })

    setSaving(false)
    if (result.ok) onSaved()
    else setFormError(result.error)
  }

  return (
    <form data-pwid={song ? "song-edit-form" : "song-form"} onSubmit={handleSubmit} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="block text-zinc-300 mb-1">Title</span>
          <input
            data-pwid="song-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-zinc-300 mb-1">Artist</span>
          <input
            data-pwid="song-artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="block text-zinc-300 mb-1">Key</span>
          <select
            data-pwid="song-key"
            value={key}
            onChange={(e) => setKey(e.target.value as MusicalKeyType | "")}
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="">No key</option>
            {MusicalKeys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block text-zinc-300 mb-1">Tempo (BPM)</span>
          <input
            data-pwid="song-tempo"
            value={tempo}
            onChange={(e) => setTempo(e.target.value)}
            type="number"
            min={0}
            max={999}
            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
      </div>

      {formError && (
        <div data-pwid="song-form-error" className="text-sm text-red-400">{formError}</div>
      )}

      <div className="flex gap-2">
        <button
          data-pwid="song-submit"
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer"
        >
          {saving ? "Saving…" : song ? "Save changes" : "Add song"}
        </button>
        {onCancel && (
          <button data-pwid="song-cancel" type="button" onClick={onCancel} className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function SongTable({
  songs: rows,
  onChanged,
  editing,
  onEditingChange,
}: {
  songs: readonly SongInfo[]
  onChanged: () => void
  editing: string | null
  onEditingChange: (id: string | null) => void
}) {
  return (
    <div className="space-y-2">
      {rows.map((song) => (
        <div
          key={song.id}
          data-pwid="song-row"
          className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4"
        >
          {editing === song.id ? (
            <SongForm
              bandId={song.band_id}
              song={song}
              onSaved={() => {
                onEditingChange(null)
                onChanged()
              }}
              onCancel={() => onEditingChange(null)}
            />
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <div data-pwid="song-row-title" className="font-medium">{song.title}</div>
                <div className="text-sm text-zinc-500 mt-0.5">
                  {song.artist ? `${song.artist} · ` : ""}
                  {song.key ? `${song.key} · ` : ""}
                  {song.tempo_bpm !== null ? `${song.tempo_bpm} BPM` : "no tempo"}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  data-pwid="song-edit"
                  onClick={() => onEditingChange(song.id)}
                  className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
                >
                  Edit
                </button>
                <button
                  data-pwid="song-delete"
                  onClick={async () => {
                    const result = await songs.remove(song.id)
                    if (result.ok) onChanged()
                  }}
                  className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
