import { describe, expect, test } from "bun:test"
import { ChordProParser } from "chordsheetjs"
import { spell } from "./spelling"

/** The 902 names in ChordSheetJS's built-in table, which spell must be able to read. */
function tableNames(): ReadonlyArray<string> {
  const parser = new ChordProParser()
  return Object.keys(parser.parse("{title: x}").chordDefinitions.withDefaults().definitions)
}

describe("spell", () => {
  test("a triad is root, third and 5th, with the plain 5th left out", () => {
    expect(spell("C")).toMatchObject({ root: 0, bass: 0, required: [0, 4], optional: [7] })
    expect(spell("Cm")).toMatchObject({ root: 0, bass: 0, required: [0, 3], optional: [7] })
    expect(spell("Cmi")).toMatchObject({ root: 0, bass: 0, required: [0, 3], optional: [7] })
  })

  test("a major-7th marker alone says only which 7th a later tone takes", () => {
    expect(spell("CM")).toMatchObject({ root: 0, bass: 0, required: [0, 4], optional: [7] })
    expect(spell("Cmaj")).toMatchObject({ root: 0, bass: 0, required: [0, 4], optional: [7] })
    expect(spell("Cma")).toMatchObject({ root: 0, bass: 0, required: [0, 4], optional: [7] })
    // A delta is the whole name for a major 7th, so it needs no number after it.
    expect(spell("CΔ")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 11], optional: [7] })
    // Minor-major 7th, in the spellings charts use.
    const minorMajor = { root: 0, bass: 0, required: [0, 3, 11], optional: [7] }
    for (const name of ["Cm(maj7)", "CmMaj7", "CmM7", "Cmmaj7", "C-Δ"]) expect(spell(name), name).toMatchObject(minorMajor)
  })

  test("a `+` or `-` before a tone is an alteration of that tone", () => {
    expect(spell("C7+5")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 8, 10], optional: [] })
    expect(spell("C7-5")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 6, 10], optional: [] })
    expect(spell("C7-9")).toMatchObject({ root: 0, bass: 0, required: [0, 1, 4, 10], optional: [7] })
    // With no tone to alter, the same characters are a quality.
    expect(spell("C+")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 8], optional: [] })
    expect(spell("C-")).toMatchObject({ root: 0, bass: 0, required: [0, 3], optional: [7] })
  })

  test("a seventh chord must hold its 7th", () => {
    expect(spell("C7")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 10], optional: [7] })
    expect(spell("Cmaj7")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 11], optional: [7] })
    expect(spell("Cm7")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 10], optional: [7] })
    expect(spell("Cm(ma7)")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 11], optional: [7] })
    expect(spell("Cmi7")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 10], optional: [7] })
    expect(spell("Cmi7b5")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 6, 10], optional: [] })
  })

  test("a diminished chord holds its 5th, because the b5 is the 5th", () => {
    expect(spell("Cm7b5")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 6, 10], optional: [] })
    expect(spell("Cdim")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 6], optional: [] })
    expect(spell("Cdim7")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 6, 9], optional: [] })
    expect(spell("Cø")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 6, 10], optional: [] })
  })

  test("an augmented chord holds its 5th, because the #5 is the 5th", () => {
    expect(spell("Caug")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 8], optional: [] })
    expect(spell("Caug7")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 8, 10], optional: [] })
  })

  test("a sus tone takes the place of the 3rd", () => {
    expect(spell("Csus2")).toMatchObject({ root: 0, bass: 0, required: [0, 2], optional: [7] })
    expect(spell("Csus4")).toMatchObject({ root: 0, bass: 0, required: [0, 5], optional: [7] })
    expect(spell("C7sus4")).toMatchObject({ root: 0, bass: 0, required: [0, 5, 10], optional: [7] })
    // The sus 4th is the natural 11th of a 13, so the 11th is not offered twice.
    expect(spell("C13sus4")).toMatchObject({ root: 0, bass: 0, required: [0, 5, 9, 10], optional: [2, 7] })
  })

  test("a power chord has no 3rd at all", () => {
    expect(spell("C5")).toMatchObject({ root: 0, bass: 0, required: [0, 7], optional: [] })
  })

  test("a sixth chord holds its 13th and no 7th", () => {
    expect(spell("C6")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 9], optional: [7] })
    expect(spell("C6/9")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 4, 9], optional: [7] })
    expect(spell("C69")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 4, 9], optional: [7] })
    expect(spell("Cm6/7")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 9, 10], optional: [7] })
  })

  test("a ninth chord must hold its 9th", () => {
    expect(spell("C9")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 4, 10], optional: [7] })
    expect(spell("Cm9")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 3, 10], optional: [7] })
    expect(spell("Cm(ma9)")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 3, 11], optional: [7] })
  })

  test("tones keep the degrees the name gave them, after the rules that add the tones below an extension", () => {
    const ninth = spell("C9")!
    expect(ninth.tones.get(9)).toBe(2)
    expect(ninth.tones.get(7)).toBe(10)
    // A 13 names the tones below it that a shape may leave out; a major 13 leaves the
    // natural 11th out, so the map does not offer it.
    expect([...spell("C13")!.tones]).toEqual([
      [1, 0],
      [3, 4],
      [5, 7],
      [13, 9],
      [7, 10],
      [9, 2],
    ])
    expect(spell("C13")!.tones.has(11)).toBe(false)
  })

  test("an 11 chord may drop its 3rd, and a minor 11 may not", () => {
    expect(spell("C11")).toMatchObject({ root: 0, bass: 0, required: [0, 5, 10], optional: [2, 4, 7] })
    expect(spell("Cm11")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 5, 10], optional: [2, 7] })
  })

  test("a 13 chord leaves the 11th out, because it rings against the 3rd", () => {
    expect(spell("C13")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 9, 10], optional: [2, 7] })
    expect(spell("Cmaj13")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 9, 11], optional: [2, 7] })
    expect(spell("Cm13")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 9, 10], optional: [2, 5, 7] })
  })

  test("an alteration replaces the plain tone it names", () => {
    expect(spell("C13b9")).toMatchObject({ root: 0, bass: 0, required: [0, 1, 4, 9, 10], optional: [7] })
    expect(spell("C7#9")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 4, 10], optional: [7] })
    expect(spell("Cmaj7#11")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 6, 11], optional: [7] })
    expect(spell("Bb13b9")).toMatchObject({ root: 10, bass: 10, required: [2, 7, 8, 10, 11], optional: [5] })
  })

  test("an added tone is held by every shape", () => {
    expect(spell("Cadd9")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 4], optional: [7] })
    // `m` in front of `add` is a minor triad, not the head of `maj`.
    expect(spell("Cmadd9")).toMatchObject({ root: 0, bass: 0, required: [0, 2, 3], optional: [7] })
    expect(spell("C(4)")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 5], optional: [7] })
    expect(spell("Cm7(4)")).toMatchObject({ root: 0, bass: 0, required: [0, 3, 5, 10], optional: [7] })
  })

  test("a bare 2 may go without its 3rd, unless a minor marker asked for it", () => {
    // ChordSheetJS writes A2, D2 and G2 as shapes that leave the 3rd out, and Cm2
    // as one that holds it. The rule follows the minor marker, not the shape.
    expect(spell("C2")).toMatchObject({ root: 0, bass: 0, required: [0, 2], optional: [4, 7] })
    expect(spell("A2")).toMatchObject({ root: 9, bass: 9, required: [9, 11], optional: [1, 4] })
    expect(spell("Am2")).toMatchObject({ root: 9, bass: 9, required: [0, 9, 11], optional: [4] })
  })

  test("an added 11th keeps the 3rd, and a slash 3rd is the bass", () => {
    expect(spell("F#m7add11")).toMatchObject({ root: 6, bass: 6, required: [4, 6, 9, 11], optional: [1] })
    expect(spell("Gsus2/B")).toMatchObject({ root: 7, bass: 11, required: [7, 9, 11], optional: [2] })
  })

  test("a slash bass is held even when it is not a chord tone", () => {
    expect(spell("C/E")).toMatchObject({ root: 0, bass: 4, required: [0, 4], optional: [7] })
    expect(spell("C/F#")).toMatchObject({ root: 0, bass: 6, required: [0, 4, 6], optional: [7] })
  })

  test("an omission removes the tone entirely", () => {
    expect(spell("Cno3")).toMatchObject({ root: 0, bass: 0, required: [0], optional: [7] })
    expect(spell("C7omit5")).toMatchObject({ root: 0, bass: 0, required: [0, 4, 10], optional: [] })
  })

  test("a name it cannot read returns null", () => {
    for (const name of ["H", "X", "N.C.", "Cfoo", "C/H", ""]) expect(spell(name)).toBeNull()
  })

  test("every name in the ChordSheetJS table spells", () => {
    const names = tableNames()
    expect(names.length).toBe(902)
    const unread: string[] = []
    const missing: string[] = []
    for (const name of names) {
      const spelled = spell(name)
      if (spelled === null) {
        unread.push(name)
        continue
      }
      const held = [...spelled.required, ...spelled.optional]
      if (!held.includes(spelled.root) || !held.includes(spelled.bass)) missing.push(name)
    }
    expect(unread).toEqual([])
    expect(missing).toEqual([])
  })

  test("required and optional never name the same pitch class", () => {
    const shared: string[] = []
    for (const name of tableNames()) {
      const spelled = spell(name)
      if (spelled === null) continue
      const both = spelled.required.filter((pitchClass) => spelled.optional.includes(pitchClass))
      if (both.length > 0) shared.push(`${name}: ${both.join(",")}`)
    }
    expect(shared).toEqual([])
  })
})
