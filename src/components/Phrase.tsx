import { useEffect, useRef, useState } from "react"
import { AlphaTabApi, LayoutMode, NotationElement, PlayerMode } from "@coderline/alphatab"
import { readPhrase, type PhraseProblem } from "~/charts/phrase"
import { alphaTabAssetUrls } from "alphatab-kit"
import { inkFrom } from "./alphatab"
import { useThemeInk } from "./useThemeInk"
import { PlayControls } from "./PlayControls"
import { usePlayback } from "./playback"
import { stretchForWidth } from "./stretch"

/**
 * A phrase drawn by alphaTab, with play, loop, count-in and speed. Systems wrap
 * at the bars that fit the chart's width, so the phrase never scrolls sideways.
 * It starts at `tempo`, the song's tempo, when there is one.
 *
 * Drawing runs on the page's thread: a chart can hold several phrases, and
 * each would otherwise start a render worker. The player (a synthesizer worker
 * and a 1 MB sound font) starts on the first Play, for the same reason. The
 * notation takes the color of the text around it, so it reads on the light
 * page and on the dark stage view.
 */
export function Phrase({ tex, tempo }: { tex: string; tempo: number | null }) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<AlphaTabApi | null>(null)
  const [problems, setProblems] = useState<ReadonlyArray<PhraseProblem>>([])
  const [rendered, setRendered] = useState(false)
  const playback = usePlayback()

  useEffect(() => {
    const element = host.current
    if (!element) return
    const { scriptFile, fontDirectory, soundFont } = alphaTabAssetUrls()
    const view = new AlphaTabApi(element, {
      core: { engine: "svg", useWorkers: false, scriptFile, fontDirectory },
      display: { layoutMode: LayoutMode.Page, scale: 0.8, stretchForce: stretchForWidth(element.clientWidth) },
      player: { playerMode: PlayerMode.Disabled, enableCursor: true, soundFont },
    })
    inkFrom(view.settings, getComputedStyle(element).color)
    for (const hidden of HIDDEN) view.settings.notation.elements.set(hidden, false)
    view.updateSettings()
    // Set on the settings the resize passes, which alphaTab reads before it re-lays out the systems.
    view.resize.on((e) => {
      if (e.settings) e.settings.display.stretchForce = stretchForWidth(e.newWidth)
    })
    view.renderStarted.on(() => setRendered(false))
    view.postRenderFinished.on(() => setRendered(true))
    playback.attach(view, () => {})
    api.current = view
    return () => {
      api.current = null
      playback.detach()
      view.destroy()
    }
  }, [])

  useEffect(() => {
    const view = api.current
    if (!view) return
    const read = readPhrase(tex, tempo, view.settings)
    if ("problems" in read) return setProblems(read.problems)
    setProblems([])
    view.renderScore(read.score)
  }, [tex, tempo])

  useThemeInk(api, host)

  return (
    <div data-pwid="phrase" data-rendered={rendered} className="group relative space-y-1">
      <div className="relative">
        <div ref={host} data-pwid="phrase-render" />
        <PlayControls pwid="phrase" playback={playback} tempo={tempo} disabled={problems.length > 0} />
      </div>
      {problems.length > 0 && (
        <ul data-pwid="phrase-problems" role="alert" className="font-sans text-xs text-red-400">
          {problems.map((p, i) => (
            <li key={i}>
              Line {p.line}, column {p.column}: {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A phrase sits inside a song: the score's title, credits, tuning and track names would repeat the page. */
const HIDDEN = [
  NotationElement.ScoreTitle,
  NotationElement.ScoreSubTitle,
  NotationElement.ScoreArtist,
  NotationElement.ScoreAlbum,
  NotationElement.ScoreWords,
  NotationElement.ScoreMusic,
  NotationElement.ScoreWordsAndMusic,
  NotationElement.ScoreCopyright,
  NotationElement.GuitarTuning,
  NotationElement.TrackNames,
  // A lick needs neither a loudness mark nor numbered bars.
  NotationElement.EffectDynamics,
  NotationElement.BarNumber,
]
