import { describe, expect, it } from "bun:test"
import { barsLabel, barsOfTicks, sameBars, selectedBars, ticksOfBars, type BarTicks } from "./score-bars"

const bars: Array<BarTicks> = [0, 1, 2, 3].map((i) => ({ start: i * 100, end: (i + 1) * 100 }))

describe("barsOfTicks", () => {
  it("covers the bars a range starts in through the bar it ends in", () => {
    expect(barsOfTicks(bars, 150, 260)).toEqual({ first: 1, last: 2 })
  })

  it("does not take the bar that a range's exclusive end begins", () => {
    expect(barsOfTicks(bars, 100, 300)).toEqual({ first: 1, last: 2 })
  })

  it("keeps a range inside one bar as that bar", () => {
    expect(barsOfTicks(bars, 150, 151)).toEqual({ first: 1, last: 1 })
  })
})

describe("ticksOfBars", () => {
  it("is the inverse of barsOfTicks for whole bars", () => {
    const range = ticksOfBars(bars, { first: 1, last: 2 })
    expect(range).toEqual({ startTick: 100, endTick: 300 })
    expect(barsOfTicks(bars, range.startTick, range.endTick)).toEqual({ first: 1, last: 2 })
  })
})

describe("selectedBars", () => {
  it("reports a drag, and nothing for no range or for the drawn bars", () => {
    expect(selectedBars(bars, { startTick: 100, endTick: 300 }, null)).toEqual({ first: 1, last: 2 })
    expect(selectedBars(bars, null, null)).toBeNull()
    expect(selectedBars(bars, { startTick: 100, endTick: 300 }, { first: 1, last: 2 })).toBeNull()
  })

  it("reports a drag that narrows the drawn bars", () => {
    expect(selectedBars(bars, { startTick: 100, endTick: 200 }, { first: 0, last: 3 })).toEqual({ first: 1, last: 1 })
  })
})

describe("barsLabel", () => {
  it("counts bars from 1, and says Bar for one", () => {
    expect(barsLabel({ first: 2, last: 2 })).toBe("Bar 3")
    expect(barsLabel({ first: 2, last: 3 })).toBe("Bars 3–4")
  })
})

describe("sameBars", () => {
  it("compares the bounds, and treats two nulls as the same", () => {
    expect(sameBars({ first: 1, last: 2 }, { first: 1, last: 2 })).toBe(true)
    expect(sameBars({ first: 1, last: 2 }, { first: 1, last: 3 })).toBe(false)
    expect(sameBars(null, null)).toBe(true)
    expect(sameBars(null, { first: 0, last: 0 })).toBe(false)
  })
})
