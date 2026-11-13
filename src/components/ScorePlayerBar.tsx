import type { Notation } from "alphatab-kit/charts/score-notation"
import type { StepMode } from "alphatab-kit/charts/speed-trainer"
import { IconButton } from "alphatab-kit/player/icon-button"
import { CountInIcon, MetronomeIcon, PauseIcon, PlayIcon, StopIcon } from "alphatab-kit/player/icons"
import { NotationToggles } from "alphatab-kit/player/notation-toggles"
import { SeekBar } from "alphatab-kit/player/seek-bar"
import { SpeedInput } from "alphatab-kit/player/speed-input"
import { ZoomControl } from "alphatab-kit/player/zoom-control"
import { SettingsPanel } from "./SettingsPanel"

/**
 * The control bar above a score: play and stop, metronome and count-in, a seek
 * bar with the time, then the track, the speed, the speed trainer and the track
 * volume. It holds no player state; `ScoreViewer` owns that and passes each
 * value and its setter. The bar sticks to the top of the page while the score
 * scrolls, so the controls stay in reach.
 */
export type ScorePlayerBarProps = {
  /** False until alphaTab has loaded its sound font; the controls that need the player wait. */
  ready: boolean
  playing: boolean
  onPlayPause: () => void
  onStop: () => void
  metronome: boolean
  onMetronome: (on: boolean) => void
  countIn: boolean
  onCountIn: (on: boolean) => void
  positionMs: number
  endMs: number
  onSeek: (ms: number) => void
  tracks: ReadonlyArray<{ index: number; label: string }>
  track: number
  trackDisabled: boolean
  onTrack: (index: number) => void
  speed: number
  onSpeed: (speed: number) => void
  notation: Notation
  onNotation: (which: keyof Notation) => void
  /** How large the notation is drawn, where 1 is 100%. */
  zoom: number
  onZoom: (zoom: number) => void
  volume: number
  onVolume: (volume: number) => void
  trainer: TrainerProps
}

export type TrainerProps = {
  loop: boolean
  onLoop: (on: boolean) => void
  loopCount: number
  onLoopCount: (count: number) => void
  stepMode: StepMode
  onStepMode: (mode: StepMode) => void
  stepValue: number
  onStepValue: (value: number) => void
  /** The song's tempo at the current speed, or null when the score names none. */
  tempo: number | null
  /** The bars a drag selected, as text such as "Bars 3–5", or null for the whole piece. */
  selection: string | null
  onClearSelection: () => void
}

export function ScorePlayerBar(props: ScorePlayerBarProps) {
  return (
    <div
      data-pwid="score-bar"
      className="sticky top-[var(--stick-top,0px)] z-20 transition-[top] duration-300 -mx-1 flex flex-col gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1 py-2"
    >
      <div className="flex items-center gap-2">
        <IconButton
          label={props.playing ? "Pause" : "Play"}
          disabled={!props.ready}
          onClick={props.onPlayPause}
          parts={{ button: { className: iconButton, "data-pwid": "score-play" } }}
        >
          {props.playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton label="Stop" disabled={!props.ready} onClick={props.onStop} parts={{ button: { className: iconButton, "data-pwid": "score-stop" } }}>
          <StopIcon />
        </IconButton>
        <IconButton
          label="Metronome click"
          pressed={props.metronome}
          onClick={() => props.onMetronome(!props.metronome)}
          parts={{ button: { className: iconButton, "data-pwid": "score-metronome" } }}
        >
          <MetronomeIcon />
        </IconButton>
        <IconButton
          label="Count in"
          pressed={props.countIn}
          onClick={() => props.onCountIn(!props.countIn)}
          parts={{ button: { className: iconButton, "data-pwid": "score-count-in" } }}
        >
          <CountInIcon />
        </IconButton>
        <SeekBar
          positionMs={props.positionMs}
          endMs={props.endMs}
          disabled={!props.ready}
          onSeek={props.onSeek}
          parts={{
            root: { className: "flex min-w-0 flex-1 items-center gap-2" },
            time: { className: "shrink-0 font-mono text-xs tabular-nums text-zinc-400", "data-pwid": "score-time" },
            range: { className: "min-w-0 flex-1", "data-pwid": "score-progress" },
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
        {props.tracks.length > 1 && (
          <label className="flex items-center gap-2">
            Track
            <select
              data-pwid="score-track"
              value={props.track}
              disabled={props.trackDisabled}
              onChange={(e) => props.onTrack(Number(e.target.value))}
              className={`${field} max-w-48`}
            >
              {props.tracks.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <SpeedInput
          speed={props.speed}
          onSpeed={props.onSpeed}
          parts={{
            root: { className: "flex items-center gap-2" },
            input: { className: `${field} w-16 text-right`, "data-pwid": "score-speed" },
          }}
        />
        <Trainer {...props.trainer} speed={props.speed} />
        <NotationToggles
          notation={props.notation}
          onNotation={props.onNotation}
          parts={{
            root: { className: "flex items-center gap-1" },
            standard: { className: toggle, "data-pwid": "score-notation-standard" },
            tab: { className: toggle, "data-pwid": "score-notation-tab" },
          }}
        />
        <ZoomControl
          zoom={props.zoom}
          onZoom={props.onZoom}
          parts={{
            root: { className: "flex items-center gap-1" },
            zoomOut: { className: zoomStep, "data-pwid": "score-zoom-out" },
            reset: { className: "w-12 rounded-md px-1 py-1 text-center tabular-nums text-zinc-200 cursor-pointer", "data-pwid": "score-zoom" },
            zoomIn: { className: zoomStep, "data-pwid": "score-zoom-in" },
          }}
        />
        <label className="flex items-center gap-2">
          Volume
          <input
            data-pwid="score-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={props.volume}
            disabled={!props.ready}
            onChange={(e) => props.onVolume(Number(e.target.value))}
            className="w-24"
          />
        </label>
        {props.trainer.selection && (
          <span data-pwid="score-selection" className="flex items-center gap-2 text-zinc-300">
            {props.trainer.selection}
            <button data-pwid="score-clear" type="button" onClick={props.trainer.onClearSelection} className="underline cursor-pointer">
              Clear
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

/** Loop a passage and speed it up after a number of rounds. The panel holds the settings; the bar shows only its button. */
function Trainer(props: TrainerProps & { speed: number }) {
  const tempo = props.tempo === null ? null : Number.parseFloat((props.tempo * props.speed).toFixed(1))
  return (
    <SettingsPanel pwid="score-trainer" title="Speed trainer">
      <p className="text-sm text-zinc-400">
        Drag across the score to pick a passage, or leave it alone to train the whole piece. Each time the passage has looped the chosen number of times, the speed goes up by one step.
      </p>
      <p data-pwid="score-trainer-tempo" className="text-sm text-zinc-300">
        {props.selection ?? "Whole piece"} · {tempo === null ? `${props.speed}×` : `${tempo} BPM (${props.speed}×)`}
      </p>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input data-pwid="score-loop" type="checkbox" checked={props.loop} onChange={(e) => props.onLoop(e.target.checked)} />
        Loop
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        After
        <input
          data-pwid="score-trainer-loops"
          type="number"
          min={1}
          step={1}
          value={props.loopCount}
          onChange={(e) => props.onLoopCount(Number(e.target.value))}
          className={`${field} w-16`}
        />
        {props.loopCount === 1 ? "loop" : "loops"}, speed up by
      </label>
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          data-pwid="score-trainer-step"
          type="number"
          aria-label="Step"
          min={0}
          step={props.stepMode === "bpm" ? 1 : 0.5}
          value={props.stepValue}
          onChange={(e) => props.onStepValue(Number(e.target.value))}
          className={`${field} w-20`}
        />
        <select
          data-pwid="score-trainer-mode"
          aria-label="Step unit"
          value={props.stepMode}
          onChange={(e) => props.onStepMode(e.target.value === "bpm" ? "bpm" : "percent")}
          className={field}
        >
          <option value="percent">%</option>
          <option value="bpm">BPM</option>
        </select>
      </div>
    </SettingsPanel>
  )
}

const field = "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-zinc-200"

/** The two staff toggles share one class string; `aria-pressed` styles the on state. */
const toggle = "rounded-md border border-[var(--color-border-subtle)] px-2 py-1 cursor-pointer aria-pressed:bg-[var(--color-amber-accent)] aria-pressed:text-zinc-950"

/** The zoom-out and zoom-in buttons share one class string. */
const zoomStep = "rounded-md border border-[var(--color-border-subtle)] px-2 py-1 leading-none text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

/** The kit reports pressed as `data-pressed` on every button, so one class string styles both states. */
const iconButton =
  "shrink-0 rounded-full p-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed data-[pressed=true]:bg-[var(--color-amber-accent)] data-[pressed=true]:text-zinc-950 data-[pressed=false]:border data-[pressed=false]:border-[var(--color-border-subtle)] data-[pressed=false]:text-zinc-300"
