import { describe, expect, test } from "vitest"
import { formatTimeOfDay, timeInputValue } from "./time"

describe("time of day", () => {
  test("drops the seconds the database adds for a time input", () => {
    expect(timeInputValue("20:30:00")).toBe("20:30")
    expect(timeInputValue("20:30")).toBe("20:30")
    expect(timeInputValue(null)).toBe("")
  })

  test("reads on a twelve-hour clock", () => {
    expect(formatTimeOfDay("20:30:00")).toBe("8:30 PM")
    expect(formatTimeOfDay("00:00")).toBe("12:00 AM")
    expect(formatTimeOfDay("12:00")).toBe("12:00 PM")
    expect(formatTimeOfDay("09:05")).toBe("9:05 AM")
    expect(formatTimeOfDay(null)).toBe("")
  })
})
