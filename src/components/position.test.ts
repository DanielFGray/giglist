import { describe, expect, test } from "bun:test"
import { between, rebalance } from "./position"

describe("position keys", () => {
  test("creates a key between open and bounded neighbours", () => {
    expect("a0" < between("a0", "a1") && between("a0", "a1") < "a1").toBe(true)
    expect(between(null, null)).toBe("U")
    expect(between("0", null) > "0").toBe(true)
    expect(between(null, "z") < "z").toBe(true)
  })

  test("stays strictly between neighbours over many random insertions", () => {
    let state = 5
    const random = (n: number) => ((state = (state * 1664525 + 1013904223) >>> 0), state % n)
    const keys = ["U"]
    for (let i = 0; i < 2000; i++) {
      const at = random(keys.length + 1)
      const before = at === 0 ? null : keys[at - 1]!
      const after = at === keys.length ? null : keys[at]!
      const key = between(before, after)
      expect(before === null || before < key).toBe(true)
      expect(after === null || key < after).toBe(true)
      expect(key.endsWith("0")).toBe(false)
      keys.splice(at, 0, key)
    }
  })

  test("rebalance returns sorted keys with room around each sibling", () => {
    const keys = rebalance(5)
    expect(keys).toHaveLength(5)
    expect(keys).toEqual([...keys].sort())
    expect(new Set(keys).size).toBe(5)
    for (let count = 0; count < 300; count++) expect(rebalance(count).some((key) => key.endsWith("0"))).toBe(false)
  })

  test("repeated insertion between neighbours eventually needs rebalancing", () => {
    let key = "0"
    for (let index = 0; index < 200; index += 1) key = between(key, "1")
    expect(key.length).toBeGreaterThan(32)
    const keys = rebalance(3)
    expect(keys.every((value) => value.length <= 32)).toBe(true)
  })
})
