import { useEffect, useState } from "react"
import { model } from "@coderline/alphatab"
import { scores } from "~/api/client"
import { drawnRange, excerpt, type ScoreLinkReading, type ScoreOutline } from "alphatab-kit/charts/score-link"
import { trackOptions } from "alphatab-kit/charts/score-tracks"
import { errorMessage } from "./form"
import { readScore, ScoreView } from "./ScoreView"
import type { BarSpan } from "alphatab-kit/charts/score-bars"

/** A loaded score's tracks, section markers and bar count: what a link is checked against. */
export function outlineOf(score: model.Score): ScoreOutline {
  return {
    tracks: trackOptions(score.tracks).map((t) => t.label),
    sections: score.masterBars.flatMap((bar, index) => (bar.section ? [{ index, marker: bar.section.marker }] : [])),
    bars: score.masterBars.length,
  }
}

/**
 * The bars of a score chart that a score link names (docs/adr/0004), drawn in
 * place in a lyrics chart. The score is read from the chart's latest revision,
 * so a re-upload changes these bars and nothing in the lyrics text.
 *
 * `revisionId` is undefined when the directive names a chart that is not in
 * this song; the link then says so and draws nothing.
 */
export function ScoreLink({ reading, revisionId }: { reading: ScoreLinkReading; revisionId: string | undefined }) {
  const [drawn, setDrawn] = useState<{ score: model.Score; track: number; span: BarSpan } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // A passage the reader drags across the drawn bars. It plays and loops; null plays the drawn bars.
  const [selected, setSelected] = useState<BarSpan | null>(null)

  useEffect(() => {
    if ("problem" in reading) return fail(reading.problem)
    if (revisionId === undefined) return fail("This score is not in this song")
    const link = reading.link
    let disposed = false
    setDrawn(null)
    setProblem(null)
    setSelected(null)
    scores
      .file(revisionId)
      .then((bytes) => {
        if (disposed) return
        const score = readScore(bytes)
        const span = drawnRange(link, outlineOf(score))
        if ("problem" in span) return fail(span.problem)
        excerpt(score.masterBars, span.first, span.last)
        setDrawn({ score, track: span.track, span: { first: span.first, last: span.last } })
      })
      .catch((e) => !disposed && fail(errorMessage(e)))

    function fail(message: string) {
      setProblem(message)
      setDrawn(null)
    }

    return () => {
      disposed = true
    }
  }, [reading, revisionId])

  const status = problem !== null ? "problem" : drawn ? "ready" : "loading"
  return (
    <div data-pwid="score-link" data-status={status} className="space-y-1">
      {problem !== null && (
        <div data-pwid="score-link-problem" role="alert" className="text-sm text-red-400">
          {problem}
        </div>
      )}
      {drawn ? (
        <ScoreView
          score={drawn.score}
          track={drawn.track}
          range={drawn.span}
          selected={selected}
          onSelect={setSelected}
          pwid="score-link"
          onError={(message) => {
            setProblem(`The score cannot be drawn: ${message}`)
            setDrawn(null)
          }}
        />
      ) : (
        // Reserved while the score loads, so the chart below does not move when the bars arrive.
        status === "loading" && <div className="min-h-40" />
      )}
    </div>
  )
}
