import { describe, expect, test } from "vitest"
import { indexFromSearch, stepIndex, stepSize, swipeDirection, TEXT_SIZES } from "./perform"

describe("stage navigation", () => {
  test("stepping stays inside the setlist", () => {
    expect(stepIndex(0, -1, 5)).toBe(0)
    expect(stepIndex(4, 1, 5)).toBe(4)
    expect(stepIndex(2, 1, 5)).toBe(3)
    expect(stepIndex(0, 1, 0)).toBe(0)
  })

  test("the search value is a 1-based song number, held inside the setlist", () => {
    expect(indexFromSearch(3, 5)).toBe(2)
    expect(indexFromSearch("2", 5)).toBe(1)
    expect(indexFromSearch(99, 5)).toBe(4)
    expect(indexFromSearch(0, 5)).toBe(0)
    expect(indexFromSearch("x", 5)).toBe(0)
    expect(indexFromSearch(undefined, 5)).toBe(0)
  })

  test("a swipe left goes forward, right goes back; taps and scrolls do nothing", () => {
    expect(swipeDirection(-120, 10)).toBe(1)
    expect(swipeDirection(120, -10)).toBe(-1)
    expect(swipeDirection(10, 5)).toBe(0)
    expect(swipeDirection(-80, 90)).toBe(0)
  })

  test("text size steps stay on the list", () => {
    expect(stepSize(0, -1)).toBe(0)
    expect(stepSize(TEXT_SIZES.length - 1, 1)).toBe(TEXT_SIZES.length - 1)
    expect(stepSize(2, 1)).toBe(3)
  })
})
