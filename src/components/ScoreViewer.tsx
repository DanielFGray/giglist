import { useEffect, useRef, useState } from "react"
import { AlphaTabApi, importer, synth, type model } from "@coderline/alphatab"
import { scores } from "~/api/client"
import { trackOptions } from "~/charts/score-tracks"
import { clampSpeed, nextSpeed, type StepMode } from "~/charts/speed-trainer"
import { BOTH_NOTATIONS, staffNotation, toggleNotation, type Notation } from "~/charts/score-notation"
import { clampZoom } from "~/charts/score-zoom"
import { alphaTabAssetUrls } from "alphatab-kit"
import { inkFrom } from "./alphatab"
import { useThemeInk } from "./useThemeInk"
import { errorMessage } from "./form"
import { barsLabel, barTicksOf, selectedBars, type BarSpan } from "./score-bars"
import { ScorePlayerBar } from "./ScorePlayerBar"

type Status = "loading" | "ready" | "error"

/**
 * A Guitar Pro score drawn with alphaTab, under a player bar (play, metronome,
 * count-in, seek, track, speed, speed trainer, volume). It fetches the stored file of `revisionId` (the same auth and
 * row-level security as the rest of the API) and never changes it.
 *
 * alphaTab draws only the sections near the viewport and unloads the rest, so
 * beat positions are valid only after `postRenderFinished`; `data-rendered`
 * on the root says when that has happened. A beat is identified by its place in
 * its voice, never by `Beat.id`, which changes on every load (docs/adr/0001).
 * `compact` shortens the score to 40% of the window height and scrolls inside
 * it, so the page below a long score stays within reach.
 */
export function ScoreViewer({ revisionId, compact = false }: { revisionId: string; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const api = useRef<AlphaTabApi | null>(null)
  const score = useRef<model.Score | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [error, setError] = useState<string | null>(null)
  const [tracks, setTracks] = useState<ReadonlyArray<{ index: number; label: string }>>([])
  const [track, setTrack] = useState(0)
  const [rendered, setRendered] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const metronomeOn = useRef(metronome)
  metronomeOn.current = metronome
  const [countIn, setCountIn] = useState(false)
  const [position, setPosition] = useState({ current: 0, end: 0 })
  const [speed, setSpeed] = useState(1)
  const [volumes, setVolumes] = useState<Readonly<Record<number, number>>>({})
  const [loop, setLoop] = useState(false)
  const [loopCount, setLoopCount] = useState(2)
  const [stepMode, setStepMode] = useState<StepMode>("percent")
  const [stepValue, setStepValue] = useState(5)
  const [zoom, setZoom] = useState(1)
  const [notation, setNotation] = useState<Notation>(BOTH_NOTATIONS)
  // The score loads after the effect starts, so it reads the choice from here.
  const notationNow = useRef(notation)
  notationNow.current = notation
  const [selection, setSelection] = useState<BarSpan | null>(null)
  // alphaTab's finish event outlives a render, so the trainer reads its settings from here.
  const trainer = useRef({ loop, loopCount, stepMode, stepValue, speed, tempo: null as number | null, finished: 0 })
  trainer.current = { ...trainer.current, loop, loopCount, stepMode, stepValue, speed }

  useEffect(() => {
    const element = host.current
    if (!element) return
    let disposed = false
    const fail = (message: string) => {
      setError(message)
      setStatus("error")
    }
    const { scriptFile, fontDirectory, soundFont } = alphaTabAssetUrls()
    const view = new AlphaTabApi(element, {
      // alphaTab pads the notation by 35 by default; the card's padding is the only margin.
      display: { padding: [0, 0], scale: storedZoom() },
      core: { engine: "svg", scriptFile, fontDirectory },
      player: { enablePlayer: true, enableCursor: true, soundFont },
    })
    api.current = view
    setZoom(view.settings.display.scale)
    inkFrom(view.settings, getComputedStyle(element).color)
    view.updateSettings()
    view.metronomeVolume = metronomeOn.current ? 1 : 0
    view.renderStarted.on(() => setRendered(false))
    view.postRenderFinished.on(() => setRendered(true))
    view.playerReady.on(() => setPlayerReady(true))
    view.playerPositionChanged.on((e) => setPosition({ current: e.currentTime, end: e.endTime }))
    // A looped passage ends once per round; the trainer speeds the next round up after enough of them.
    view.playerFinished.on(() => {
      const t = trainer.current
      if (!t.loop) return
      t.finished += 1
      if (t.finished < Math.max(1, t.loopCount)) return
      t.finished = 0
      changeSpeed(nextSpeed(t.speed, t.stepMode, t.stepValue, t.tempo), false)
    })
    view.playerStateChanged.on((event) => setPlaying(event.state === synth.PlayerState.Playing))
    view.error.on((e) => fail(`The score viewer failed: ${e.message}`))
    // A drag across the bars sets the playback range; the bars it covers are what Loop repeats.
    view.playbackRangeChanged.on((e) => {
      const loaded = score.current
      setSelection(loaded ? selectedBars(barTicksOf(loaded.masterBars), e.playbackRange, null) : null)
    })

    scores
      .file(revisionId)
      .then((bytes) => {
        if (disposed) return
        const loaded = readScore(bytes, view)
        if (typeof loaded === "string") return fail(loaded)
        score.current = loaded
        showNotation(loaded, notationNow.current)
        trainer.current.tempo = loaded.tempo
        setTracks(trackOptions(loaded.tracks))
        setTrack(0)
        setStatus("ready")
        view.renderScore(loaded, [0])
      })
      .catch((e) => !disposed && fail(errorMessage(e)))

    return () => {
      disposed = true
      api.current = null
      score.current = null
      setRendered(false)
      setPlayerReady(false)
      setPlaying(false)
      setPosition({ current: 0, end: 0 })
      view.destroy()
    }
  }, [revisionId])

  useThemeInk(api, host)

  // A compact score scrolls inside its own box, so playback must follow the cursor in that box and not in the window.
  useEffect(() => {
    const view = api.current
    if (!view) return
    view.settings.player.scrollElement = compact && page.current ? page.current : "html,body"
    view.updateSettings()
  }, [compact, revisionId])

  const showTrack = (index: number) => {
    const picked = score.current?.tracks[index]
    if (!picked) return
    setTrack(index)
    api.current?.renderTracks([picked])
  }

  const toggleMetronome = (on: boolean) => {
    setMetronome(on)
    if (api.current) api.current.metronomeVolume = on ? 1 : 0
  }

  const toggleCountIn = (on: boolean) => {
    setCountIn(on)
    if (api.current) api.current.countInVolume = on ? 1 : 0
  }

  const toggleLoop = (on: boolean) => {
    trainer.current.finished = 0
    setLoop(on)
    if (api.current) api.current.isLooping = on
  }

  /** A speed the player chose restarts the trainer's count; one the trainer chose does not. */
  function changeSpeed(next: number, byPlayer = true) {
    const clamped = clampSpeed(next)
    if (byPlayer) trainer.current.finished = 0
    trainer.current.speed = clamped
    setSpeed(clamped)
    if (api.current) api.current.playbackSpeed = clamped
  }

  /** alphaTab redraws the score at the new scale; the choice is kept for the next score. */
  const changeZoom = (next: number) => {
    const clamped = clampZoom(next)
    setZoom(clamped)
    try {
      localStorage.setItem(ZOOM_KEY, String(clamped))
    } catch {
      // Private windows and blocked site data refuse storage; the zoom then lasts for this page only.
    }
    const view = api.current
    if (!view) return
    view.settings.display.scale = clamped
    view.updateSettings()
    view.render()
  }

  const changeNotation = (which: keyof Notation) => {
    const next = toggleNotation(notation, which)
    setNotation(next)
    const loaded = score.current
    if (!loaded) return
    showNotation(loaded, next)
    api.current?.render()
  }

  const stop = () => {
    trainer.current.finished = 0
    api.current?.stop()
  }

  const changeVolume = (volume: number) => {
    const picked = score.current?.tracks[track]
    if (!picked) return
    setVolumes((current) => ({ ...current, [track]: volume }))
    api.current?.changeTrackVolume([picked], volume)
  }

  // Clearing returns the playback range to the whole score. The range setter needs the player, so it waits for it.
  const clearSelection = () => {
    const view = api.current
    if (!view || !playerReady) return
    view.clearPlaybackRangeHighlight()
    view.playbackRange = null
  }

  return (
    <div data-pwid="score-viewer" data-status={status} data-rendered={rendered} className="space-y-3">
      <ScorePlayerBar
        ready={playerReady}
        playing={playing}
        onPlayPause={() => api.current?.playPause()}
        onStop={stop}
        metronome={metronome}
        onMetronome={toggleMetronome}
        countIn={countIn}
        onCountIn={toggleCountIn}
        positionMs={position.current}
        endMs={position.end}
        onSeek={(ms) => {
          if (api.current) api.current.timePosition = ms
        }}
        tracks={tracks}
        track={track}
        trackDisabled={status !== "ready"}
        onTrack={showTrack}
        speed={speed}
        onSpeed={changeSpeed}
        zoom={zoom}
        onZoom={changeZoom}
        notation={notation}
        onNotation={changeNotation}
        volume={volumes[track] ?? 1}
        onVolume={changeVolume}
        trainer={{
          loop,
          onLoop: toggleLoop,
          loopCount,
          onLoopCount: (count) => {
            trainer.current.finished = 0
            setLoopCount(Math.max(1, Math.round(count) || 1))
          },
          stepMode,
          onStepMode: setStepMode,
          stepValue,
          onStepValue: (value) => setStepValue(Math.max(0, Math.round(value * 10) / 10 || 0)),
          tempo: score.current?.tempo ?? null,
          selection: selection ? barsLabel(selection) : null,
          onClearSelection: clearSelection,
        }}
      />
      {error && (
        <div data-pwid="score-error" role="alert" className="text-sm text-red-400">
          {error}
        </div>
      )}
      {status === "loading" && <p className="text-sm text-zinc-500">Loading the score…</p>}
      {/* alphaTab draws in the text color around it and redraws when the theme toggles. */}
      <div ref={page} data-pwid="score-page" className={`rounded-md ${compact ? "max-h-[40vh] overflow-y-auto" : ""}`}>
        <div ref={host} data-pwid="score-render" />
      </div>
    </div>
  )
}

const ZOOM_KEY = "setlist:score-zoom"

/** The zoom the player last chose, or 100%. */
function storedZoom(): number {
  try {
    return clampZoom(Number.parseFloat(localStorage.getItem(ZOOM_KEY) ?? "1"))
  } catch {
    return 1
  }
}

/** Sets which staves every track draws; the next render uses it. */
function showNotation(loaded: model.Score, choice: Notation) {
  for (const track of loaded.tracks) {
    for (const staff of track.staves) {
      const shown = staffNotation(staff.isStringed && !staff.isPercussion, choice)
      staff.showStandardNotation = shown.standard
      staff.showTablature = shown.tab
    }
  }
}

/** The score in `bytes`, or a message for the player when alphaTab cannot read the file. */
function readScore(bytes: Uint8Array, view: AlphaTabApi): model.Score | string {
  try {
    return importer.ScoreLoader.loadScoreFromBytes(bytes, view.settings)
  } catch (e) {
    // alphaTab cannot read a few valid Guitar Pro files. The stored file is unchanged.
    const reason = e instanceof Error ? e.message : String(e)
    return `The score viewer cannot read this Guitar Pro file (${reason}). The uploaded file is stored unchanged.`
  }
}
