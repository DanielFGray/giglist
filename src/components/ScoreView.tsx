import { useEffect, useRef } from "react"
import { AlphaTabApi, importer, LayoutMode, model, PlayerMode, Settings, StaveProfile } from "@coderline/alphatab"
import { alphaTabAssets, inkFrom } from "./alphatab"
import { useThemeInk } from "./useThemeInk"
import { PlayControls } from "./PlayControls"
import { usePlayback } from "./playback"
import { barsLabel, barTicksOf, sameBars, selectedBars, ticksOfBars, type BarSpan } from "./score-bars"
import { stretchForWidth } from "./stretch"

/**
 * Reads a Guitar Pro file for drawing as a tab. The staff profile is set before
 * the read, because the file's own profile can hide the tab.
 */
export function readScore(bytes: Uint8Array): model.Score {
  const settings = new Settings()
  settings.display.staveProfile = StaveProfile.ScoreTab
  return importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

/** What the view draws and plays. `selected` is the passage the user chose; `range` is the drawn bars. */
type Shown = {
  score: model.Score
  track: number
  range: BarSpan | null
  selected: BarSpan | null
  onSelect: (span: BarSpan | null) => void
  onError?: (message: string) => void
}

/**
 * A score's bars drawn by alphaTab in page layout. A drag across the bars
 * selects a passage, and a selection is the playback range: it plays, loops and
 * clears from the hover bar. The owner holds the selection in `selected`, so a
 * typed bar range and a drag set the same passage.
 *
 * `range` limits the drawn bars. Playback covers the selection when there is
 * one, else the drawn bars, else the whole score (`range` null).
 *
 * alphaTab 1.8.4 needs an enabled player for built-in drag selection.
 * External-media mode supplies the cursors without loading audio. Play starts
 * the synthesizer and applies the selected passage once it is ready.
 */
export function ScoreView({
  score,
  track,
  range,
  selected,
  pwid,
  onSelect,
  onError,
}: Shown & {
  /** Prefixes the test ids of the view's parts. */
  pwid: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<AlphaTabApi | null>(null)
  // The latest props, for alphaTab's handlers, which are bound once.
  const shown = useRef<Shown>({ score, track, range, selected, onSelect, onError })
  useEffect(() => {
    shown.current = { score, track, range, selected, onSelect, onError }
  })
  const playback = usePlayback()
  // The bounds as numbers, so that an equal range given as a new object does not redraw the view.
  const first = range?.first ?? null
  const last = range?.last ?? null
  const picked = selected?.first ?? null
  const pickedLast = selected?.last ?? null

  useEffect(() => {
    const element = host.current
    if (!element) return
    const { scriptFile, fontDirectory, soundFont } = alphaTabAssets()
    const view = new AlphaTabApi(element, {
      core: { engine: "svg", useWorkers: false, scriptFile, fontDirectory },
      display: { padding: [0, 0], layoutMode: LayoutMode.Page, scale: 0.8, staveProfile: StaveProfile.ScoreTab, stretchForce: stretchForWidth(element.clientWidth) },
      player: { playerMode: PlayerMode.EnabledExternalMedia, enableCursor: true, soundFont },
    })
    viewRef.current = view
    inkFrom(view.settings, getComputedStyle(element).color)
    view.updateSettings()
    view.resize.on((e) => {
      if (e.settings) e.settings.display.stretchForce = stretchForWidth(e.newWidth)
    })
    view.error.on((e) => shown.current.onError?.(e.message))
    // Fires for a drag, and for the range the view sets itself. A range that is already the selection is not reported again.
    view.playbackRangeChanged.on((e) => {
      const { score, range, selected, onSelect } = shown.current
      const span = selectedBars(barTicksOf(score.masterBars), e.playbackRange, range)
      if (!sameBars(span, selected)) onSelect(span)
    })
    playback.attach(view, () => applyPlayback(view, shown.current))
    return () => {
      viewRef.current = null
      playback.detach()
      view.destroy()
    }
  }, [])

  useThemeInk(viewRef, host)

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const drawn = first === null || last === null ? null : { first, last }
    view.settings.display.startBar = drawn ? drawn.first + 1 : 1
    view.settings.display.barCount = drawn ? drawn.last - drawn.first + 1 : -1
    view.updateSettings()
    view.renderScore(score, [track])
  }, [score, track, first, last])

  useEffect(() => {
    const view = viewRef.current
    if (view) applyPlayback(view, shown.current)
  }, [score, track, first, last, picked, pickedLast, playback.status])

  // The tempo shown is the one the passage starts at.
  const passage = selected ?? range
  const label = selected ? barsLabel(selected) : null

  return (
    <div className="group relative">
      <div ref={host} data-pwid={`${pwid}-render`} data-selection={selected ? `${selected.first}-${selected.last}` : undefined} />
      <PlayControls
        pwid={pwid}
        playback={playback}
        tempo={score.masterBars[passage?.first ?? 0]?.tempoAutomations[0]?.value ?? score.tempo}
        selection={label}
        onClear={selected ? () => onSelect(null) : undefined}
      />
    </div>
  )
}

/**
 * Plays the drawn bars of one track: the other tracks are soloed out, and the
 * playback range is the selection, else the drawn bars, else the whole score.
 */
function applyPlayback(view: AlphaTabApi, { score, track, range, selected }: Shown) {
  view.changeTrackSolo([score.tracks[track]!], true)
  const span = selected ?? range
  view.playbackRange = span ? ticksOfBars(barTicksOf(score.masterBars), span) : null
}
