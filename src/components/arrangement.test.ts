import { describe, expect, test } from "vitest"
import { Option } from "effect"
import { moveTo, stepMove } from "./arrangement"

const ids = ["a", "b", "c", "d"]

describe("moveTo", () => {
  test("names the row that will stand right before the moved one", () => {
    expect(moveTo(ids, "d", 1)).toEqual(Option.some({ id: "d", previous: "a" }))
    expect(moveTo(ids, "a", 2)).toEqual(Option.some({ id: "a", previous: "c" }))
  })

  test("moving to the top has no previous row", () => {
    expect(moveTo(ids, "c", 0)).toEqual(Option.some({ id: "c", previous: null }))
  })

  test("clamps past the end, and is none when nothing moves", () => {
    expect(moveTo(ids, "a", 99)).toEqual(Option.some({ id: "a", previous: "d" }))
    expect(moveTo(ids, "b", 1)).toEqual(Option.none())
    expect(moveTo(ids, "x", 0)).toEqual(Option.none())
  })
})

describe("stepMove", () => {
  test("moves one place, and not past either end", () => {
    expect(stepMove(ids, "c", -1)).toEqual(Option.some({ id: "c", previous: "a" }))
    expect(stepMove(ids, "b", 1)).toEqual(Option.some({ id: "b", previous: "c" }))
    expect(stepMove(ids, "a", -1)).toEqual(Option.none())
    expect(stepMove(ids, "d", 1)).toEqual(Option.none())
  })
})
