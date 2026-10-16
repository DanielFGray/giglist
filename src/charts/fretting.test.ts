import { describe, expect, test } from "bun:test"
import { barreOf, fingersNeeded, fretWindow, writeFrets } from "./fretting"

const openC = [null, 3, 2, 0, 1, 0]
const F = [1, 3, 3, 2, 1, 1]
const Bm = [null, 2, 4, 4, 3, 2]
const A = [null, 0, 2, 2, 2, 0]
const D = [null, null, 0, 2, 3, 2]
const cShape = [null, 3, 5, 5, 5, 3]
const diminished = [null, null, 3, 2, 1, 1]
const shapeAt7 = [null, 7, 9, 9, 8, 7]
const fiveRows = [null, 3, 7, null, null, null]
const openBetween = [3, 0, 3, null, null, null]
const unplayable = [1, 2, 3, 4, 5, null]
const twelfth = [null, 10, 12, 12, 11, 10]

describe("barreOf", () => {
  test("open C needs no barre", () => {
    expect(barreOf(openC)).toBeNull()
  })

  test("a shape of at most four fretted strings fills a hand one string per finger", () => {
    expect(barreOf(D)).toBeNull()
    expect(barreOf(diminished)).toBeNull()
  })

  test("F barres fret 1 from string 0 to 5", () => {
    expect(barreOf(F)).toEqual({ fret: 1, from: 0, to: 5 })
  })

  test("Bm barres fret 2 from string 1 to 5", () => {
    expect(barreOf(Bm)).toEqual({ fret: 2, from: 1, to: 5 })
  })

  test("the C shape at fret 3 barres from string 1 to 5", () => {
    expect(barreOf(cShape)).toEqual({ fret: 3, from: 1, to: 5 })
  })

  test("five fretted strings that fit no barre span have no barre", () => {
    expect(barreOf(unplayable)).toBeNull()
  })

  test("an open string between the barre's ends breaks the barre", () => {
    expect(barreOf(openBetween)).toBeNull()
  })

  test("a shape at fret 7 barres from string 1 to 5", () => {
    expect(barreOf(shapeAt7)).toEqual({ fret: 7, from: 1, to: 5 })
  })
})

describe("fingersNeeded", () => {
  test("open C frets three strings", () => {
    expect(fingersNeeded(openC)).toBe(3)
  })

  test("A frets the three strings at fret 2 separately", () => {
    expect(fingersNeeded(A)).toBe(3)
  })

  test("F frets six strings with one barre and three upper fingers", () => {
    expect(fingersNeeded(F)).toBe(4)
  })

  test("Bm frets five strings with one barre and three upper fingers", () => {
    expect(fingersNeeded(Bm)).toBe(4)
  })

  test("the C shape needs frets 5 on one finger inside the barre", () => {
    expect(fingersNeeded(cShape)).toBe(4)
  })

  test("a shape no hand plays needs five fingers", () => {
    expect(fingersNeeded(unplayable)).toBe(5)
  })

  test("a barre counts once however many strings sound its fret", () => {
    expect(fingersNeeded(twelfth)).toBe(4)
  })
})

describe("fretWindow", () => {
  test("open C shows the nut", () => {
    expect(fretWindow(openC)).toEqual({ first: 1, rows: 4 })
  })

  test("a shape at fret 7 moves the window to fret 7", () => {
    expect(fretWindow(shapeAt7)).toEqual({ first: 7, rows: 4 })
  })

  test("a span of frets 3 to 7 needs 5 rows", () => {
    expect(fretWindow(fiveRows)).toEqual({ first: 3, rows: 5 })
  })
})

describe("writeFrets", () => {
  test("open C reads as it is written", () => {
    expect(writeFrets(openC)).toBe("x 3 2 0 1 0")
  })

  test("double-digit frets stay as digits", () => {
    expect(writeFrets(twelfth)).toBe("x 10 12 12 11 10")
  })
})
