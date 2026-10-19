/**
 * How tightly alphaTab packs bars in a page-layout row, for a container this
 * wide. A value of 1 stretches each row to the full width, so a narrow row
 * holds one bar; a lower value packs more bars into each row. Narrow phone
 * widths pack tighter, because a bar at full stretch is wider than the screen.
 */
export function stretchForWidth(width: number): number {
  if (width <= 360) return 0.82
  if (width <= 420) return 0.88
  if (width <= 520) return 0.94
  if (width < 768) return 0.97
  return 1
}
