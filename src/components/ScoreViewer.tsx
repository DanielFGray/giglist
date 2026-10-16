import { useEffect, useRef, useState } from "react"
import { AlphaTabApi, importer, synth, type model } from "@coderline/alphatab"
import { scores } from "~/api/client"
import { trackOptions } from "~/charts/score-tracks"
import { errorMessage } from "./form"

type Status = "loading" | "ready" | "error"

/**
 * A Guitar Pro score drawn with alphaTab, with a track select, play/pause and a
 * metronome click. It fetches the stored file of `revisionId` (the same auth and
 * row-level security as the rest of the API) and never changes it.
 *
 * alphaTab draws only the sections near the viewport and unloads the rest, so
 * beat positions are valid only after `postRenderFinished`; `data-rendered`
 * on the root says when that has happened. A beat is identified by its place in
 * its voice, never by `Beat.id`, which changes on every load (docs/adr/0001).
 */
export function ScoreViewer({ revisionId }: { revisionId: string }) {
  const host = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    const element = host.current
    if (!element) return
    let disposed = false
    const fail = (message: string) => {
      setError(message)
      setStatus("error")
    }
    const view = new AlphaTabApi(element, {
      core: {
        engine: "svg",
        // The render worker and audio worklet load these by URL, and the worker
        // uses importScripts, so the script must be the UMD build at an absolute URL.
        scriptFile: `${location.origin}/alphatab/alphaTab.js`,
        fontDirectory: `${location.origin}/alphatab/font/`,
      },
      player: {
        enablePlayer: true,
        enableCursor: true,
        soundFont: `${location.origin}/alphatab/soundfont/sonivox.sf2`,
      },
    })
    api.current = view
    view.metronomeVolume = metronomeOn.current ? 1 : 0
    view.renderStarted.on(() => setRendered(false))
    view.postRenderFinished.on(() => setRendered(true))
    view.playerReady.on(() => setPlayerReady(true))
    view.playerStateChanged.on((event) => setPlaying(event.state === synth.PlayerState.Playing))
    view.error.on((e) => fail(`The score viewer failed: ${e.message}`))

    scores
      .file(revisionId)
      .then((bytes) => {
        if (disposed) return
        const loaded = readScore(bytes, view)
        if (typeof loaded === "string") return fail(loaded)
        score.current = loaded
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
      view.destroy()
    }
  }, [revisionId])

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

  return (
    <div data-pwid="score-viewer" data-status={status} data-rendered={rendered} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Track
          <select
            data-pwid="score-track"
            value={track}
            disabled={status !== "ready"}
            onChange={(e) => showTrack(Number(e.target.value))}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-zinc-200"
          >
            {tracks.map((t) => (
              <option key={t.index} value={t.index}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          data-pwid="score-play"
          type="button"
          disabled={!playerReady}
          onClick={() => api.current?.playPause()}
          className="px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            data-pwid="score-metronome"
            type="checkbox"
            checked={metronome}
            onChange={(e) => toggleMetronome(e.target.checked)}
          />
          Metronome click
        </label>
      </div>
      {error && (
        <div data-pwid="score-error" role="alert" className="text-sm text-red-400">
          {error}
        </div>
      )}
      {status === "loading" && <p className="text-sm text-zinc-500">Loading the score…</p>}
      {/* Printed-page look: alphaTab draws black glyphs, which need a light background. */}
      <div data-pwid="score-page" className="rounded-md bg-white p-2 text-black">
        <div ref={host} data-pwid="score-render" />
      </div>
    </div>
  )
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
