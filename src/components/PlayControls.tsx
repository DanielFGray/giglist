import { SPEEDS, type Playback } from "./playback"

/**
 * The hover bar over a playable score or phrase: play or stop, loop, count-in,
 * speed, and, when a passage is selected, its bars with a Clear button. The
 * parent must be `group relative`, and the bar shows while it is hovered or focused.
 *
 * `pwid` prefixes the test ids, so each kind of view keeps its own.
 */
export function PlayControls({
  pwid,
  playback,
  tempo,
  disabled = false,
  selection,
  onClear,
}: {
  pwid: string
  playback: Playback
  tempo: number | null
  disabled?: boolean
  /** A label for the drag-selected passage, such as "Bars 3–4". */
  selection?: string | null
  onClear?: () => void
}) {
  const { status, playing, loop, setLoop, countIn, setCountIn, speed, setSpeed, playOrStop } = playback
  const control = "rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs cursor-pointer disabled:opacity-40"
  return (
    <div className="pointer-events-none absolute top-0 right-0 z-10 flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface)]/80 px-2 py-1 font-sans text-xs text-zinc-500 opacity-0 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
      {selection && (
        <span data-pwid={`${pwid}-selection`} className="text-zinc-300">
          {selection}
        </span>
      )}
      <button data-pwid={`${pwid}-play`} type="button" disabled={disabled || status === "loading"} onClick={playOrStop} className={control}>
        {playing ? "Stop" : status === "loading" ? "Loading…" : "Play"}
      </button>
      <label className="flex items-center gap-1">
        <input data-pwid={`${pwid}-loop`} type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
        Loop
      </label>
      <label className="flex items-center gap-1">
        <input data-pwid={`${pwid}-count-in`} type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} />
        Count in
      </label>
      <select
        data-pwid={`${pwid}-speed`}
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
      {onClear && (
        <button data-pwid={`${pwid}-clear`} type="button" onClick={onClear} className={control}>
          Clear
        </button>
      )}
    </div>
  )
}
