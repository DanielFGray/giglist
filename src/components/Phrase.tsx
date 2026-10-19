import { useEffect, useRef, useState } from "react"
import { AlphaTabApi, LayoutMode, NotationElement, PlayerMode, synth } from "@coderline/alphatab"
import { readPhrase, type PhraseProblem } from "~/charts/phrase"
import { alphaTabAssets, inkFrom } from "./alphatab"

const SPEEDS = [0.5, 0.75, 0.9, 1] as const

/**
 * A phrase drawn by alphaTab in one row, with play, loop, count-in and speed.
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
  // Play was pressed before the player was ready: it plays once it is.
  const playWhenReady = useRef(false)
  const [problems, setProblems] = useState<ReadonlyArray<PhraseProblem>>([])
  const [rendered, setRendered] = useState(false)
  const [player, setPlayer] = useState<"off" | "loading" | "ready">("off")
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const { scriptFile, fontDirectory, soundFont } = alphaTabAssets()
    const view = new AlphaTabApi(element, {
      core: { engine: "svg", useWorkers: false, scriptFile, fontDirectory },
      display: { layoutMode: LayoutMode.Horizontal, scale: 0.8 },
      player: { playerMode: PlayerMode.Disabled, enableCursor: true, soundFont },
    })
    inkFrom(view.settings, getComputedStyle(element).color)
    for (const hidden of HIDDEN) view.settings.notation.elements.set(hidden, false)
    view.updateSettings()
    view.renderStarted.on(() => setRendered(false))
    view.postRenderFinished.on(() => setRendered(true))
    view.playerReady.on(() => {
      setPlayer("ready")
      if (!playWhenReady.current) return
      playWhenReady.current = false
      view.play()
    })
    view.playerStateChanged.on((event) => setPlaying(event.state === synth.PlayerState.Playing))
    api.current = view
    return () => {
      api.current = null
      playWhenReady.current = false
      setPlayer("off")
      setPlaying(false)
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

  // alphaTab keeps these until its player exists.
  useEffect(() => {
    const view = api.current
    if (!view) return
    view.isLooping = loop
    view.countInVolume = countIn ? 1 : 0
    view.playbackSpeed = speed
  }, [loop, countIn, speed])

  // Re-ink the notation when the global theme toggles, so it follows the page.
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const view = api.current
      const element = host.current
      if (!view || !element) return
      inkFrom(view.settings, getComputedStyle(element).color)
      view.updateSettings()
      view.render()
    }
    const observer = new MutationObserver(apply)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  const playOrStop = () => {
    const view = api.current
    if (!view) return
    if (playing) return view.stop()
    if (player === "ready") return view.play()
    if (player === "loading") return
    playWhenReady.current = true
    setPlayer("loading")
    view.settings.player.playerMode = PlayerMode.EnabledSynthesizer
    view.updateSettings()
  }

  const control = "rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs cursor-pointer disabled:opacity-40"
  return (
    <div data-pwid="phrase" data-rendered={rendered} className="group relative space-y-1">
      <div className="relative overflow-x-auto">
        <div ref={host} data-pwid="phrase-render" />
        <div className="pointer-events-none absolute top-0 right-0 z-10 flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface)]/80 px-2 py-1 font-sans text-xs text-zinc-500 opacity-0 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <button data-pwid="phrase-play" type="button" disabled={problems.length > 0 || player === "loading"} onClick={playOrStop} className={control}>
            {playing ? "Stop" : player === "loading" ? "Loading…" : "Play"}
          </button>
          <label className="flex items-center gap-1">
            <input data-pwid="phrase-loop" type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop
          </label>
          <label className="flex items-center gap-1">
            <input data-pwid="phrase-count-in" type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
            Count in
          </label>
          <select
            data-pwid="phrase-speed"
            aria-label="Speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1 py-0.5"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s === 1 ? "Full speed" : `${s * 100}%`}
                {tempo ? ` (${Math.round(tempo * s)} bpm)` : ""}
              </option>
            ))}
          </select>
        </div>
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

