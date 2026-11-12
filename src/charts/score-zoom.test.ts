import { describe, expect, test } from "vitest"
import { MAX_ZOOM, MIN_ZOOM, clampZoom, stepZoom } from "./score-zoom"

describe("clampZoom", () => {
  test("keeps a zoom in range and rounds it", () => {
    expect(clampZoom(1.234)).toBe(1.23)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
  })
  test("falls back to 100% for a value that is not a number", () => {
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})

describe("stepZoom", () => {
  test("moves by a tenth without float drift", () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1.1, 1)).toBe(1.2)
    expect(stepZoom(0.7, -1)).toBe(0.6)
  })
  test("stops at the limits", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})
