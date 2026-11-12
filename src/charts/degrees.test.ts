import { describe, expect, test } from "vitest"
import { degrees } from "./degrees"
import { spell } from "./spelling"
import type { Voicing } from "./fretting"

/** The labels `name`'s notes get in one shape, in standard tuning. */
function labels(name: string, frets: Voicing["frets"]): ReadonlyArray<string | null> {
  const spelled = spell(name)
  if (spelled === null) throw new Error(`${name} does not spell`)
  return degrees(spelled, { frets })
}

describe("degrees", () => {
  test("a triad names the root, the 3rd and the 5th every note sounds, open strings included", () => {
    // x 3 2 0 1 0, the open C: R, 3, 5, R, 3 with the low string muted.
    expect(labels("C", [null, 3, 2, 0, 1, 0])).toEqual([null, "R", "3", "5", "R", "3"])
    // x 3 1 0 1 3, the open Cm: the b3 replaces the 3.
    expect(labels("Cm", [null, 3, 1, 0, 1, 3])).toEqual([null, "R", "b3", "5", "R", "5"])
  })

  test("a seventh chord names its 7th as b7", () => {
    // x 3 2 3 1 0, the open C7.
    expect(labels("C7", [null, 3, 2, 3, 1, 0])).toEqual([null, "R", "3", "b7", "R", "3"])
  })

  test("an altered 11 is named #11", () => {
    // The first C7#11 shape holds the #11 on the 4th string.
    expect(labels("C7#11", [null, 3, 4, 3, 5, 3])).toEqual([null, "R", "#11", "b7", "3", "5"])
  })

  test("a sus 4th keeps the 4th's name on the pitch it shares with the 11th", () => {
    // A sus 4th and a natural 11th are one pitch class, and the sus chord names it 4.
    const spelled = spell("C13sus4")!
    expect(spelled.tones.get(4)).toBe(5)
    expect(spelled.tones.get(11)).toBe(5)
    expect(labels("C13sus4", [null, 3, 3, 3, 3, 5])).toEqual([null, "R", "4", "b7", "9", "13"])
  })

  test("a name that does not spell has no labels to give", () => {
    expect(spell("Hm")).toBeNull()
  })

  test("a string sounding no tone the chord names gets no label", () => {
    // The 4th string at fret 4 is F#, which no C chord names. No shape offers it,
    // so a label has to survive it rather than print a wrong degree.
    expect(labels("C", [null, 3, 4, 0, 1, 0])).toEqual([null, "R", null, "5", "R", "3"])
  })
})
