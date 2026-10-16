/**
 * A click track for a tempo: the times of its beats, with the first beat of
 * each bar accented. The tempo is the only input, so bars are four beats long.
 *
 * `beatsBetween` is pure so the audio code can ask for the beats that fall in
 * the next stretch of time and schedule exactly those.
 */
export const BEATS_PER_BAR = 4

/** The clicks that count the band in before the track settles: one bar. */
export const COUNT_IN_BEATS = BEATS_PER_BAR

export type Beat = { readonly index: number; readonly time: number; readonly accent: boolean }

/** The beats whose time lies in `[from, to)`, for a track whose beat 0 sounds at `start` seconds. */
export function beatsBetween(bpm: number, start: number, from: number, to: number): ReadonlyArray<Beat> {
  const spacing = 60 / bpm
  const first = Math.max(0, Math.ceil((from - start) / spacing - 1e-9))
  const beats: Array<Beat> = []
  for (let index = first; start + index * spacing < to; index++) {
    beats.push({ index, time: start + index * spacing, accent: index % BEATS_PER_BAR === 0 })
  }
  return beats
}

/** Whether a beat belongs to the count-in. */
export const isCountIn = (beat: Beat) => beat.index < COUNT_IN_BEATS
