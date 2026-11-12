import { describe, expect, test } from "vitest"
import { readPhrase } from "./phrase"

describe("readPhrase", () => {
  test("reads a tab lick, a melody and a drum groove", () => {
    for (const tex of [
      ":8 0.5 2.5 4.4 2.5 | 0.5",
      ":8 G4 A4 B4 D5",
      "\\articulation K 36 \\articulation S 38 \\articulation H 42 \\instrument percussion :8 (K H) H (S H) H",
    ]) {
      expect("score" in readPhrase(tex, null)).toBe(true)
    }
  })

  test("starts at the song's tempo, over the phrase's own", () => {
    const tempoOf = (tex: string, tempo: number | null) => {
      const read = readPhrase(tex, tempo)
      if (!("score" in read)) throw new Error("not read")
      return [read.score.tempo, read.score.masterBars[0]!.tempoAutomations[0]!.value]
    }
    expect(tempoOf(":4 0.5 2.5", null)).toEqual([120, 120])
    expect(tempoOf("\\tempo 90 . :4 0.5 2.5", null)).toEqual([90, 90])
    expect(tempoOf(":4 0.5 2.5", 132)).toEqual([132, 132])
    expect(tempoOf("\\tempo 90 . :4 0.5 2.5", 132)).toEqual([132, 132])
  })

  test("says where alphaTab stopped reading", () => {
    expect(readPhrase(":8 0.5\n2.5 zz.qq", null)).toEqual({
      problems: [{ line: 2, column: 8, message: "Unexpected 'Ident' token. Expected one of following: Number" }],
    })
  })
})
