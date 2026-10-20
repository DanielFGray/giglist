import { describe, expect, test } from "bun:test"
import { matchKeys } from "./key-options"

describe("matchKeys", () => {
  test("puts the key typed exactly first, ignoring case", () => {
    expect(matchKeys("c")[0]).toBe("C")
    expect(matchKeys("f#M")[0]).toBe("F#m")
  })

  test("offers keys that start with the text before keys that only contain it", () => {
    const matches = matchKeys("b")
    expect(matches.indexOf("Bb")).toBeLessThan(matches.indexOf("Ab"))
  })

  test("offers every key for an empty query, and none for nonsense", () => {
    expect(matchKeys("").length).toBeGreaterThan(20)
    expect(matchKeys("zz")).toEqual([])
  })
})
