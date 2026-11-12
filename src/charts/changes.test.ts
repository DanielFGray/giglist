import { describe, expect, test } from "vitest"
import { Schema as S } from "effect"
import { ChartChange } from "../api/charts"
import { composeChanges, explains, isChangeSet, lengthAfter, type Change } from "./changes"
import { mapRange } from "./follow"

/** Applies a change set to labelled units; fresh units are labelled "+", moved ones keep their label. */
const apply = (units: ReadonlyArray<string>, changes: ReadonlyArray<Change>): Array<string> => {
  const out: Array<string> = []
  let at = 0
  for (const c of changes) {
    out.push(...units.slice(at, c.from), ...(c.source === undefined ? Array<string>(c.insert).fill("+") : units.slice(c.source, c.source + c.insert)))
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

  test("keeps a move whose source is not where it lands", () => {
    const units = ["a", "b", "c", "d", "e", "f"]
    const move = [{ from: 0, to: 0, insert: 2, source: 4 }, { from: 4, to: 6, insert: 0 }]
    expect(isChangeSet(move)).toBe(true)
    expect(apply(units, composeChanges([], move))).toEqual(["e", "f", "a", "b", "c", "d"])
    expect(mapRange({ start: 4, end: 5 }, composeChanges([], move))).toEqual({ start: 0, end: 1 })
  })

  test("keeps a move made after an earlier edit", () => {
    const units = ["a", "b", "c", "d", "e", "f"]
    const first = [{ from: 0, to: 0, insert: 1 }]
    const second = [{ from: 0, to: 0, insert: 2, source: 5 }, { from: 5, to: 7, insert: 0 }]
    const composed = composeChanges(first, second)
    expect(apply(units, composed)).toEqual(apply(apply(units, first), second))
    expect(mapRange({ start: 4, end: 5 }, composed)).toEqual({ start: 0, end: 1 })
  })

  test("a move undone leaves no change", () => {
    const down = [{ from: 0, to: 2, insert: 0 }, { from: 4, to: 4, insert: 2, source: 0 }]
    const up = [{ from: 0, to: 0, insert: 2, source: 2 }, { from: 2, to: 4, insert: 0 }]
    expect(composeChanges(down, up)).toEqual([])
  })

  test("two moves in a row keep every unit's place", () => {
    const units = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const first = [{ from: 2, to: 4, insert: 0 }, { from: 6, to: 6, insert: 2, source: 2 }]
    const second = [{ from: 0, to: 0, insert: 2, source: 4 }, { from: 4, to: 6, insert: 0 }]
    const composed = composeChanges(first, second)
    expect(isChangeSet(composed)).toBe(true)
    expect(apply(units, composed)).toEqual(apply(apply(units, first), second))
  })

  test("keeps an untouched part of a moved insertion", () => {
    expect(composeChanges([{ from: 2, to: 5, insert: 0 }, { from: 6, to: 6, insert: 3, source: 2 }], [{ from: 4, to: 4, insert: 1 }])).toEqual([
      { from: 2, to: 5, insert: 0 },
      { from: 6, to: 6, insert: 1, source: 2 },
      { from: 6, to: 6, insert: 1 },
      { from: 6, to: 6, insert: 2, source: 3 },
    ])
  })

  test("rejects copied, overlapping, and empty source ranges", () => {
    expect(isChangeSet([{ from: 0, to: 0, insert: 2, source: 1 }, { from: 1, to: 3, insert: 0 }, { from: 4, to: 4, insert: 2, source: 1 }])).toBe(false)
    expect(isChangeSet([{ from: 0, to: 2, insert: 0 }, { from: 3, to: 4, insert: 0, source: 0 }])).toBe(false)
  })

  test("explains checks the anchor text named by a move", () => {
    expect(explains("abcdef", "adefbc", [
      { from: 1, to: 3, insert: 0 },
      { from: 6, to: 6, insert: 2, source: 1 },
    ])).toBe(true)
    expect(explains("abcdef", "adefXY", [
      { from: 1, to: 3, insert: 0 },
      { from: 6, to: 6, insert: 2, source: 1 },
    ])).toBe(false)
  })

  test("ChartChange accepts source when present and rejects a negative source", () => {
    const withoutSource: unknown = { from: 1, to: 2, insert: 3 }
    const withSource: unknown = { from: 1, to: 2, insert: 3, source: 4 }
    const negativeSource: unknown = { from: 1, to: 2, insert: 3, source: -1 }
    expect(S.decodeUnknownSync(ChartChange)(withoutSource)).toEqual({ from: 1, to: 2, insert: 3 })
    expect(S.decodeUnknownSync(ChartChange)(withSource)).toEqual({ from: 1, to: 2, insert: 3, source: 4 })
    expect(() => S.decodeUnknownSync(ChartChange)(negativeSource)).toThrow()
  })

  test("every unit keeps its place through composed inserts, deletes and moves", () => {
    // SEED=<n> reruns the one failing case.
    const only = process.env.SEED === undefined ? undefined : Number(process.env.SEED)
    for (let seed = only ?? 1; seed < (only ?? 1) + (only === undefined ? 500 : 1); seed++) {
      let state = seed
      const random = (n: number) => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state % n
      }
      const original = Array.from({ length: 8 + random(10) }, (_, i) => `o${i}`)
      let units = original
      let composed: Array<Change> = []
      const steps = 2 + random(3)
      for (let step = 0; step < steps; step++) {
        const changes = randomStep(units.length, random)
        units = apply(units, changes)
        composed = composeChanges(composed, changes)
      }
      expect(isChangeSet(composed), `seed ${seed}`).toBe(true)
      expect(apply(original, composed), `seed ${seed}`).toEqual(units)
      original.forEach((label, i) => {
        const at = units.indexOf(label)
        const mapped = mapRange({ start: i, end: i + 1 }, composed)
        if (at >= 0) expect(mapped, `seed ${seed}, unit ${label}`).toEqual({ start: at, end: at + 1 })
        // A deleted unit's mark is lost, or lands on the text that replaced it, and never on another original unit.
        else if (mapped !== null) expect(units.slice(mapped.start, mapped.end).every((unit) => unit === "+"), `seed ${seed}, unit ${label}`).toBe(true)
      })
    }
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

/** One random change set over `length` units: an insert, a delete, or a move to a spot outside the moved stretch. */
function randomStep(length: number, random: (n: number) => number): Array<Change> {
  const kind = length < 2 ? 0 : random(3)
  if (kind === 0) {
    const at = random(length + 1)
    return [{ from: at, to: at, insert: 1 + random(3) }]
  }
  const from = random(length - 1)
  const to = from + 1 + random(Math.min(4, length - from))
  if (kind === 1) return [{ from, to, insert: 0 }]
  const insert = to - from
  const destination = random(length + 1 - insert)
  const at = destination <= from ? destination : destination + insert
  return at <= from
    ? [{ from: at, to: at, insert, source: from }, { from, to, insert: 0 }]
    : [{ from, to, insert: 0 }, { from: at, to: at, insert, source: from }]
}
