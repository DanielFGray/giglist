import { describe, expect, test } from "bun:test"
import { finishDirection, keepOrder, navigate, step, type KeyPress } from "./grid-keys"

const size = { rows: 3, cols: 4 }
const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
})

describe("navigate", () => {
  test("arrows move one cell and stop at the edges", () => {
    expect(navigate({ row: 1, col: 1 }, press("ArrowRight"), size)).toEqual({ kind: "move", to: { row: 1, col: 2 } })
    expect(navigate({ row: 0, col: 0 }, press("ArrowUp"), size)).toEqual({ kind: "move", to: { row: 0, col: 0 } })
    expect(navigate({ row: 1, col: 3 }, press("ArrowRight"), size)).toEqual({ kind: "move", to: { row: 1, col: 3 } })
  })

  test("Tab moves right and wraps to the next row; Shift+Tab goes back", () => {
    expect(navigate({ row: 0, col: 3 }, press("Tab"), size)).toEqual({ kind: "move", to: { row: 1, col: 0 } })
    expect(navigate({ row: 1, col: 0 }, press("Tab", { shiftKey: true }), size)).toEqual({ kind: "move", to: { row: 0, col: 3 } })
  })

  test("Home, End and their Ctrl forms jump to the row's or the grid's ends", () => {
    expect(navigate({ row: 1, col: 2 }, press("Home"), size)).toEqual({ kind: "move", to: { row: 1, col: 0 } })
    expect(navigate({ row: 1, col: 2 }, press("End", { ctrlKey: true }), size)).toEqual({ kind: "move", to: { row: 2, col: 3 } })
  })

  test("typing a character starts an edit with it; Enter edits the current value", () => {
    expect(navigate({ row: 0, col: 0 }, press("G"), size)).toEqual({ kind: "edit", text: "G" })
    expect(navigate({ row: 0, col: 0 }, press("Enter"), size)).toEqual({ kind: "edit", text: null })
    expect(navigate({ row: 0, col: 0 }, press("c", { ctrlKey: true }), size)).toEqual({ kind: "none" })
  })

  test("Delete clears, Alt+arrows move the row, Ctrl+Delete removes it", () => {
    expect(navigate({ row: 0, col: 0 }, press("Delete"), size)).toEqual({ kind: "clear" })
    expect(navigate({ row: 1, col: 0 }, press("ArrowUp", { altKey: true }), size)).toEqual({ kind: "moveRow", delta: -1 })
    expect(navigate({ row: 1, col: 0 }, press("Delete", { ctrlKey: true }), size)).toEqual({ kind: "deleteRow" })
  })
})

describe("finishDirection", () => {
  test("Enter saves and goes down, Tab saves and goes right; other keys stay in the editor", () => {
    expect(finishDirection(press("Enter"))).toBe("down")
    expect(finishDirection(press("Enter", { shiftKey: true }))).toBe("up")
    expect(finishDirection(press("Tab"))).toBe("next")
    expect(finishDirection(press("ArrowLeft"))).toBe(null)
  })
})

describe("step", () => {
  test("next stops at the last cell instead of leaving the grid", () => {
    expect(step({ row: 2, col: 3 }, "next", size)).toEqual({ row: 2, col: 3 })
    expect(step({ row: 0, col: 0 }, "previous", size)).toEqual({ row: 0, col: 0 })
  })
})

describe("keepOrder", () => {
  test("shown rows keep their places, gone rows drop out, new rows go last", () => {
    expect(keepOrder(["b", "a", "c"], ["a", "b", "d", "e"])).toEqual(["b", "a", "d", "e"])
  })

  test("with nothing shown yet, the sorted order is used", () => {
    expect(keepOrder([], ["a", "b"])).toEqual(["a", "b"])
  })
})
