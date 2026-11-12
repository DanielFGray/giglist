import { describe, expect, it } from "vitest"
import { stretchForWidth } from "./stretch"

describe("stretchForWidth", () => {
  it("packs bars tighter as the container narrows, and stretches a wide one fully", () => {
    expect([320, 390, 480, 600, 900].map(stretchForWidth)).toEqual([0.82, 0.88, 0.94, 0.97, 1])
  })

  it("changes at each breakpoint's upper edge", () => {
    expect([360, 361, 420, 421, 520, 521, 767, 768].map(stretchForWidth)).toEqual([0.82, 0.88, 0.88, 0.94, 0.94, 0.97, 0.97, 1])
  })
})
