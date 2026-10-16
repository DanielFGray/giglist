import { describe, expect, test } from "bun:test"
import { composeChanges, isChangeSet, lengthAfter, type Change } from "./changes"

/** Applies a change set to labelled units; inserted units are labelled "+". */
const apply = (units: ReadonlyArray<string>, changes: ReadonlyArray<Change>): Array<string> => {
  const out: Array<string> = []
  let at = 0
  for (const c of changes) {
    out.push(...units.slice(at, c.from), ...Array<string>(c.insert).fill("+"))
    at = c.to
  }
  return [...out, ...units.slice(at)]
}

describe("composeChanges", () => {
  test("is the identity around an empty set", () => {
    const c = [{ from: 2, to: 3, insert: 1 }]
    expect(composeChanges([], c)).toEqual(c)
    expect(composeChanges(c, [])).toEqual(c)
  })

  test("drops text that was inserted and then deleted", () => {
    expect(composeChanges([{ from: 4, to: 4, insert: 3 }], [{ from: 4, to: 7, insert: 0 }])).toEqual([])
  })

  test("merges a delete and an insert that touch", () => {
    expect(composeChanges([{ from: 2, to: 4, insert: 0 }], [{ from: 2, to: 2, insert: 5 }])).toEqual([{ from: 2, to: 4, insert: 5 }])
  })

  test("equals applying the two sets one after the other, on random edits", () => {
    let seed = 7
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const randomSet = (length: number): Array<Change> => {
      const changes: Array<Change> = []
      let at = 0
      while (at < length && random(3) > 0) {
        const from = at + random(Math.min(5, length - at + 1))
        const to = Math.min(length, from + random(4))
        const insert = random(4)
        if (to === from && insert === 0) break
        changes.push({ from, to, insert })
        at = to + 1
      }
      return changes
    }
    for (let round = 0; round < 500; round++) {
      const original = Array.from({ length: 12 + random(8) }, (_, i) => `o${i}`)
      const first = randomSet(original.length)
      const middle = apply(original, first)
      const second = randomSet(middle.length)
      const composed = composeChanges(first, second)
      expect(isChangeSet(composed)).toBe(true)
      // "+" units from either set look alike, so compare originals' order and the count of new units.
      expect(apply(original, composed)).toEqual(apply(middle, second))
      expect(lengthAfter(original.length, composed)).toBe(lengthAfter(middle.length, second))
    }
  })
})
