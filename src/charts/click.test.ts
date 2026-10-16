import { describe, expect, test } from "bun:test"
import { beatsBetween, COUNT_IN_BEATS, isCountIn } from "./click"

describe("click track", () => {
  test("beats are a beat apart at the tempo, and the first of each bar is accented", () => {
    const beats = beatsBetween(120, 10, 10, 14.01)
    expect(beats.map((b) => b.time)).toEqual([10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14])
    expect(beats.filter((b) => b.accent).map((b) => b.index)).toEqual([0, 4, 8])
  })

  test("asking in consecutive windows gives every beat once", () => {
    const whole = beatsBetween(100, 0, 0, 6)
    const edges = [0, 1.7, 3.1, 4.9, 6]
    const parts = edges.slice(1).flatMap((to, i) => [...beatsBetween(100, 0, edges[i]!, to)])
    expect(parts).toEqual([...whole])
  })

  test("a window before the start has no beats, and one starting late skips the earlier beats", () => {
    expect(beatsBetween(60, 5, 0, 5)).toEqual([])
    expect(beatsBetween(60, 5, 7.5, 10).map((b) => b.index)).toEqual([3, 4])
  })

  test("the count-in is one bar", () => {
    const beats = beatsBetween(90, 0, 0, 10)
    expect(beats.filter(isCountIn)).toHaveLength(COUNT_IN_BEATS)
  })
})
