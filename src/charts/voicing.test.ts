import { describe, expect, test } from "vitest"
import { spell, type Spelling } from "./spelling"
import { fingersNeeded, writeFrets, type Voicing } from "./fretting"
import { STANDARD_TUNING, voicings } from "./voicing"

const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
const SUFFIXES = [
  "", "m", "7", "maj7", "m7", "m7b5", "dim7", "aug", "sus2", "sus4", "7sus4", "5", "6", "m6", "6/9", "9", "m9",
  "maj9", "11", "m11", "13", "m13", "13b9", "7#9", "7b9", "maj7#11", "add9", "madd9", "m7add11", "m(maj7)",
]
/** Every root with every suffix, and each major chord over its 3rd and over its 5th. */
const NAMES = ROOTS.flatMap((root, i) => [
  ...SUFFIXES.map((suffix) => root + suffix),
  `${root}/${ROOTS[(i + 4) % 12]}`,
  `${root}/${ROOTS[(i + 7) % 12]}`,
])

const shapesOf = (name: string) => voicings(spell(name)!).map((shape) => writeFrets(shape.frets))

describe("voicings", () => {
  test("every shape of every chord is playable, checked from its frets alone", () => {
    for (const name of NAMES) {
      const chord = spell(name)!
      const shapes = voicings(chord)
      expect(shapes.length, name).toBeGreaterThan(0)
      expect(shapes.length, name).toBeLessThanOrEqual(8)
      for (const shape of shapes) expect(brokenRule(shape, chord), `${name}: ${writeFrets(shape.frets)}`).toBeNull()
    }
  }, 30_000) // Checks every shape of every chord; under the parallel unit run it takes longer than the 5 s default.

  test("the open shapes every guitarist learns first come first", () => {
    const first = { C: "x 3 2 0 1 0", A: "x 0 2 2 2 0", D: "x x 0 2 3 2", E: "0 2 2 1 0 0", G: "3 2 0 0 0 3",
      Am: "x 0 2 2 1 0", Em: "0 2 2 0 0 0", Dm: "x x 0 2 3 1", F: "1 3 3 2 1 1", C7: "x 3 2 3 1 0",
      E7: "0 2 0 1 0 0", G7: "3 2 0 0 0 1", Am7: "x 0 2 0 1 0", Cmaj7: "x 3 2 0 0 0",
      // A low E fretted at 5 only repeats the open A, so it must not win these.
      A5: "x 0 2 2 x x", A6: "x 0 2 2 2 2" }
    for (const [name, frets] of Object.entries(first)) expect(shapesOf(name)[0], name).toBe(frets)
  })

  test("the common barre shapes are offered", () => {
    expect(shapesOf("Bm")).toContain("x 2 4 4 3 2")
    expect(shapesOf("Bb")).toContain("x 1 3 3 3 1")
    expect(shapesOf("F#m")).toContain("2 4 4 2 2 2")
  })

  test("a shape that is a better one with strings left out is not offered", () => {
    for (const name of ["C", "G", "Bm", "F#m7add11", "D/F#"]) {
      const shapes = voicings(spell(name)!)
      shapes.forEach((shape, i) => {
        const thinner = shapes.slice(0, i).find((better) => shape.frets.every((fret, s) => fret === null || fret === better.frets[s]))
        expect(thinner, `${name}: ${writeFrets(shape.frets)}`).toBeUndefined()
      })
    }
  })

})

/** The first playability rule a shape breaks, or null; each rule is checked from the frets and the tuning. */
function brokenRule({ frets }: Voicing, chord: Spelling): string | null {
  const pitches = frets.flatMap((fret, i) => (fret === null ? [] : [STANDARD_TUNING[i]! + fret]))
  const heard = new Set(pitches.map((pitch) => pitch % 12))
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0)
  const power = chord.optional.length === 0 && chord.required.length === 2
  if (frets.length !== 6) return "one entry per string"
  if (frets.some((fret) => fret !== null && (fret < 0 || fret > 15))) return "frets 0 to 15"
  if ([...heard].some((pc) => !chord.required.includes(pc) && !chord.optional.includes(pc))) return "a note outside the chord"
  if (chord.required.some((pc) => !heard.has(pc))) return "a required note missing"
  if (Math.min(...pitches) % 12 !== chord.bass) return "the bass is not lowest"
  if (pitches.length < (power ? 2 : 3)) return "too few strings"
  if (fretted.length > 0 && Math.max(...fretted) - Math.min(...fretted) > 3) return "a stretch over 4 frets"
  if (fingersNeeded(frets) > 4) return "more than 4 fingers"
  return null
}
