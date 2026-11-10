import type { ClickEvent } from "./engine"
import { type Hit, placeHit, type Subdivision } from "./timing"

/**
 * What one run of the click with the mic has heard so far, folded from the
 * engine's events. Listen mode scores it; the phrase recorder reads its notes.
 */
export interface Take {
  /** The click sounding now, the count-in's first being 0; null before the first. */
  readonly beat: number | null
  /** The mic's name, once it is open. */
  readonly device: string | null
  /** The loudest recent sample, 0 to 1. */
  readonly level: number
  /** The speaker-to-mic delay the count-in measured. */
  readonly latencyMs: number | null
  /** The browser's own estimate of that delay (the Listening event), once the mic is open. */
  readonly reportedLatencyMs: number | null
  /** The count-in ended without hearing enough clicks to measure the delay, as with headphones. */
  readonly missedClick: boolean
  /** Each note's `atMs` (the Note event). */
  readonly notesMs: ReadonlyArray<number>
  readonly dropouts: number
  /** Why the engine stopped, in words for the player. */
  readonly failure: string | null
}

export const NEW_TAKE: Take = {
  beat: null,
  device: null,
  level: 0,
  latencyMs: null,
  reportedLatencyMs: null,
  missedClick: false,
  notesMs: [],
  dropouts: 0,
  failure: null,
}

export const takeStep = (take: Take, event: ClickEvent): Take => {
  switch (event._tag) {
    case "Beat":
      return { ...take, beat: event.beat }
    case "Listening":
      return { ...take, device: event.device, reportedLatencyMs: event.reportedLatencyMs }
    case "Level":
      return { ...take, level: event.peak }
    case "MeasuredLatency":
      return { ...take, latencyMs: event.latencyMs }
    case "MissedClick":
      return { ...take, missedClick: true }
    case "Note":
      return { ...take, notesMs: [...take.notesMs, event.atMs] }
    case "Dropout":
      return { ...take, dropouts: take.dropouts + 1 }
    case "Failed":
      return { ...take, failure: event.reason }
  }
}

/**
 * The take's notes against the click the player heard. Only the measured
 * delay places a note to the millisecond; the browser's estimate is too rough
 * to score with, so a take without a measured delay has no hits.
 */
export const takeHits = (take: Take, bpm: number, subdivision: Subdivision): ReadonlyArray<Hit> => {
  const { latencyMs } = take
  if (latencyMs === null) return []
  return take.notesMs.map((atMs) => placeHit(atMs - latencyMs, 60_000 / bpm, subdivision))
}
