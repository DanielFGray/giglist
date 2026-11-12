import { describe, expect, test } from "vitest"
import { keyRange, pianoNotes } from "./piano"
import { spell } from "./spelling"

const notesOf = (name: string) => pianoNotes(spell(name)!).map((n) => `${n.name}:${n.degree}`)

describe("pianoNotes", () => {
  test("a triad is root, 3rd and 5th, lowest first", () => {
    expect(notesOf("C")).toEqual(["C:R", "E:3", "G:5"])
    expect(notesOf("Am")).toEqual(["A:R", "C:b3", "E:5"])
  })

  test("notes keep the spelling the chord's name gives them", () => {
    expect(notesOf("Eb7")).toEqual(["Eb:R", "G:3", "Bb:5", "Db:b7"])
    expect(notesOf("F#m")).toEqual(["F#:R", "A:b3", "C#:5"])
  })

  test("a slash bass sounds below the chord, named by the degree it is", () => {
    expect(notesOf("G7/B")).toEqual(["B:3", "G:R", "B:3", "D:5", "F:b7"])
  })

  test("a bass the chord does not name has no degree", () => {
    expect(notesOf("C/D")[0]).toBe("D:null")
  })

  test("extensions sit above the octave", () => {
    const pitches = pianoNotes(spell("Cmaj9")!).map((n) => n.pitch)
    expect(pitches).toEqual([60, 64, 67, 71, 74])
  })
})

describe("keyRange", () => {
  test("ends on white keys one white key beyond the notes", () => {
    expect(keyRange([60, 64, 67])).toEqual({ low: 59, high: 69 })
  })

  test("a black key at either end widens to its neighbours", () => {
    expect(keyRange([61, 70])).toEqual({ low: 59, high: 72 })
  })
})
