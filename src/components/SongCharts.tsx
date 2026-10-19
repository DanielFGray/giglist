import { Suspense, lazy, useEffect, useState } from "react"
import { charts, type ChartInfo } from "~/api/client"
import { exportChords, hasLyricsChart } from "~/charts/lyrics"
import type { NumeralDisplay } from "~/charts/numeral"
import { MusicalKeys, type MusicalKeyType } from "~/api/contracts"
import { AddScore } from "./AddScore"
import { ChartEditor } from "./ChartEditor"
import { ChartViewToggle, chartsInView, type ChartView } from "./ChartViewToggle"
import type { ChordDiagrams } from "./ChordShapes"
import { MarkedChart } from "./MarkedChart"
import { ReadChartFile } from "./ReadChartFile"
import { SelectField, SubmitButton, TextAreaField, TextField, errorMessage } from "./form"

const numeralDisplayOptions: ReadonlyArray<{ value: NumeralDisplay; label: string }> = [
  { value: "both", label: "Names & numerals" },
  { value: "names", label: "Names only" },
  { value: "numerals", label: "Numerals only" },
]

const diagramOptions: ReadonlyArray<{ value: ChordDiagrams; label: string }> = [
  { value: "guitar", label: "Guitar" },
  { value: "staff", label: "Staff" },
  { value: "off", label: "Off" },
]

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
  tempo,
  shownKey,
  onShownKeyChange,
  list,
  onChanged,
}: {
  songId: string
  songKey: MusicalKeyType | null
  /** The song's tempo, which phrases in its charts play at. */
  tempo: number | null
  shownKey: MusicalKeyType | null
  onShownKeyChange: (key: MusicalKeyType | null) => void
  list: ReadonlyArray<ChartInfo>
  onChanged: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  // With both a chord sheet and a score, the page shows one of them, so a long song is not one long page.
  const [view, setView] = useState<ChartView>("chords")
  const [addingScore, setAddingScore] = useState(false)
  // A chart made blank opens in the editor, the same view every chart is edited in.
  const [opened, setOpened] = useState<string | null>(null)
  const [blankError, setBlankError] = useState<string | null>(null)
  const [numeralDisplay, setNumeralDisplay] = useState<NumeralDisplay>("both")
  const [diagrams, setDiagrams] = useState<ChordDiagrams>("guitar")
  const [showChordsAbove, setShowChordsAbove] = useState(true)
  const startBlank = async () => {
    setBlankError(null)
    try {
      const created = await charts.createLyrics({
        song_id: songId,
        name: blankName(list),
        written_key: songKey,
        pasted: BLANK_CHART,
      })
      setOpened(created.id)
      await onChanged()
    } catch (e) {
      setBlankError(errorMessage(e))
    }
  }
  const keyChoices = keyOptions.map((o) => (o.value === "" ? { value: o.value, label: "As written" } : o))
  const hasLyricsWithKey = list.some((chart) => chart.kind === "lyrics" && chart.written_key)
  const hasLyrics = hasLyricsChart(list)
  const scoreCharts = list.filter((chart) => chart.kind === "score")
  return (
    <section data-pwid="song-charts" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-lg font-semibold">Charts</h2>
        <div className="flex flex-wrap justify-end gap-4">
          {hasLyrics && (
            <>
              <div className="w-32">
                <SelectField
                  label="Chord diagrams"
                  pwid="chart-diagrams"
                  value={diagrams}
                  onChange={(v) => v && setDiagrams(v)}
                  options={diagramOptions}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300 self-end pb-2">
                <input
                  data-pwid="chart-show-chords-above"
                  type="checkbox"
                  checked={showChordsAbove}
                  disabled={diagrams === "off"}
                  onChange={(e) => setShowChordsAbove(e.target.checked)}
                />
                Show chords above the chart
              </label>
            </>
          )}
          {hasLyricsWithKey && (
            <>
              <div className="w-40">
                <SelectField
                  label="Show in key"
                  pwid="chart-shown-key"
                  value={shownKey ?? ""}
                  onChange={(key) => onShownKeyChange(key === "" ? null : key)}
                  options={keyChoices}
                />
              </div>
              <div className="w-44">
                <SelectField
                  label="Chord display"
                  pwid="chart-numeral-display"
                  value={numeralDisplay}
                  onChange={(v) => v && setNumeralDisplay(v)}
                  options={numeralDisplayOptions}
                />
              </div>
            </>
          )}
        </div>
      </div>
      <ChartViewToggle list={list} view={view} onChange={setView} />
      {list.length === 0 && !adding && !addingScore && (
        <p data-pwid="charts-empty" className="text-sm text-zinc-500">
          No charts yet. Paste chords over lyrics, read them from a PDF or a photo, or upload a Guitar Pro file, to make one{songKey ? `; this song is in ${songKey}` : ""}.
        </p>
      )}
      {chartsInView(list, view).map((chart) => (
        <ChartCard
          key={chart.id}
          chart={chart}
          startEditing={chart.id === opened}
          shownKey={shownKey}
          tempo={tempo}
          onChanged={onChanged}
          numeralDisplay={numeralDisplay}
          diagrams={diagrams}
          showChordsAbove={showChordsAbove}
          scoreCharts={scoreCharts}
        />
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
            data-pwid="chart-blank"
            type="button"
            onClick={() => void startBlank()}
            className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold cursor-pointer"
          >
            Write a chart
          </button>
          <button
            data-pwid="chart-add"
            type="button"
            onClick={() => setAdding(true)}
            className="px-4 py-2 rounded-md border border-[var(--color-border-subtle)] text-sm text-zinc-300 cursor-pointer"
          >
            Paste or read a chart
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
      {blankError && <div data-pwid="chart-blank-error" className="text-sm text-red-400">{blankError}</div>}
    </section>
  )
}

/** One empty verse: the editor edits lines, so a new chart starts with a line to write on. */
const BLANK_CHART = "[Verse 1]\n "

/** "Chords", then "Chords 2" and so on, so a song's charts stay tellable apart. */
const blankName = (list: ReadonlyArray<ChartInfo>): string =>
  list.some((chart) => chart.name === "Chords") ? `Chords ${list.length + 1}` : "Chords"

function ChartCard({
  chart,
  startEditing,
  shownKey,
  tempo,
  onChanged,
  numeralDisplay,
  diagrams,
  showChordsAbove,
  scoreCharts,
}: {
  chart: ChartInfo
  startEditing: boolean
  shownKey: MusicalKeyType | null
  tempo: number | null
  onChanged: () => Promise<void>
  numeralDisplay: NumeralDisplay
  diagrams: ChordDiagrams
  showChordsAbove: boolean
  /** The song's score charts: a score link draws from one, and the editor's picker offers them. */
  scoreCharts: ReadonlyArray<ChartInfo>
}) {
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(startEditing && chart.source !== null)
  const [annotating, setAnnotating] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async (source: string) => {
    setError(null)
    try {
      await navigator.clipboard.writeText(exportChords(source, shownKey))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
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
              data-pwid="chart-copy"
              type="button"
              onClick={() => void copy(chart.source!)}
              title={`Copy the chords over lyrics${shownKey ? `, in ${shownKey}` : ""}`}
              className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {chart.source !== null && !editing && (
            <button
              data-pwid="chart-edit"
              type="button"
              onClick={() => {
                setAnnotating(false)
                setEditing(true)
              }}
              className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
            >
              Edit
            </button>
          )}
          {chart.source !== null && !editing && (
            <button
              data-pwid="chart-annotate"
              type="button"
              aria-pressed={annotating}
              onClick={() => setAnnotating(!annotating)}
              className={`px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs cursor-pointer ${annotating ? "bg-[var(--color-amber-accent)] text-zinc-950" : "text-zinc-300"}`}
            >
              Annotate
            </button>
          )}
          {chart.source !== null && editing && (
            <button
              data-pwid="chart-close"
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer"
            >
              Close
            </button>
          )}
          {/* A score has no Edit, so its Delete stays: it would have no other way out. */}
          {(chart.source === null || editing) && (
            <button
              data-pwid="chart-delete"
              type="button"
              onClick={remove}
              className="px-3 py-1.5 rounded-md border border-red-500/20 text-xs text-red-400 cursor-pointer"
            >
              Delete
            </button>
          )}
        </div>
      </header>
      {chart.source !== null && editing ? (
        <ChartEditor
          chart={{ ...chart, source: chart.source }}
          tempo={tempo}
          scoreCharts={scoreCharts}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await onChanged()
          }}
        />
      ) : chart.source !== null ? (
        <MarkedChart
          chart={{ ...chart, source: chart.source }}
          shownKey={shownKey}
          tempo={tempo}
          annotating={annotating}
          numeralDisplay={numeralDisplay}
          diagrams={diagrams}
          showChordsAbove={showChordsAbove}
          scoreCharts={scoreCharts}
        />
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
  // The file the text was read from, shown beside it so the player can check the reading.
  const [original, setOriginal] = useState<{ url: string; pdf: boolean } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => {
    if (original) URL.revokeObjectURL(original.url)
  }, [original])

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
      <ReadChartFile
        onRead={({ text, file }) => {
          setPasted(text)
          setOriginal({ url: URL.createObjectURL(file), pdf: file.type === "application/pdf" })
        }}
      />
      <div className={original ? "grid gap-3 md:grid-cols-2" : undefined}>
        <TextAreaField
          label="Chords over lyrics"
          pwid="chart-form-pasted"
          value={pasted}
          onChange={setPasted}
          rows={original ? 24 : 12}
          monospace
          placeholder={"[Verse 1]\nG         C\nAmazing grace, how sweet"}
        />
        {original && (
          <figure data-pwid="chart-form-original" className="space-y-1">
            <figcaption className="text-sm text-zinc-300">The file it was read from</figcaption>
            {original.pdf ? (
              <iframe src={original.url} title="The uploaded PDF" className="h-[36rem] w-full rounded-md bg-white" />
            ) : (
              <img src={original.url} alt="The uploaded chart" className="max-h-[36rem] w-full rounded-md object-contain bg-white" />
            )}
          </figure>
        )}
      </div>
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
