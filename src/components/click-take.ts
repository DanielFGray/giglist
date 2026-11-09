import { COUNT_IN_BEATS } from "~/audio/click/click"
import type { ClickEvent } from "~/audio/click/engine"
import { type Hit, placeHit, type Subdivision, summarize, TIGHT_MS } from "~/audio/click/timing"

/**
 * What a Listen take has heard so far, folded from the click engine's events.
 * Nothing is saved: a take lives while its panel is open.
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
  /** Each note's `atMs` (the Note event); `takeHits` places them on the grid. */
  readonly notesMs: ReadonlyArray<number>
  readonly dropouts: number
  /** Why the take cannot be scored, in words for the player. */
  readonly failure: string | null
}

export const NEW_TAKE: Take = { beat: null, device: null, level: 0, latencyMs: null, notesMs: [], dropouts: 0, failure: null }

export const takeStep = (take: Take, event: ClickEvent): Take => {
  switch (event._tag) {
    case "Beat":
      return { ...take, beat: event.beat }
    case "Listening":
      return { ...take, device: event.device }
    case "Level":
      return { ...take, level: event.peak }
    case "MeasuredLatency":
      return { ...take, latencyMs: event.latencyMs }
    case "Note":
      return { ...take, notesMs: [...take.notesMs, event.atMs] }
    case "Dropout":
      return { ...take, dropouts: take.dropouts + 1 }
    case "MissedClick":
      return { ...take, failure: MISSED_CLICK }
    case "Failed":
      return { ...take, failure: event.reason }
  }
}

/**
 * The take's notes against the click the player heard. A note can be scored
 * only against the measured delay: the browser's own estimate is too rough
 * for millisecond offsets.
 */
export const takeHits = (take: Take, bpm: number, subdivision: Subdivision): ReadonlyArray<Hit> => {
  const { latencyMs } = take
  if (latencyMs === null) return []
  return take.notesMs.map((atMs) => placeHit(atMs - latencyMs, 60_000 / bpm, subdivision))
}

/** One line on what the player should do now. */
export const takeStatus = (take: Take, running: boolean): string => {
  if (take.failure !== null) return take.failure
  const notes = take.notesMs.length
  if (!running) return `Stopped after ${notes} ${notes === 1 ? "note" : "notes"}.`
  if (take.device === null) return "Opening the microphone…"
  if (take.beat === null) return "Starting…"
  if (take.latencyMs === null) return `Count-in ${Math.min(take.beat, COUNT_IN_BEATS - 1) + 1} of ${COUNT_IN_BEATS}: listen while the mic measures the click.`
  const play = `Play. Speaker-to-mic delay ${take.latencyMs.toFixed(0)} ms.`
  return take.dropouts === 0 ? play : `${play} The audio dropped out ${take.dropouts === 1 ? "once" : `${take.dropouts} times`}; notes right after a dropout may be missing.`
}

/** The summary tiles: a label and a value each. */
export const hitTiles = (hits: ReadonlyArray<Hit>): ReadonlyArray<readonly [string, string]> => {
  const summary = summarize(hits)
  const none = summary.count === 0
  return [
    ["Notes", String(summary.count)],
    ["Average", none ? "—" : `${signedMs(summary.meanMs)} ${tendency(summary.meanMs)}`],
    ["Spread", summary.count < 2 ? "—" : `±${summary.spreadMs.toFixed(1)} ms`],
    [`Within ±${TIGHT_MS} ms`, none ? "—" : `${Math.round(summary.tight * 100)}%`],
  ]
}

/** The grid the player aims at, for the subdivision picker. */
export const SUBDIVISIONS: ReadonlyArray<readonly [Subdivision, string]> = [
  [1, "Quarter notes"],
  [2, "Eighth notes"],
  [3, "Triplets"],
  [4, "Sixteenths"],
]

/** A note's offset as the player reads it: "+4.2 ms", "−3.0 ms". */
export const signedMs = (ms: number): string => `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${Math.abs(ms).toFixed(1)} ms`

export const judgement = (ms: number): string => (Math.abs(ms) < 1 ? "on the beat" : ms < 0 ? "early" : "late")

/** The mic meter's fill, 0 to 1, over -60 to 0 dBFS. */
export const meterFill = (peak: number): number => (peak <= 0 ? 0 : Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / -METER_FLOOR_DB)))

const tendency = (meanMs: number): string => (Math.abs(meanMs) < 2 ? "centred" : meanMs < 0 ? "rushing" : "dragging")

const METER_FLOOR_DB = -60

const MISSED_CLICK = "The mic did not hear the click, so it cannot time your notes. Play the click through speakers, not headphones, and turn it up."
