import { Suspense, lazy, useState } from "react"
import { charts, type ChartInfo } from "~/api/client"
import { MusicalKeys, type MusicalKeyType } from "~/api/contracts"
import { AddScore } from "./AddScore"
import { ChartEditor } from "./ChartEditor"
import { MarkedChart } from "./MarkedChart"
import { SelectField, SubmitButton, TextAreaField, TextField, errorMessage } from "./form"

// alphaTab is large and only score charts need it, so it loads on demand.
const ScoreViewer = lazy(() => import("./ScoreViewer").then((m) => ({ default: m.ScoreViewer })))

const keyOptions: ReadonlyArray<{ value: MusicalKeyType | ""; label: string }> = [
  { value: "", label: "Not set" },
  ...MusicalKeys.map((key) => ({ value: key, label: key })),
]

/**
 * The charts of one song. Every chart is drawn in `shownKey`, the key the
 * player needs; a chart written in another key is moved there on screen and
 * stays stored as it was written.
 */
export function SongCharts({
  songId,
  songKey,
  shownKey,
  onShownKeyChange,
  list,
  onChanged,
}: {
  songId: string
  songKey: MusicalKeyType | null
  shownKey: MusicalKeyType | null
  onShownKeyChange: (key: MusicalKeyType | null) => void
  list: ReadonlyArray<ChartInfo>
  onChanged: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [addingScore, setAddingScore] = useState(false)
  const keyChoices = keyOptions.map((o) => (o.value === "" ? { value: o.value, label: "As written" } : o))
  return (
    <section data-pwid="song-charts" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-semibold">Charts</h2>
        {list.some((chart) => chart.kind === "lyrics" && chart.written_key) && (
          <div className="w-40">
            <SelectField
              label="Show in key"
              pwid="chart-shown-key"
              value={shownKey ?? ""}
              onChange={(key) => onShownKeyChange(key === "" ? null : key)}
              options={keyChoices}
            />
          </div>
        )}
      </div>
      {list.length === 0 && !adding && !addingScore && (
        <p data-pwid="charts-empty" className="text-sm text-zinc-500">
          No charts yet. Paste chords over lyrics, or upload a Guitar Pro file, to make one{songKey ? `; this song is in ${songKey}` : ""}.
        </p>
      )}
      {list.map((chart) => (
        <ChartCard key={chart.id} chart={chart} shownKey={shownKey} onChanged={onChanged} />
      ))}
      {adding ? (
        <AddLyricsChart
          songId={songId}
          defaultKey={songKey}
          onDone={async () => {
            setAdding(false)
            await onChanged()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : addingScore ? (
        <AddScore
          songId={songId}
          onDone={async () => {
            setAddingScore(false)
            await onChanged()
          }}
          onCancel={() => setAddingScore(false)}
        />
      ) : (
        <div className="flex gap-2">
          <button
            data-pwid="chart-add"
            type="button"
            onClick={() => setAdding(true)}
            className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          >
            Add a chart
          </button>
          <button
            data-pwid="score-add"
            type="button"
            onClick={() => setAddingScore(true)}
            className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          >
            Add a score
          </button>
        </div>
      )}
    </section>
  )
}

function ChartCard({
  chart,
  shownKey,
  onChanged,
}: {
  chart: ChartInfo
  shownKey: MusicalKeyType | null
  onChanged: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const remove = async () => {
    setError(null)
    try {
      await charts.remove(chart.id)
      await onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <article
      data-pwid="chart"
      className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-4 space-y-3"
    >
      <header className="flex items-center justify-between gap-4">
        <h3 data-pwid="chart-name" className="font-medium">
          {chart.name}
          <span className="ml-2 text-xs text-zinc-500">
            {chart.kind === "score" ? "score" : chart.written_key ? `written in ${chart.written_key}` : "no key set"}
          </span>
        </h3>
        <div className="flex gap-2">
          {chart.source !== null && !editing && (
            <button
              data-pwid="chart-edit"
              type="button"
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
            >
              Edit
            </button>
          )}
        <button
          data-pwid="chart-delete"
          type="button"
          onClick={remove}
          className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer"
        >
          Delete
        </button>
        </div>
      </header>
      {chart.source !== null && editing ? (
        <ChartEditor
          chart={{ ...chart, source: chart.source }}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await onChanged()
          }}
        />
      ) : chart.source !== null ? (
        <MarkedChart chart={{ ...chart, source: chart.source }} shownKey={shownKey} />
      ) : (
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading the score…</p>}>
          <ScoreViewer key={chart.revision_id} revisionId={chart.revision_id} />
        </Suspense>
      )}
      {error && <div data-pwid="chart-error" className="text-sm text-red-400">{error}</div>}
    </article>
  )
}

function AddLyricsChart({
  songId,
  defaultKey,
  onDone,
  onCancel,
}: {
  songId: string
  defaultKey: MusicalKeyType | null
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState("Chords")
  const [writtenKey, setWrittenKey] = useState<MusicalKeyType | null>(defaultKey)
  const [pasted, setPasted] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await charts.createLyrics({ song_id: songId, name, written_key: writtenKey, pasted })
      await onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      data-pwid="chart-form"
      onSubmit={submit}
      className="rounded-lg border border-[var(--color-border-subtle)] p-4 space-y-3"
    >
      <TextField label="Name" pwid="chart-form-name" value={name} onChange={setName} />
      <SelectField
        label="Written in"
        pwid="chart-form-key"
        value={writtenKey ?? ""}
        onChange={(key) => setWrittenKey(key === "" ? null : key)}
        options={keyOptions}
      />
      <TextAreaField
        label="Chords over lyrics"
        pwid="chart-form-pasted"
        value={pasted}
        onChange={setPasted}
        rows={12}
        placeholder={"[Verse 1]\nG         C\nAmazing grace, how sweet"}
      />
      {error && <div data-pwid="chart-form-error" className="text-sm text-red-400">{error}</div>}
      <div className="flex gap-2">
        <SubmitButton pwid="chart-form-submit" disabled={pasted.trim() === ""} pending={pending} label="Add chart" pendingLabel="Adding…" />
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
