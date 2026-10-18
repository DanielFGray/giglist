import { useEffect, useRef, useState } from "react"
import { AlphaTabApi, importer, LayoutMode, model, PlayerMode, StaveProfile } from "@coderline/alphatab"
import { scores } from "~/api/client"
import { drawnRange, excerpt, type ScoreLinkReading, type ScoreOutline } from "~/charts/score-link"
import { trackOptions } from "~/charts/score-tracks"
import { alphaTabAssets, inkFrom } from "./alphatab"
import { errorMessage } from "./form"

type Status = "loading" | "ready" | "problem"

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
 * this song; the link then says so and draws nothing. The staff profile is set
 * on every link: the score's own profile can hide the tab.
 */
export function ScoreLink({ reading, revisionId }: { reading: ScoreLinkReading; revisionId: string | undefined }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    if ("problem" in reading) return fail(reading.problem)
    if (revisionId === undefined) return fail("This score is not in this song")
    const link = reading.link
    let disposed = false
    const { scriptFile, fontDirectory } = alphaTabAssets()
    const view = new AlphaTabApi(element, {
      core: { engine: "svg", useWorkers: false, scriptFile, fontDirectory },
      player: { playerMode: PlayerMode.Disabled },
    })
    inkFrom(view.settings, getComputedStyle(element).color)
    view.settings.display.staveProfile = StaveProfile.ScoreTab
    // One row that scrolls sideways, as a phrase draws, so a long section stays short on a phone.
    view.settings.display.layoutMode = LayoutMode.Horizontal
    view.settings.display.scale = 0.8
    view.updateSettings()
    view.error.on((e) => !disposed && fail(`The score cannot be drawn: ${e.message}`))

    scores
      .file(revisionId)
      .then((bytes) => {
        if (disposed) return
        const score = importer.ScoreLoader.loadScoreFromBytes(bytes, view.settings)
        const drawn = drawnRange(link, outlineOf(score))
        if ("problem" in drawn) return fail(drawn.problem)
        excerpt(score.masterBars, drawn.first, drawn.last)
        view.settings.display.startBar = drawn.first + 1
        view.settings.display.barCount = drawn.last - drawn.first + 1
        view.updateSettings()
        view.renderScore(score, [drawn.track])
        setProblem(null)
        setStatus("ready")
      })
      .catch((e) => !disposed && fail(errorMessage(e)))

    function fail(message: string) {
      setProblem(message)
      setStatus("problem")
    }

    return () => {
      disposed = true
      view.destroy()
    }
  }, [reading, revisionId])

  return (
    <div data-pwid="score-link" data-status={status} className="space-y-1">
      {problem !== null && (
        <div data-pwid="score-link-problem" role="alert" className="text-sm text-red-400">
          {problem}
        </div>
      )}
      {/* Reserved while the score loads, so the chart below does not move when the bars arrive. */}
      <div className="overflow-x-auto">
        <div ref={host} data-pwid="score-link-render" className={status === "loading" ? "min-h-40" : undefined} />
      </div>
    </div>
  )
}
