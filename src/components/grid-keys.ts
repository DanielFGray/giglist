/**
 * The keyboard rules of a spreadsheet grid, as pure functions over cell
 * positions. `Grid.tsx` owns focus and editing; these decide where a key goes.
 *
 * A grid is in one of two modes. Navigating, a cell has focus: arrows move,
 * Tab moves right and wraps to the next row, typing starts an edit with what
 * was typed, Enter or F2 edits the current value, Delete clears the cell, and
 * Ctrl+Delete removes the row.
 * Editing, an editor holds focus: Enter saves and moves down, Tab saves and
 * moves right, Escape cancels, and the editor's own keys move the caret.
 */

export type Cell = { readonly row: number; readonly col: number }
export type Size = { readonly rows: number; readonly cols: number }

/** Where a saved edit sends focus, or where a navigation key moves it. */
export type Direction = "up" | "down" | "left" | "right" | "next" | "previous" | "stay"

/** What a key pressed on a focused (not editing) cell asks for. */
export type Intent =
  | { readonly kind: "move"; readonly to: Cell }
  | { readonly kind: "edit"; readonly text: string | null }
  | { readonly kind: "clear" }
  | { readonly kind: "moveRow"; readonly delta: -1 | 1 }
  | { readonly kind: "deleteRow" }
  | { readonly kind: "none" }

/** The parts of a keyboard event the rules read. */
export type KeyPress = {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

/** The intent of a key pressed while `cell` has focus. `text: null` edits the cell's current value. */
export function navigate(cell: Cell, press: KeyPress, size: Size): Intent {
  const command = press.ctrlKey || press.metaKey
  if (press.altKey && (press.key === "ArrowUp" || press.key === "ArrowDown")) {
    return { kind: "moveRow", delta: press.key === "ArrowUp" ? -1 : 1 }
  }
  if (command && (press.key === "Delete" || press.key === "Backspace")) return { kind: "deleteRow" }
  const move = (to: Cell): Intent => ({ kind: "move", to })
  switch (press.key) {
    case "ArrowUp":
      return move(command ? { row: 0, col: cell.col } : step(cell, "up", size))
    case "ArrowDown":
      return move(command ? { row: size.rows - 1, col: cell.col } : step(cell, "down", size))
    case "ArrowLeft":
      return move(step(cell, "left", size))
    case "ArrowRight":
      return move(step(cell, "right", size))
    case "Tab":
      return move(step(cell, press.shiftKey ? "previous" : "next", size))
    case "Home":
      return move(command ? { row: 0, col: 0 } : { row: cell.row, col: 0 })
    case "End":
      return move(command ? { row: size.rows - 1, col: size.cols - 1 } : { row: cell.row, col: size.cols - 1 })
    case "Enter":
    case "F2":
      return { kind: "edit", text: null }
    case "Delete":
    case "Backspace":
      return { kind: "clear" }
  }
  // One printable character starts an edit that replaces the value, as in a spreadsheet.
  if (/^.$/u.test(press.key) && !command && !press.altKey) return { kind: "edit", text: press.key }
  return { kind: "none" }
}

/** Where a key that ends an edit sends focus; null for a key that does not end it. */
export function finishDirection(press: KeyPress): Direction | null {
  if (press.key === "Enter") return press.shiftKey ? "up" : "down"
  if (press.key === "Tab") return press.shiftKey ? "previous" : "next"
  return null
}

/**
 * The cell one step away. Arrows stop at the edges; `next` and `previous`
 * (Tab) wrap to the neighbouring row, and stop at the grid's first and last cells.
 */
export function step(cell: Cell, direction: Direction, size: Size): Cell {
  const lastRow = Math.max(size.rows - 1, 0)
  const lastCol = Math.max(size.cols - 1, 0)
  switch (direction) {
    case "up":
      return { row: Math.max(cell.row - 1, 0), col: cell.col }
    case "down":
      return { row: Math.min(cell.row + 1, lastRow), col: cell.col }
    case "left":
      return { row: cell.row, col: Math.max(cell.col - 1, 0) }
    case "right":
      return { row: cell.row, col: Math.min(cell.col + 1, lastCol) }
    case "next":
      if (cell.col < lastCol) return { row: cell.row, col: cell.col + 1 }
      return cell.row < lastRow ? { row: cell.row + 1, col: 0 } : cell
    case "previous":
      if (cell.col > 0) return { row: cell.row, col: cell.col - 1 }
      return cell.row > 0 ? { row: cell.row - 1, col: lastCol } : cell
    case "stay":
      return cell
  }
}

/**
 * The display order of a sorted grid after its rows change. A spreadsheet sorts
 * when asked, not when a value changes: rows already shown keep their places,
 * rows that are gone drop out, and new rows go last in the order `sorted` gives
 * them, so a run of titles typed into the last row stays together in the order
 * typed.
 */
export function keepOrder(shown: ReadonlyArray<string>, sorted: ReadonlyArray<string>): Array<string> {
  const present = new Set(sorted)
  const kept = shown.filter((key) => present.has(key))
  const known = new Set(kept)
  return [...kept, ...sorted.filter((key) => !known.has(key))]
}
