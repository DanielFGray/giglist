/** Pure rules of the stage view: moving through the setlist and reading a swipe. */

/** The song index after moving `delta` places, held inside the setlist. */
export function stepIndex(index: number, delta: number, length: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(length - 1, 0))
}

/** The index from the `at` search value (a 1-based song number); anything else starts at the first song. */
export function indexFromSearch(at: unknown, length: number): number {
  const number = typeof at === "number" ? at : typeof at === "string" ? Number(at) : Number.NaN
  return Number.isInteger(number) ? stepIndex(number - 1, 0, length) : 0
}

/**
 * Which way a finished touch moved the setlist: -1 back, 1 forward, 0 for a tap
 * or a scroll. A swipe must be mostly sideways and long enough that a slip of the
 * finger while reading does not change the song.
 */
export function swipeDirection(dx: number, dy: number, minimum = 60): -1 | 0 | 1 {
  if (Math.abs(dx) < minimum || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}

/** Text sizes the stage view offers, in rem. */
export const TEXT_SIZES = [1, 1.25, 1.5, 1.875, 2.25, 3] as const

export function stepSize(index: number, delta: number): number {
  return Math.min(Math.max(index + delta, 0), TEXT_SIZES.length - 1)
}
