import { describe, expect, it } from "vitest"
import { chordNumerals, numeral } from "./numeral"

// Expected labels were checked against music21's romanNumeralFromChord. It agrees
// on every row except where a comment gives the app's own rule.
const cases: ReadonlyArray<[chord: string, key: string, next: string | null, expected: string]> = [
  // Degree, case and quality
  ["C", "C", null, "I"],
  ["Am7", "C", null, "vi7"],
  ["Fmaj7", "C", null, "IVmaj7"], // music21: IV7. The app keeps maj7 apart from a dominant 7th.
  ["G9", "C", null, "V9"],
  ["Csus4", "C", null, "Isus4"],
  ["Cmadd9", "C", null, "iadd9"],
  ["C-7", "C", null, "i7"],
  ["Bdim", "C", null, "vii°"],
  ["Bdim7", "C", null, "vii°7"],
  ["Bm7b5", "C", null, "viiø7"],
  ["Gaug", "C", null, "V+"],
  ["F#m7add11", "C", null, "#iv7add11"],
  ["Gb", "C", null, "#IV"],
  ["A#", "C", null, "bVII"],
  // Minor keys count from the tonic against the major scale, as the rock corpus does.
  ["E", "Am", null, "V"],
  ["C", "Am", null, "bIII"], // music21: III
  ["G", "Am", null, "bVII"],
  // Inversions
  ["D/F#", "G", null, "V6"],
  ["D/A", "G", null, "V64"],
  ["G7/B", "C", null, "V65"],
  ["G7/D", "C", null, "V43"],
  ["G7/F", "C", null, "V42"],
  ["Dm7/C", "C", null, "ii42"],
  ["Cmaj7/E", "C", null, "Imaj65"],
  // A bass that is not a chord tone reads as its key degree. music21: Iadd9 is I763, F/G is IV742, Am/G is vi42.
  ["Cadd9/E", "C", null, "Iadd9/3"],
  ["F/G", "C", null, "IV/5"],
  ["Am/G", "C", null, "vi/5"],
  // Applied chords need the resolution. music21 reads every chromatic dominant as applied, even with no next chord.
  ["A7", "G", "D", "V7/V"],
  ["A7", "G", "C", "II7"],
  ["E", "C", "F", "III"],
  ["E7", "C", "Am", "V7/vi"],
  ["C7", "C", "F", "V7/IV"],
  ["D7/F#", "C", "G", "V65/V"],
  ["D7/F#", "G", "G", "V65"],
  ["A", "Am", "Dm", "V/iv"],
  ["B7", "Am", "E", "V7/V"], // music21: V7/v
  ["E7", "Am", "Am", "V7"],
  ["C#dim7", "C", "Dm", "vii°7/ii"], // music21: #io7
  ["F#m7b5", "C", "G", "viiø7/V"],
  // A chain of dominants counts each by its target's root.
  ["A7", "C", "D7", "V7/ii"],
  ["D7", "C", "G7", "V7/V"],
  // The cadential 6-4 works as V.
  ["F#dim7", "C", "C/G", "vii°7/V"],
  // A borrowed chord moving to another borrowed chord is not applied.
  ["Eb", "C", "Ab", "bIII"],
  ["Bb7", "C", "Eb", "bVII7"],
]

describe("numeral", () => {
  it.each(cases)("%s in %s before %s reads %s", (chord, key, next, expected) => {
    expect(numeral(chord, key, next)).toBe(expected)
  })

  it("is null without a key, or for a name it cannot read", () => {
    expect(numeral("C", null)).toBeNull()
    expect(numeral("H", "C")).toBeNull()
    expect(numeral("N.C.", "C")).toBeNull()
  })
})

describe("chordNumerals", () => {
  it("reads each chord against the next chord with another name", () => {
    expect(chordNumerals(["A7", "A7", "D", "G", "E7", "Am"], "G")).toEqual(["V7/V", "V7/V", "V", "I", "V7/ii", "ii"])
  })
})
