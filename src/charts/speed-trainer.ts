/**
 * The speed trainer repeats a passage and plays it a little faster each time.
 * This is the arithmetic: pure and free of the DOM, so the player and the tests
 * share it.
 */

/** How much a trainer step adds: a percentage of the current speed, or beats per minute of the song's tempo. */
export type StepMode = "percent" | "bpm"

export const MIN_SPEED = 0.25
export const MAX_SPEED = 3

/** A speed inside what alphaTab plays well, rounded to a thousandth. */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) * 1000) / 1000
}

/**
 * The speed for the next round. A percent step multiplies the current speed; a
 * BPM step adds that many beats per minute to the song's tempo, so it needs the
 * tempo and leaves the speed alone without one.
 */
export function nextSpeed(current: number, mode: StepMode, step: number, tempo: number | null): number {
  const added = Math.max(0, step)
  if (added === 0) return clampSpeed(current)
  if (mode === "bpm") return tempo && tempo > 0 ? clampSpeed(current + added / tempo) : clampSpeed(current)
  return clampSpeed(current * (1 + added / 100))
}

/** Minutes and seconds of a time in milliseconds: `3:07`. */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
