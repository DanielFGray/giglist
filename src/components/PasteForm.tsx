import { useState } from "react"
import { scores, type ChartInfo } from "~/api/client"
import { pasteTarget, type ChartDoc } from "gigbag.js/charts/doc"
import { pastedPassage } from "gigbag.js/charts/lyrics"
import { readScore } from "./AddScore"
import { errorMessage, TextAreaField } from "./form"
import { ReadChartFile } from "./ReadChartFile"

const button =
  "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

/**
 * Chords over lyrics to put into the chart below the line at `after`, read as
 * the Add chart form reads them (`pastedPassage`). The text is typed or pasted,
 * read from a PDF or a photo, or read from one of the song's scores, and the
 * player trims it before it goes in. Its chords stay as written.
 */
export function PasteForm({
  doc,
  after,
  scoreCharts,
  onPaste,
  onCancel,
}: {
  doc: ChartDoc
  after: number
  /** The song's score charts, which the text can be read from. */
  scoreCharts: ReadonlyArray<ChartInfo>
  /** Gets the text as ChordPro, ready for `pasteAfter`. */
  onPaste: (source: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState("")
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const source = pastedPassage(text)
  const { moved } = pasteTarget(doc, after, source)

  const fromScore = async (chart: ChartInfo | undefined) => {
    if (!chart) return
    setError(null)
    setReading(true)
    try {
      const read = await readScore(await scores.file(chart.revision_id))
      if (read?.chart) setText(read.chart.text)
      else setError(read ? "That score has no chords or lyrics to read" : "That score could not be read")
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setReading(false)
    }
  }

  return (
    <div data-pwid="paste-form" className="my-2 space-y-2 rounded-md border border-[var(--color-border-subtle)] p-3 font-sans">
      <ReadChartFile onRead={(read) => setText(read.text)} />
      {scoreCharts.length > 0 && (
        <label className="block space-y-1">
          <span className="text-sm text-zinc-300">Read from a score</span>
          <select
            data-pwid="paste-score"
            value=""
            disabled={reading}
            onChange={(e) => void fromScore(scoreCharts.find((chart) => chart.id === e.target.value))}
            className="block rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
          >
            <option value="">Pick a score…</option>
            {scoreCharts.map((chart) => (
              <option key={chart.id} value={chart.id}>
                {chart.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {reading && <p className="text-sm text-zinc-500">Reading the score…</p>}
      <TextAreaField
        label="Chords over lyrics"
        pwid="paste-text"
        value={text}
        onChange={setText}
        rows={8}
        monospace
        placeholder={"G         C\nAmazing grace, how sweet"}
      />
      {moved && (
        <p data-pwid="paste-moved" className="text-xs text-zinc-400">
          This text has sections of its own, and sections do not nest, so it goes after the end of this section.
        </p>
      )}
      {error && <p data-pwid="paste-error" role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button data-pwid="paste-submit" type="button" onClick={() => onPaste(source)} disabled={source.trim() === ""} className={button}>
          Paste
        </button>
        <button data-pwid="paste-cancel" type="button" onClick={onCancel} className={button}>
          Cancel
        </button>
      </div>
    </div>
  )
}
