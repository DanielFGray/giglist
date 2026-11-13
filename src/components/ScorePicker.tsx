import { useEffect, useMemo, useState } from "react"
import { type model } from "@coderline/alphatab"
import { scores, type ChartInfo } from "~/api/client"
import { drawnRange, formatScoreLink, sectionChoices, type ScoreLink as Link, type ScoreOutline } from "alphatab-kit/charts/score-link"
import { trackOptions } from "alphatab-kit/charts/score-tracks"
import { errorMessage } from "./form"
import { outlineOf, ScoreLink } from "./ScoreLink"
import { readScore, ScoreView } from "./ScoreView"
import type { BarSpan } from "alphatab-kit/charts/score-bars"

/**
 * Writes a score link (docs/adr/0004): a score chart of the song, one of its
 * tracks, and a section or a range of bars. The bars are drawn as they will
 * appear in the chart, and Keep waits until they can be drawn.
 */
export function ScorePicker({
  scoreCharts,
  onSave,
  onCancel,
}: {
  /** The song's score charts, which a link can name. */
  scoreCharts: ReadonlyArray<ChartInfo>
  /** Receives the directive's text, the part after `score:`. */
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [chartId, setChartId] = useState(scoreCharts[0]?.id ?? "")
  const revisionId = scoreCharts.find((chart) => chart.id === chartId)?.revision_id
  const [loaded, setLoaded] = useState<{ score: model.Score; outline: ScoreOutline } | null>(null)
  const outline = loaded?.outline ?? null
  const [loadError, setLoadError] = useState<string | null>(null)
  const [track, setTrack] = useState("")
  const [mode, setMode] = useState<"section" | "bars">("section")
  const [section, setSection] = useState("")
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)

  // Reads the chosen score's tracks and sections, and starts the choices at its first of each.
  useEffect(() => {
    if (revisionId === undefined) return
    let stale = false
    setLoaded(null)
    setLoadError(null)
    scores
      .file(revisionId)
      .then((bytes) => {
        if (stale) return
        const score = readScore(bytes)
        const read = outlineOf(score)
        setLoaded({ score, outline: read })
        setTrack(read.tracks[0] ?? "")
        const usable = sectionChoices(read).find((choice) => !choice.repeated)
        setMode(usable ? "section" : "bars")
        setSection(usable?.marker ?? "")
        setFrom(1)
        setTo(read.bars)
      })
      .catch((e) => !stale && setLoadError(errorMessage(e)))
    return () => {
      stale = true
    }
  }, [revisionId])

  const reading = useMemo<{ readonly link: Link }>(
    () => ({ link: { chartId, track, range: mode === "section" ? { section } : { from, to } } }),
    [chartId, track, mode, section, from, to],
  )
  const drawn = outline === null ? null : drawnRange(reading.link, outline)
  const keepable = drawn !== null && !("problem" in drawn)
  // The bars the score view highlights and plays: the From and To inputs, which a drag also sets.
  const selected: BarSpan | null =
    mode === "bars" && outline !== null && Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to <= outline.bars
      ? { first: from - 1, last: to - 1 }
      : null
  // A drag or a clear on the score sets the From and To inputs; clearing chooses the whole score.
  const pickBars = (span: BarSpan | null) => {
    setMode("bars")
    setFrom((span?.first ?? 0) + 1)
    setTo((span?.last ?? (outline?.bars ?? 1) - 1) + 1)
  }
  const trackIndex = loaded ? (trackOptions(loaded.score.tracks).find((option) => option.label === track)?.index ?? 0) : 0
  const field =
    "w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-sm"
  const button =
    "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

  if (scoreCharts.length === 0) {
    return (
      <div data-pwid="score-picker" className="my-2 space-y-2 font-sans">
        <p data-pwid="score-picker-none" className="text-sm text-zinc-400">
          This song has no score. Upload one on the song page, then link its bars here.
        </p>
        <button data-pwid="score-picker-cancel" type="button" onClick={onCancel} className={button}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div data-pwid="score-picker" className="my-2 space-y-2 font-sans">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>Score</span>
          <select data-pwid="score-picker-chart" value={chartId} onChange={(e) => setChartId(e.target.value)} className={field}>
            {scoreCharts.map((chart) => (
              <option key={chart.id} value={chart.id}>
                {chart.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>Track</span>
          <select data-pwid="score-picker-track" value={track} onChange={(e) => setTrack(e.target.value)} className={field}>
            {outline?.tracks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs text-zinc-400">
          <span>Bars by</span>
          <select data-pwid="score-picker-mode" value={mode} onChange={(e) => setMode(e.target.value as "section" | "bars")} className={field}>
            <option value="section">Section marker</option>
            <option value="bars">Bar numbers</option>
          </select>
        </label>
      </div>
      {mode === "section" ? (
        outline && outline.sections.length > 0 ? (
          <label className="block space-y-1 text-xs text-zinc-400">
            <span>Section</span>
            <select data-pwid="score-picker-section" value={section} onChange={(e) => setSection(e.target.value)} className={field}>
              {sectionChoices(outline).map((choice, i) => (
                <option key={i} value={choice.marker} disabled={choice.repeated}>
                  {/* Bar numbers as the score shows them, 1-based. */}
                  {choice.marker} (bars {choice.first + 1}–{choice.last + 1})
                  {choice.repeated ? ", name used twice: use bar numbers" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-zinc-400">This score has no section markers. Use bar numbers.</p>
        )
      ) : (
        <div className="flex flex-wrap items-end gap-2 text-xs text-zinc-400">
          <label className="space-y-1">
            <span>From bar</span>
            <input data-pwid="score-picker-from" type="number" min={1} value={from} onChange={(e) => setFrom(Number(e.target.value))} className={`${field} w-24`} />
          </label>
          <label className="space-y-1">
            <span>To bar</span>
            <input data-pwid="score-picker-to" type="number" min={1} value={to} onChange={(e) => setTo(Number(e.target.value))} className={`${field} w-24`} />
          </label>
          {outline && <span>The score has {outline.bars} bars. Drag across it to fill these in.</span>}
        </div>
      )}
      {loaded && (
        <ScoreView score={loaded.score} track={trackIndex} range={null} selected={selected} onSelect={pickBars} pwid="score-picker-score" />
      )}
      {loadError !== null && (
        <div data-pwid="score-picker-error" role="alert" className="text-sm text-red-400">
          {loadError}
        </div>
      )}
      {revisionId !== undefined && <ScoreLink reading={reading} revisionId={revisionId} />}
      <div className="flex gap-2">
        <button data-pwid="score-picker-keep" type="button" disabled={!keepable} onClick={() => onSave(formatScoreLink(reading.link))} className={button}>
          Keep link
        </button>
        <button data-pwid="score-picker-cancel" type="button" onClick={onCancel} className={button}>
          Cancel
        </button>
      </div>
    </div>
  )
}
