import { describe, expect, test } from "vitest"
import { clampSpeed, formatClock, nextSpeed } from "./speed-trainer"

describe("clampSpeed", () => {
  test("keeps a speed inside the playable range", () => {
    expect(clampSpeed(0.1)).toBe(0.25)
    expect(clampSpeed(9)).toBe(3)
    expect(clampSpeed(0.8)).toBe(0.8)
  })

  test("a value that is not a number plays at normal speed", () => {
    expect(clampSpeed(Number.NaN)).toBe(1)
  })
})

describe("nextSpeed", () => {
  test("a percent step multiplies the speed", () => {
    expect(nextSpeed(0.5, "percent", 10, 120)).toBe(0.55)
  })

  test("a BPM step adds beats to the song's tempo", () => {
    expect(nextSpeed(0.5, "bpm", 6, 120)).toBe(0.55)
  })

  test("a BPM step with no tempo, or a zero step, changes nothing", () => {
    expect(nextSpeed(0.5, "bpm", 6, null)).toBe(0.5)
    expect(nextSpeed(0.5, "percent", 0, 120)).toBe(0.5)
  })

  test("the speed stops at the top of the range", () => {
    expect(nextSpeed(2.9, "percent", 50, 120)).toBe(3)
  })
})

describe("formatClock", () => {
  test("shows minutes and zero-padded seconds", () => {
    expect(formatClock(187_400)).toBe("3:07")
    expect(formatClock(-5)).toBe("0:00")
  })
})
