import { useEffect, useMemo, useRef } from "react"
import { importer, model, Settings, StaveProfile } from "@coderline/alphatab"
import { barsOfBeatSpan, selectionLabel, type BarSpan } from "alphatab-kit/charts/score-bars"
import { createMixer, setSolo } from "alphatab-kit/charts/score-mixer"
import { SpeedInput } from "alphatab-kit/player/speed-input"
import { useScorePlayer, type UseScorePlayer } from "alphatab-kit/player/use-score-player"

/**
 * Reads a Guitar Pro file for drawing as a tab. The staff profile is set before
 * the read, because the file's own profile can hide the tab.
 */
export function readScore(bytes: Uint8Array): model.Score {
  const settings = new Settings()
  settings.display.staveProfile = StaveProfile.ScoreTab
  return importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

type ScoreViewProps = {
  /** A parsed score (`readScore`). The view draws it; the app may draw the same score elsewhere too. */
  score: model.Score
  /** The track drawn and played. A view draws one track for its whole life: another track is another view. */
  track: number
  /** The bars drawn, zero-based and inclusive; null draws the whole score. */
  range: BarSpan | null
  /**
   * The passage the owner holds, in whole bars. When it is given, the view selects it, and `onSelect`
   * receives each change a drag or a key makes, as the bars the selection touches. Without it the view
   * keeps its own selection.
   */
  selected?: BarSpan | null
  onSelect?: (span: BarSpan | null) => void
  onError?: (message: string) => void
  /** Prefixes the test ids of the view's parts. */
  pwid: string
}

/**
 * A score's bars drawn by alphaTab in page layout. A drag across the bars
 * selects a passage, and a selection is the playback range: it plays, loops and
 * clears from the hover bar. The owner may hold the selection in `selected`, so a
 * typed bar range and a drag set the same passage.
 *
 * `range` limits the drawn bars. Playback covers the selection when there is
 * one, else the drawn bars, else the whole score (`range` null), and only the
 * drawn track sounds. The kit's `useScorePlayer` runs the player: the sound
 * font loads on the first Play, and the notation takes the color of the text
 * around the view.
 */
export function ScoreView(props: ScoreViewProps) {
  // The player solos the drawn track when it is built, so a new track is a new player.
  return <DrawnScore key={props.track} {...props} />
}

function DrawnScore({ score, track, range, selected, pwid, onSelect, onError }: ScoreViewProps) {
  const mixer = useMemo(() => soloed(score, track), [score, track])
  const { host, state, actions } = useScorePlayer({
    source: { score },
    bars: range,
    defaultTrack: track,
    mixer,
    zoom: SCORE_ZOOM,
    // Loop plays the passage again at the same speed: no speed trainer step.
    stepValue: 0,
    configure: configureScore,
    onSelectionChange: (span) => onSelect?.(span && barsOfBeatSpan(span)),
  })

  // The owner's passage becomes the selection once the score is drawn, and again when the owner changes it.
  const owned = selected !== undefined
  const first = selected?.first ?? null
  const last = selected?.last ?? null
  useEffect(() => {
    if (owned && state.rendered) actions.selectBars(first === null || last === null ? null : { first, last })
  }, [owned, first, last, state.rendered, actions])

  const reportError = useRef(onError)
  useEffect(() => {
    reportError.current = onError
  })
  useEffect(() => {
    if (state.error) reportError.current?.(state.error)
  }, [state.error])

  const bars = state.selection && barsOfBeatSpan(state.selection)
  return (
    <div className="group relative">
      <div ref={host} data-pwid={`${pwid}-render`} data-selection={bars ? `${bars.first}-${bars.last}` : undefined} />
      <ScoreControls
        pwid={pwid}
        state={state}
        actions={actions}
        onClear={() => {
          actions.clearSelection()
          onSelect?.(null)
        }}
      />
    </div>
  )
}

/**
 * The hover bar over a score: the passage's bars with a Clear button when one is selected, play or stop, loop,
 * count-in, speed and the tempo at that speed. The parent must be `group relative`; the bar shows while it is
 * hovered or focused.
 */
function ScoreControls({
  pwid,
  state,
  actions,
  onClear,
}: Pick<UseScorePlayer, "state" | "actions"> & { pwid: string; onClear: () => void }) {
  const control = "rounded-md border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs cursor-pointer disabled:opacity-40"
  const field = "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1 py-0.5 text-xs text-zinc-200"
  return (
    <div className="pointer-events-none absolute top-0 right-0 z-10 flex flex-wrap items-center gap-3 rounded-md bg-[var(--color-surface)]/80 px-2 py-1 font-sans text-xs text-zinc-500 opacity-0 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
      {state.selection && (
        <span data-pwid={`${pwid}-selection`} className="text-zinc-300">
          {selectionLabel(state.selection)}
        </span>
      )}
      <button
        data-pwid={`${pwid}-play`}
        type="button"
        disabled={state.status !== "ready" || state.sound === "loading"}
        onClick={state.playing ? actions.stop : actions.play}
        className={control}
      >
        {state.playing ? "Stop" : state.sound === "loading" ? "Loading…" : "Play"}
      </button>
      <label className="flex items-center gap-1">
        <input data-pwid={`${pwid}-loop`} type="checkbox" checked={state.trainer.loop} onChange={(e) => actions.setLoop(e.target.checked)} />
        Loop
      </label>
      <label className="flex items-center gap-1">
        <input data-pwid={`${pwid}-count-in`} type="checkbox" checked={state.countIn} onChange={(e) => actions.setCountIn(e.target.checked)} />
        Count in
      </label>
      <SpeedInput
        speed={state.speed}
        onSpeed={actions.setSpeed}
        parts={{ root: { className: "flex items-center gap-1" }, input: { className: `${field} w-14 text-right`, "data-pwid": `${pwid}-speed` } }}
      />
      {state.tempo !== null && (
        <span data-pwid={`${pwid}-tempo`} className="tabular-nums">
          {state.tempo} bpm
        </span>
      )}
      {state.selection && (
        <button data-pwid={`${pwid}-clear`} type="button" onClick={onClear} className={control}>
          Clear
        </button>
      )}
    </div>
  )
}

/** A score in a chart draws smaller than the score page: the kit's zoom on top of the width's own base scale. */
const SCORE_ZOOM = 0.8

/** Page-thread drawing, because a chart can hold several scores; the card's padding is the only margin. */
function configureScore(settings: Settings) {
  settings.core.useWorkers = false
  settings.display.padding = [0, 0]
}

/** Only the drawn track sounds: the other tracks are soloed out. */
function soloed(score: model.Score, track: number) {
  const mixer = createMixer(score.tracks.map((t) => t.playbackInfo.volume / 16))
  return score.tracks[track] ? setSolo(mixer, track, true) : mixer
}
