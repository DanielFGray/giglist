import { CLICK_ONSET_SECONDS, clickWaveform } from "./click"
import { Listener } from "./listener"

/**
 * Turns frames into timing. The mic hears the click and the player on one
 * clock, so a note's error is its arrival minus the click's arrival. Output
 * and input latency appear in both and cancel out.
 */

/** Notes per beat that the player aims at: 1 for quarter notes at a 4/4 beat, 2 for eighths, and so on. */
export type Subdivision = 1 | 2 | 3 | 4

export interface Hit {
  /** Signed error in milliseconds: negative is early, positive is late. */
  readonly offsetMs: number
  /** Beats since the first beat after the count-in. */
  readonly beat: number
  /** Which note within the beat the hit aimed at, from 0. */
  readonly step: number
}

export interface Grid {
  /** Context frame at which the mic heard the first beat after the count-in. */
  readonly firstBeat: number
  readonly framesPerBeat: number
  readonly subdivision: Subdivision
  readonly sampleRate: number
}

/** Places a note start on the nearest grid point. */
export const placeHit = (grid: Grid, onset: number): Hit => {
  const stepFrames = grid.framesPerBeat / grid.subdivision
  const steps = Math.round((onset - grid.firstBeat) / stepFrames)
  const point = grid.firstBeat + steps * stepFrames
  return {
    offsetMs: ((onset - point) / grid.sampleRate) * 1000,
    // Adding 0 turns the -0 that Math.round gives just before beat 0 into 0.
    beat: Math.floor(steps / grid.subdivision) + 0,
    step: ((steps % grid.subdivision) + grid.subdivision) % grid.subdivision,
  }
}

/**
 * The listener's delay on the clean click: the frame it reports minus the
 * frame where the click sounds (CLICK_ONSET_SECONDS into the waveform).
 * Subtracting it from each measured arrival gives the time the click sounded
 * at the mic.
 */
export const clickBias = (sampleRate: number): number => {
  const listener = new Listener(sampleRate)
  const start = Math.round(sampleRate * 0.2)
  const signal = new Float32Array(Math.round(sampleRate * 0.6))
  signal.set(clickWaveform(sampleRate), start)
  listener.push(signal, 0)
  const arrival = listener.clickArrival(0, signal.length)
  if (arrival === undefined) throw new Error("the listener does not hear the clean click")
  return arrival - start - CLICK_ONSET_SECONDS * sampleRate
}

export const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export interface Summary {
  readonly count: number
  /** Mean error: negative means the player rushes, positive means the player drags. */
  readonly meanMs: number
  /** Standard deviation of the error: how consistent the player is. */
  readonly spreadMs: number
  /** Share of hits within ±10 ms, from 0 to 1. */
  readonly tight: number
}

export const TIGHT_MS = 10

export const summarize = (hits: ReadonlyArray<Hit>): Summary => {
  const count = hits.length
  if (count === 0) return { count, meanMs: 0, spreadMs: 0, tight: 0 }
  const meanMs = hits.reduce((sum, hit) => sum + hit.offsetMs, 0) / count
  const variance = hits.reduce((sum, hit) => sum + (hit.offsetMs - meanMs) ** 2, 0) / count
  const tight = hits.filter((hit) => Math.abs(hit.offsetMs) <= TIGHT_MS).length / count
  return { count, meanMs, spreadMs: Math.sqrt(variance), tight }
}
