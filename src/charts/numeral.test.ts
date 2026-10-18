import { describe, expect, it } from "bun:test"
import { numeral } from "./numeral"

describe("numeral", () => {
  // Key C major tests
  describe("key C", () => {
    it("C -> I", () => {
      expect(numeral("C", "C")).toBe("I")
    })
    it("G7 -> V7", () => {
      expect(numeral("G7", "C")).toBe("V7")
    })
    it("Am -> vi", () => {
      expect(numeral("Am", "C")).toBe("vi")
    })
    it("Am7 -> vi7", () => {
      expect(numeral("Am7", "C")).toBe("vi7")
    })
    it("Bb -> bVII", () => {
      expect(numeral("Bb", "C")).toBe("bVII")
    })
    it("F#m -> #iv", () => {
      expect(numeral("F#m", "C")).toBe("#iv")
    })
    it("Bdim -> viidim", () => {
      expect(numeral("Bdim", "C")).toBe("viidim")
    })
    it("Fmaj7 -> IVmaj7", () => {
      expect(numeral("Fmaj7", "C")).toBe("IVmaj7")
    })
    it("D/F# -> II (slash bass dropped)", () => {
      expect(numeral("D/F#", "C")).toBe("II")
    })
  })

  // Key A minor tests
  describe("key Am", () => {
    it("Am -> i", () => {
      expect(numeral("Am", "Am")).toBe("i")
    })
    it("E -> V", () => {
      expect(numeral("E", "Am")).toBe("V")
    })
  })

  // Null key returns null
  it("key null -> null", () => {
    expect(numeral("C", null)).toBeNull()
  })

  // Invalid chord returns null
  it('"H" -> null', () => {
    expect(numeral("H", "C")).toBeNull()
  })

  // Additional cases for quality and suffix handling
  describe("quality and suffix handling", () => {
    it("Em -> iii (minor quality, lowercase)", () => {
      expect(numeral("Em", "C")).toBe("iii")
    })
    it("F -> IV (major quality, uppercase)", () => {
      expect(numeral("F", "C")).toBe("IV")
    })
    it("Dm7 -> ii7 (minor with extension)", () => {
      expect(numeral("Dm7", "C")).toBe("ii7")
    })
    it("G9 -> V9 (dominant with extension)", () => {
      expect(numeral("G9", "C")).toBe("V9")
    })
    it("Cmaj7 -> Imaj7 (major 7th suffix kept)", () => {
      expect(numeral("Cmaj7", "C")).toBe("Imaj7")
    })
    it("Bb7 -> bVII7 (flat degree with extension)", () => {
      expect(numeral("Bb7", "C")).toBe("bVII7")
    })
    it("F#m7add11 -> #iv7add11 (complex suffix)", () => {
      expect(numeral("F#m7add11", "C")).toBe("#iv7add11")
    })
    it("Gdim -> vdim (diminished suffix on V)", () => {
      expect(numeral("Gdim", "C")).toBe("vdim")
    })
    it("Gaug -> Vaug (augmented suffix on V)", () => {
      expect(numeral("Gaug", "C")).toBe("Vaug")
    })
    it("Csus4 -> Isus4 (sus suffix)", () => {
      expect(numeral("Csus4", "C")).toBe("Isus4")
    })
    it("Cadd9 -> Iadd9 (add suffix)", () => {
      expect(numeral("Cadd9", "C")).toBe("Iadd9")
    })
  })

  // Borrowed/secondary chords shown by plain degree
  describe("borrowed and secondary chords", () => {
    it("D in key C -> II (V/V shown as plain degree)", () => {
      expect(numeral("D", "C")).toBe("II")
    })
    it("A in key C -> VI (V/ii shown as plain degree)", () => {
      expect(numeral("A", "C")).toBe("VI")
    })
    it("Eb in key C -> bIII (borrowed bIII)", () => {
      expect(numeral("Eb", "C")).toBe("bIII")
    })
  })

  // Sharp/flat root handling
  describe("sharp and flat roots", () => {
    it("F# in key C -> #IV", () => {
      expect(numeral("F#", "C")).toBe("#IV")
    })
    it("Gb in key C -> #IV (six semitones above C, written with a sharp)", () => {
      expect(numeral("Gb", "C")).toBe("#IV")
    })
    it("Bb in key C -> bVII", () => {
      expect(numeral("Bb", "C")).toBe("bVII")
    })
    it("A# in key C -> bVII (ten semitones above C, written with a flat)", () => {
      expect(numeral("A#", "C")).toBe("bVII")
    })
  })

  // Minor key handling
  describe("minor keys", () => {
    it("Dm in key Am -> iv", () => {
      expect(numeral("Dm", "Am")).toBe("iv")
    })
    it("F in key Am -> bVI", () => {
      expect(numeral("F", "Am")).toBe("bVI")
    })
    it("G in key Am -> bVII", () => {
      expect(numeral("G", "Am")).toBe("bVII")
    })
    it("C in key Am -> bIII", () => {
      expect(numeral("C", "Am")).toBe("bIII")
    })
  })
})