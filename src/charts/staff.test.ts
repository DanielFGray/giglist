import { describe, expect, test } from "vitest"
import { spell } from "./spelling"
import { staffNotes, staffSides, staffStep, type StaffNote } from "./staff"

function notes(name: string): ReadonlyArray<StaffNote> {
  const spelled = spell(name)
  if (spelled === null) throw new Error(`${name} does not spell`)
  return staffNotes(spelled)
}

function sides(name: string): ReadonlyArray<"left" | "right" | "center"> {
  return staffSides(notes(name).map(staffStep))
}

describe("staffNotes", () => {
  test("C gives C4 E4 G4 with no accidentals", () => {
    expect(notes("C")).toEqual([
      { letter: "C", accidental: 0, octave: 4, degree: 1 },
      { letter: "E", accidental: 0, octave: 4, degree: 3 },
      { letter: "G", accidental: 0, octave: 4, degree: 5 },
    ])
  })

  test("Ebm7 gives Eb4 Gb4 Bb4 Db5", () => {
    expect(notes("Ebm7")).toEqual([
      { letter: "E", accidental: -1, octave: 4, degree: 1 },
      { letter: "G", accidental: -1, octave: 4, degree: 3 },
      { letter: "B", accidental: -1, octave: 4, degree: 5 },
      { letter: "D", accidental: -1, octave: 5, degree: 7 },
    ])
  })

  test("F#7 gives F#4 A#4 C#5 E5", () => {
    expect(notes("F#7")).toEqual([
      { letter: "F", accidental: 1, octave: 4, degree: 1 },
      { letter: "A", accidental: 1, octave: 4, degree: 3 },
      { letter: "C", accidental: 1, octave: 5, degree: 5 },
      { letter: "E", accidental: 0, octave: 5, degree: 7 },
    ])
  })

  test("Cdim7 gives C4 Eb4 Gb4 Bbb4", () => {
    expect(notes("Cdim7")).toEqual([
      { letter: "C", accidental: 0, octave: 4, degree: 1 },
      { letter: "E", accidental: -1, octave: 4, degree: 3 },
      { letter: "G", accidental: -1, octave: 4, degree: 5 },
      { letter: "B", accidental: -2, octave: 4, degree: 7 },
    ])
  })

  test("D/F# gives F#3 under D4 F#4 A4", () => {
    expect(notes("D/F#")).toEqual([
      { letter: "F", accidental: 1, octave: 3, degree: 3 },
      { letter: "D", accidental: 0, octave: 4, degree: 1 },
      { letter: "F", accidental: 1, octave: 4, degree: 3 },
      { letter: "A", accidental: 0, octave: 4, degree: 5 },
    ])
  })

  test("C9 gives D5 above Bb4", () => {
    expect(notes("C9")).toEqual([
      { letter: "C", accidental: 0, octave: 4, degree: 1 },
      { letter: "E", accidental: 0, octave: 4, degree: 3 },
      { letter: "G", accidental: 0, octave: 4, degree: 5 },
      { letter: "B", accidental: -1, octave: 4, degree: 7 },
      { letter: "D", accidental: 0, octave: 5, degree: 9 },
    ])
  })

  test("D/B# gives B#3 under D4", () => {
    expect(notes("D/B#")).toEqual([
      { letter: "B", accidental: 1, octave: 3, degree: null },
      { letter: "D", accidental: 0, octave: 4, degree: 1 },
      { letter: "F", accidental: 1, octave: 4, degree: 3 },
      { letter: "A", accidental: 0, octave: 4, degree: 5 },
    ])
  })

  test("Cb/D gives D3 under Cb4", () => {
    expect(notes("Cb/D")).toEqual([
      { letter: "D", accidental: 0, octave: 3, degree: null },
      { letter: "C", accidental: -1, octave: 4, degree: 1 },
      { letter: "E", accidental: -1, octave: 4, degree: 3 },
      { letter: "G", accidental: -1, octave: 4, degree: 5 },
    ])
  })

  test("Cbdim7's seventh is B triple flat", () => {
    expect(notes("Cbdim7")).toEqual([
      { letter: "C", accidental: -1, octave: 4, degree: 1 },
      { letter: "E", accidental: -2, octave: 4, degree: 3 },
      { letter: "G", accidental: -2, octave: 4, degree: 5 },
      { letter: "B", accidental: -3, octave: 4, degree: 7 },
    ])
  })

  test("Csus2 gives left, right, center", () => {
    expect(sides("Csus2")).toEqual(["left", "right", "center"])
  })

  test("Cadd2 gives left, right, left, center", () => {
    expect(sides("Cadd2")).toEqual(["left", "right", "left", "center"])
  })

  test("C gives center, center, center", () => {
    expect(sides("C")).toEqual(["center", "center", "center"])
  })
})
