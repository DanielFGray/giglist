import type { ReactNode } from "react"
import { MAX_SPEED, MIN_SPEED, formatClock, type StepMode } from "~/charts/speed-trainer"
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
      className="sticky top-0 z-20 -mx-1 flex flex-col gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1 py-2"
    >
      <div className="flex items-center gap-2">
        <IconButton pwid="score-play" label={props.playing ? "Pause" : "Play"} disabled={!props.ready} onClick={props.onPlayPause}>
          {props.playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton pwid="score-stop" label="Stop" disabled={!props.ready} onClick={props.onStop}>
          <StopIcon />
        </IconButton>
        <IconButton pwid="score-metronome" label="Metronome click" pressed={props.metronome} onClick={() => props.onMetronome(!props.metronome)}>
          <MetronomeIcon />
        </IconButton>
        <IconButton pwid="score-count-in" label="Count in" pressed={props.countIn} onClick={() => props.onCountIn(!props.countIn)}>
          <CountInIcon />
        </IconButton>
        <Progress positionMs={props.positionMs} endMs={props.endMs} disabled={!props.ready} onSeek={props.onSeek} />
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
        <SpeedInput speed={props.speed} onSpeed={props.onSpeed} />
        <Trainer {...props.trainer} speed={props.speed} />
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

function Progress({ positionMs, endMs, disabled, onSeek }: { positionMs: number; endMs: number; disabled: boolean; onSeek: (ms: number) => void }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span data-pwid="score-time" className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">
        {formatClock(positionMs)} / {formatClock(endMs)}
      </span>
      <input
        data-pwid="score-progress"
        type="range"
        aria-label="Seek"
        min={0}
        max={endMs || 1}
        step={10}
        value={Math.min(positionMs, endMs || 1)}
        disabled={disabled || endMs === 0}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
    </div>
  )
}

/**
 * The playback speed as a number the player types, such as 0.75. It holds the
 * typed text until the field loses focus or Enter is pressed, so a half-typed
 * value is not clamped under the player's fingers; Escape puts the speed back.
 */
function SpeedInput({ speed, onSpeed }: { speed: number; onSpeed: (speed: number) => void }) {
  const shown = String(Number.parseFloat(speed.toFixed(3)))
  return (
    <label className="flex items-center gap-2">
      Speed
      <input
        key={shown}
        data-pwid="score-speed"
        type="number"
        min={MIN_SPEED}
        max={MAX_SPEED}
        step={0.05}
        inputMode="decimal"
        defaultValue={shown}
        className={`${field} w-16 text-right`}
        onBlur={(e) => {
          const typed = Number.parseFloat(e.currentTarget.value)
          if (Number.isFinite(typed)) onSpeed(typed)
          else e.currentTarget.value = shown
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") e.currentTarget.value = shown
        }}
      />
      ×
    </label>
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

function IconButton({
  pwid,
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  pwid: string
  label: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      data-pwid={pwid}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded-full p-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        pressed ? "bg-[var(--color-amber-accent)] text-zinc-950" : "border border-[var(--color-border-subtle)] text-zinc-300"
      }`}
    >
      {children}
    </button>
  )
}

const field = "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-zinc-200"

const icon = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "currentColor", "aria-hidden": true } as const

const PlayIcon = () => (
  <svg {...icon}>
    <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.34-5.89a1.5 1.5 0 0 0 0-2.54L6.3 2.84Z" />
  </svg>
)

const PauseIcon = () => (
  <svg {...icon}>
    <path d="M5 3.75C5 3.34 5.34 3 5.75 3h1.5c.41 0 .75.34.75.75v12.5c0 .41-.34.75-.75.75h-1.5a.75.75 0 0 1-.75-.75V3.75Zm7 0c0-.41.34-.75.75-.75h1.5c.41 0 .75.34.75.75v12.5c0 .41-.34.75-.75.75h-1.5a.75.75 0 0 1-.75-.75V3.75Z" />
  </svg>
)

const StopIcon = () => (
  <svg {...icon}>
    <rect x="4" y="4" width="12" height="12" rx="2" />
  </svg>
)

/** A metronome: a tapering case with a tilted arm. */
const MetronomeIcon = () => (
  <svg {...icon}>
    <path d="M7.4 2h5.2l3 14.2c.2.9-.5 1.8-1.5 1.8H5.9c-1 0-1.7-.9-1.5-1.8L7.4 2Zm1.2 1.8L6.2 15.8h7.6L11.4 3.8H8.6Z" />
    <path d="M10.8 6.2 12.4 7 9.9 13.1 8.4 12.4l2.4-6.2Z" />
  </svg>
)

/** Four beats before the score starts, drawn as four dots. */
const CountInIcon = () => (
  <svg {...icon}>
    <circle cx="4" cy="10" r="1.8" />
    <circle cx="8.7" cy="10" r="1.8" />
    <circle cx="13.3" cy="10" r="1.8" />
    <circle cx="18" cy="10" r="1.8" />
  </svg>
)
