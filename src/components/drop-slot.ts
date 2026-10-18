import type { Point } from "./BlockHandle"

/** A drawn row of the editor: its line, the two slots a drop on it can mean, and where it sits on screen. */
export type DropRow = {
  readonly line: number
  readonly before: number
  readonly after: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

export type DropSlot = { readonly line: number; readonly side: "before" | "after"; readonly slot: number }

/**
 * The slot under the pointer: the row it is over, and the upper half of that
 * row means the slot before it, the lower half the slot after it.
 */
export function slotUnder(rows: ReadonlyArray<DropRow>, point: Point): DropSlot | null {
  const row = rows.find((r) => point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom)
  if (!row) return null
  const side = point.y < (row.top + row.bottom) / 2 ? "before" : "after"
  return { line: row.line, side, slot: row[side] }
}
