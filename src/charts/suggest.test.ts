import { describe, expect, it } from "vitest"
import { parseDoc } from "./doc"
import { chartSlot, suggest, type Slot } from "./suggest"

const chords = (list: ReadonlyArray<{ chord: string }>) => list.map(({ chord }) => chord)

describe("suggest", () => {
  it("splits the chords the song uses from every chord of the key it does not use yet", () => {
    const { likely, fresh } = suggest({ key: "G", before: ["G", "C", "D"], after: [] })
    expect(chords(likely).toSorted()).toEqual(["C", "D", "G"])
    expect(chords(fresh)).toEqual(expect.arrayContaining(["Am", "Bm", "Em", "F#dim"]))
    expect(chords(fresh).filter((chord) => ["G", "C", "D"].includes(chord))).toEqual([])
  })

  it("offers the dominant 7th of the next chord as a passing chord, named as applied", () => {
    const passing = suggest({ key: "G", before: ["G", "C"], after: ["Em"] }).fresh.find(({ chord }) => chord === "B7")
    expect(passing).toEqual({ chord: "B7", numeral: "V7/vi", reason: "leads to Em" })
  })

  it("continues the song's own progression first", () => {
    expect(suggest({ key: "G", before: ["G", "D", "Em", "C", "G", "D", "Em"], after: [] }).likely[0]?.chord).toBe("C")
  })

  it("puts the chord from the same place in a repeated section first", () => {
    const { likely } = suggest({ key: "G", before: ["G"], after: ["C"], repeat: { chord: "D/F#", section: "Verse 1" } })
    expect(likely[0]).toEqual({ chord: "D/F#", numeral: "V6", reason: "as in Verse 1" })
  })

  it("spells each root on the key's own letter, and a leading diminished chord with a sharp", () => {
    const every = (slot: Slot) => {
      const { likely, fresh } = suggest(slot, Infinity)
      return chords([...likely, ...fresh])
    }
    const roots = (key: string) =>
      new Set(every({ key, before: [key], after: [] }).filter((chord) => !chord.includes("dim")).map((chord) => chord.match(/^[A-G][#b]?/)![0]))
    // Every degree of the key, by the letter it sits on: bVI in G is Eb, bII in Bb is Cb, which players write B.
    expect(roots("G")).toEqual(new Set(["G", "Ab", "A", "Bb", "B", "C", "C#", "D", "Eb", "E", "F", "F#"]))
    expect(roots("Bb")).toEqual(new Set(["Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A"]))
    expect(every({ key: "G", before: ["G", "C"], after: ["Em"] })).toContain("D#dim")
  })

  it("offers nothing without a key it can read", () => {
    expect(suggest({ key: "H", before: [], after: [] })).toEqual({ likely: [], fresh: [] })
  })
})

describe("chartSlot", () => {
  const doc = parseDoc(
    [
      "{start_of_verse: Verse 1}",
      "[G]Here we [D/F#]go",
      "[Em]again",
      "{end_of_verse}",
      "{start_of_chorus}",
      "[C]Sing [G]it",
      "{end_of_chorus}",
      "{start_of_verse: Verse 2}",
      "[G]There we go",
      "[Em]again",
      "{end_of_verse}",
    ].join("\n"),
  )

  it("reads the chords before and after a word, and the chord at the same place in the other verse", () => {
    // Line 8 is Verse 2's first line; column 6 is "we", where Verse 1 has D/F#.
    expect(chartSlot(doc, "G", 8, 6)).toEqual({
      key: "G",
      before: ["G", "D/F#", "Em", "C", "G", "G"],
      after: ["Em"],
      repeat: { chord: "D/F#", section: "Verse 1" },
    })
  })

  it("repeats the other verse only where the two lines' chords agree", () => {
    // Verse 2's line has one chord, G: it matches Verse 1's first word, and has none for "we".
    expect(chartSlot(doc, "G", 1, 0)?.repeat).toEqual({ chord: "G", section: "Verse 2" })
    expect(chartSlot(doc, "G", 1, 5)?.repeat).toBeNull()
  })

  it("leaves out the chord being replaced", () => {
    expect(chartSlot(doc, "G", 5, 0)).toMatchObject({ before: ["G", "D/F#", "Em"], after: ["G", "G", "Em"] })
  })
})
