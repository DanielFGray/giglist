import { useEffect, useRef, useState } from "react"
import { scores } from "~/api/client"
import { selectionLabel } from "alphatab-kit/charts/score-bars"
import { clampZoom } from "alphatab-kit/charts/score-zoom"
import { useScorePlayer } from "alphatab-kit/player/use-score-player"
import { errorMessage } from "./form"
import { ScorePlayerBar } from "./ScorePlayerBar"

type Fetched = { revisionId: string; bytes: Uint8Array } | { revisionId: string; error: string }

/**
 * A Guitar Pro score drawn with alphaTab, under a player bar (play, metronome,
 * count-in, seek, track, speed, speed trainer, notation, zoom, volume). It fetches the stored file of `revisionId`
 * (the same auth and row-level security as the rest of the API) and never changes it.
 *
 * alphaTab draws only the sections near the viewport and unloads the rest, so
 * beat positions are valid only after `postRenderFinished`; `data-rendered`
 * on the root says when that has happened. A beat is identified by its place in
 * its voice, never by `Beat.id`, which changes on every load (docs/adr/0001).
 * `compact` shortens the score to 40% of the window height and scrolls inside
 * it, so the page below a long score stays within reach.
 */
export function ScoreViewer({ revisionId, compact = false }: { revisionId: string; compact?: boolean }) {
  const [fetched, setFetched] = useState<Fetched | null>(null)

  useEffect(() => {
    let disposed = false
    scores
      .file(revisionId)
      .then((bytes) => !disposed && setFetched({ revisionId, bytes }))
      .catch((e) => !disposed && setFetched({ revisionId, error: errorMessage(e) }))
    return () => {
      disposed = true
    }
  }, [revisionId])

  // A file fetched for another revision is no answer yet.
  const file = fetched?.revisionId === revisionId ? fetched : null
  if (file && "bytes" in file) {
    // alphaTab reads its scroll element once, so a change of `compact` builds the player again.
    return <LoadedScore key={String(compact)} bytes={file.bytes} compact={compact} />
  }
  return (
    <div data-pwid="score-viewer" data-status={file ? "error" : "loading"} data-rendered={false} className="space-y-3">
      {file ? <ScoreError text={file.error} /> : <p className="text-sm text-zinc-500">Loading the score…</p>}
    </div>
  )
}

function LoadedScore({ bytes, compact }: { bytes: Uint8Array; compact: boolean }) {
  const page = useRef<HTMLDivElement>(null)
  const { host, state, actions } = useScorePlayer({
    source: { bytes },
    zoom: storedZoom(),
    onZoomChange: storeZoom,
    configure: (settings) => {
      // alphaTab pads the notation by 35 by default; the card's padding is the only margin.
      settings.display.padding = [0, 0]
      // A compact score scrolls inside its own box, so playback follows the cursor in that box and not in the window.
      if (compact && page.current) settings.player.scrollElement = page.current
    },
  })
  const ready = state.status === "ready"
  const track = state.track ?? 0

  return (
    <div data-pwid="score-viewer" data-status={state.status} data-rendered={state.rendered} className="space-y-3">
      <ScorePlayerBar
        ready={ready}
        sound={state.sound}
        playing={state.playing}
        onPlayPause={actions.playPause}
        onStop={actions.stop}
        metronome={state.metronome}
        onMetronome={actions.setMetronome}
        countIn={state.countIn}
        onCountIn={actions.setCountIn}
        positionMs={state.positionMs}
        endMs={state.endMs}
        onSeek={actions.seek}
        tracks={state.tracks}
        track={track}
        trackDisabled={!ready}
        onTrack={actions.setTrack}
        speed={state.speed}
        onSpeed={actions.setSpeed}
        zoom={state.zoom}
        onZoom={actions.setZoom}
        notation={state.notation}
        onNotation={actions.setNotation}
        volume={state.mixer.tracks[track]?.volume ?? 1}
        onVolume={(volume) => actions.setTrackVolume(track, volume)}
        trainer={{
          loop: state.trainer.loop,
          onLoop: actions.setLoop,
          loopCount: state.trainer.loopCount,
          onLoopCount: (count) => actions.setLoopCount(Math.max(1, Math.round(count) || 1)),
          stepMode: state.trainer.stepMode,
          onStepMode: actions.setStepMode,
          stepValue: state.trainer.stepValue,
          onStepValue: (value) => actions.setStepValue(Math.max(0, Math.round(value * 10) / 10 || 0)),
          tempo: state.tempo,
          selection: state.selection ? selectionLabel(state.selection) : null,
          onClearSelection: actions.clearSelection,
        }}
      />
      {state.error && (
        <ScoreError
          text={`The score viewer cannot read this Guitar Pro file (${state.error}). The uploaded file is stored unchanged.`}
        />
      )}
      {state.status === "loading" && <p className="text-sm text-zinc-500">Loading the score…</p>}
      {/* alphaTab draws in the text color around it and redraws when the theme toggles. */}
      <div ref={page} data-pwid="score-page" className={`rounded-md ${compact ? "max-h-[40vh] overflow-y-auto" : ""}`}>
        <div ref={host} data-pwid="score-render" />
      </div>
    </div>
  )
}

function ScoreError({ text }: { text: string }) {
  return (
    <div data-pwid="score-error" role="alert" className="text-sm text-red-400">
      {text}
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

function storeZoom(zoom: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom))
  } catch {
    // Private windows and blocked site data refuse storage; the zoom then lasts for this page only.
  }
}
