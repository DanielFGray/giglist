/**
 * How large alphaTab draws a score: its `display.scale`, where 1 is 100%. Pure
 * and free of the DOM, so the player and the tests share it.
 */

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.1

/** A zoom inside the supported range, rounded to a hundredth. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100
}

/** The zoom one step larger (`direction` 1) or smaller (-1). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(zoom + direction * ZOOM_STEP)
}
