import { useState } from "react"
import { charts, scores } from "~/api/client"
import type { MusicalKeyType } from "~/api/songs"
import { MAX_SCORE_BYTES, chartNameFromFile, scoreFormat } from "~/charts/score-file"
import { scoreMeta, type ScoreMeta } from "~/charts/score-meta"
import type { ScoreChart } from "~/charts/score-chart"
import { SelectField, SubmitButton, TextAreaField, TextField, errorMessage } from "./form"
import { keyOptions } from "./key-options"

/**
 * Upload a Guitar Pro file as a new score chart. The server stores the file's
 * bytes unchanged as the chart's first revision. The browser also reads the
 * file's title, artist and tempo: the title names the chart, and `onScoreRead`
 * lets the song take all three after the upload. A file alphaTab cannot read
 * still uploads, with its file name for a title.
 *
 * The browser also reads the score's chords and lyrics as chords over lyrics
 * (`chartFromScore`), which the player corrects and adds as a lyrics chart
 * beside the score (docs/adr/0007).
 */
export function AddScore({
  songId,
  onScoreRead,
  onDone,
  onCancel,
}: {
  songId: string
  onScoreRead?: (meta: ScoreMeta) => Promise<void>
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; meta: ScoreMeta | null } | null>(null)
  const [name, setName] = useState("")
  const [draft, setDraft] = useState<ChartDraft | null>(null)
  // Set once the score is stored, so a retry after a failed chart does not upload it twice.
  const [scoreSaved, setScoreSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = async (picked: File | undefined) => {
    setError(null)
    setFile(null)
    setDraft(null)
    setScoreSaved(false)
    if (!picked) return
    if (picked.size > MAX_SCORE_BYTES) return setError("That file is too large for a score")
    const bytes = new Uint8Array(await picked.arrayBuffer())
    if (scoreFormat(bytes) === null) return setError("That is not a Guitar Pro file (.gp, .gp3, .gp4, .gp5 or .gpx)")
    const read = await readScore(bytes)
    setFile({ name: picked.name, bytes, meta: read?.meta ?? null })
    setName((current) => current || read?.meta.title || chartNameFromFile(picked.name))
    if (read?.chart) setDraft(draftOf(read.chart))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return
    setPending(true)
    setError(null)
    let saved = scoreSaved
    try {
      if (!saved) {
        await scores.upload({ song_id: songId, name, file_name: file.name, bytes: file.bytes })
        saved = true
        setScoreSaved(true)
        // The score is already saved, so a song that cannot take its details is not an upload error.
        if (file.meta) await onScoreRead?.(file.meta).catch(() => undefined)
      }
      if (draft?.add && draft.text.trim() !== "") {
        await charts.createLyrics({ song_id: songId, name: "Chords", written_key: draft.key, pasted: draft.text })
      }
      await onDone()
    } catch (e) {
      setError(saved ? `The score was added, but the chart was not: ${errorMessage(e)}` : errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      data-pwid="score-form"
      onSubmit={submit}
      className="rounded-lg border border-[var(--color-border-subtle)] p-4 space-y-3"
    >
      <label className="block space-y-1">
        <span className="text-sm text-zinc-300">Guitar Pro file</span>
        <input
          data-pwid="score-form-file"
          type="file"
          accept=".gp,.gp3,.gp4,.gp5,.gpx"
          onChange={(e) => void choose(e.target.files?.[0])}
          className="block text-sm text-zinc-300"
        />
      </label>
      <TextField label="Name" pwid="score-form-name" value={name} onChange={setName} />
      {draft && <ChartDraftFields draft={draft} scoreSaved={scoreSaved} onChange={setDraft} />}
      {error && <div data-pwid="score-form-error" className="text-sm text-red-400">{error}</div>}
      <div className="flex gap-2">
        <SubmitButton
          pwid="score-form-submit"
          disabled={file === null || name.trim() === ""}
          pending={pending}
          label={scoreSaved ? "Add chart" : "Add score"}
          pendingLabel="Uploading…"
        />
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The lyrics chart read from the score, as the player is correcting it. */
type ChartDraft = {
  /** Whether to add it beside the score. */
  readonly add: boolean
  readonly key: MusicalKeyType | null
  readonly text: string
  /** True when the chords were worked out from the notes. */
  readonly inferred: boolean
}

/** A score with lyrics offers its chart ticked; chord-only lines start unticked. */
function draftOf(chart: ScoreChart): ChartDraft {
  return { add: chart.sung, key: chart.key, text: chart.text, inferred: chart.inferred }
}

function ChartDraftFields({ draft, scoreSaved, onChange }: { draft: ChartDraft; scoreSaved: boolean; onChange: (draft: ChartDraft) => void }) {
  return (
    <>
      {!scoreSaved && (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            data-pwid="score-form-chart"
            type="checkbox"
            checked={draft.add}
            onChange={(e) => onChange({ ...draft, add: e.target.checked })}
          />
          Also add a chords-over-lyrics chart read from this score
        </label>
      )}
      {draft.add && (
        <div className="space-y-3">
          <SelectField
            label="Written in"
            pwid="score-form-chart-key"
            value={draft.key ?? ""}
            onChange={(key) => onChange({ ...draft, key: key === "" ? null : key })}
            options={keyOptions}
          />
          {draft.inferred && (
            <p data-pwid="score-form-chart-inferred" className="text-sm text-amber-300">
              The file names no chords, so these were worked out from the notes. Check them against a recording.
            </p>
          )}
          <TextAreaField
            label="Chords over lyrics"
            pwid="score-form-chart-text"
            value={draft.text}
            onChange={(text) => onChange({ ...draft, text })}
            rows={16}
            monospace
          />
        </div>
      )}
    </>
  )
}

/**
 * The file's title, artist and tempo, and its chords and lyrics as chords over
 * lyrics, or null when alphaTab cannot read it. alphaTab is large, so it and
 * the reader that walks its model load on demand.
 */
async function readScore(bytes: Uint8Array): Promise<{ meta: ScoreMeta; chart: ScoreChart | null } | null> {
  try {
    const [{ importer, Settings }, { chartFromScore }] = await Promise.all([import("@coderline/alphatab"), import("~/charts/score-chart")])
    const score = importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
    return { meta: scoreMeta(score), chart: chartFromScore(score) }
  } catch {
    return null
  }
}
