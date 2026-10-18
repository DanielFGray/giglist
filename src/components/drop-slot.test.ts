import { describe, expect, test } from "bun:test"
import { slotUnder, type DropRow } from "./drop-slot"

const rows: ReadonlyArray<DropRow> = [
  { line: 1, before: 1, after: 2, left: 0, right: 300, top: 0, bottom: 40 },
  { line: 2, before: 2, after: 3, left: 0, right: 300, top: 40, bottom: 80 },
  // A phrase: after it is the line past its end line.
  { line: 3, before: 3, after: 7, left: 0, right: 300, top: 100, bottom: 200 },
]

describe("slotUnder", () => {
  test("the upper half of a row is the slot before it and the lower half the slot after it", () => {
    expect(slotUnder(rows, { x: 10, y: 5 })).toEqual({ line: 1, side: "before", slot: 1 })
    expect(slotUnder(rows, { x: 10, y: 35 })).toEqual({ line: 1, side: "after", slot: 2 })
    expect(slotUnder(rows, { x: 10, y: 150 })).toEqual({ line: 3, side: "after", slot: 7 })
  })

  test("the half-way line belongs to the lower half, and a row's bottom edge to the next row", () => {
    expect(slotUnder(rows, { x: 10, y: 20 })?.side).toBe("after")
    expect(slotUnder(rows, { x: 10, y: 40 })).toEqual({ line: 2, side: "before", slot: 2 })
  })

  test("a point between rows or beside them is over no slot", () => {
    expect(slotUnder(rows, { x: 10, y: 90 })).toBeNull()
    expect(slotUnder(rows, { x: 300, y: 10 })).toBeNull()
    expect(slotUnder(rows, { x: -1, y: 10 })).toBeNull()
  })
})
