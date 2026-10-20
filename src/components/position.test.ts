import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { between, placeAfter, rebalance } from "./position"

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

describe("placeAfter", () => {
  const rows = [
    { id: "a", position_key: "A" },
    { id: "b", position_key: "B" },
  ]

  test("writes one key between the new neighbours", () => {
    expect(placeAfter(rows, "m", null)).toEqual(Option.some([{ id: "m", position_key: between(null, "A") }]))
    expect(placeAfter(rows, "m", "a")).toEqual(Option.some([{ id: "m", position_key: between("A", "B") }]))
    expect(placeAfter(rows, "m", "b")).toEqual(Option.some([{ id: "m", position_key: between("B", null) }]))
  })

  test("refuses a neighbour outside the group", () => {
    expect(placeAfter(rows, "m", "elsewhere")).toEqual(Option.none())
  })

  test("renumbers the whole group, in the new order, when the key would grow too long", () => {
    const crowded = [
      { id: "a", position_key: "A" },
      { id: "b", position_key: `A${"0".repeat(40)}1` },
    ]
    const writes = Option.getOrThrow(placeAfter(crowded, "m", "a"))
    expect(writes.map((row) => row.id)).toEqual(["a", "m", "b"])
    expect(writes.map((row) => row.position_key)).toEqual(rebalance(3))
  })
})
