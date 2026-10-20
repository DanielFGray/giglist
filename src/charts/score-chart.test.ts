import { describe, expect, it } from "bun:test"
import { exporter, importer, Settings } from "@coderline/alphatab"
import { chartFromScore } from "./score-chart"

/** The score as a player's upload gives it: alphaTex written as a Guitar Pro 7 file and read back. */
function upload(tex: string) {
  const reader = new importer.AlphaTexImporter()
  reader.initFromString(tex, new Settings())
  const bytes = new exporter.Gp7Exporter().export(reader.readScore(), new Settings())
  return importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings())
}

describe("chartFromScore", () => {
  it("puts the author's chords from one track over the syllables of another, through a repeat", () => {
    const chart = chartFromScore(
      upload(`
        \\title "Round Trip"
        .
        \\track "Vocals"
        \\lyrics 2 "Hel-lo old friend how are you sing it loud now"
        \\lyrics 2 "Good-bye old friend fare thee well"
        \\section "Intro" r.1 | r.1 |
        \\section "Verse" \\ro 0.3.4 0.3.4 0.3.4 0.3.4 | \\rc 2 0.3.4 0.3.4 0.3.4 r.4 |
        \\section "Chorus" 0.3.4 0.3.4 0.3.4 0.3.4 |
        \\track "Guitar"
        \\chord "G" 3 3 0 0 2 3
        \\chord "C" 0 1 0 2 3 x
        \\chord "D" 2 3 2 0 x x
        \\chord "Em" 0 0 0 2 2 0
        3.6.2 {ch "G"} 3.6.2 | 3.5.2 {ch "C"} 3.5.2 |
        3.6.2 {ch "G"} 0.4.2 {ch "D"} | 3.5.1 {ch "C"} |
        0.6.2 {ch "Em"} 3.5.2 {ch "C"} |
      `),
    )
    expect(chart).toEqual({
      text: [
        "[Intro]",
        "G       C",
        "[Verse]",
        "G     D          C",
        "Hello old friend how are you",
        "[Verse]",
        "G       D          C",
        "Goodbye old friend fare thee well",
        "[Chorus]",
        "Em      C",
        "sing it loud now",
      ].join("\n"),
      key: "G",
      inferred: false,
      sung: true,
    })
  })

  it("gives no syllable to a note tied over, as Guitar Pro does, so a chord lands on the held word", () => {
    const chart = chartFromScore(
      upload(`
        .
        \\track "Vocals"
        \\lyrics "one two three four"
        0.3.2 0.3.2 | -.3.2 0.3.4 0.3.4 |
        \\track "Guitar"
        \\chord "G" 3 3 0 0 2 3
        \\chord "C" 0 1 0 2 3 x
        3.6.1 {ch "G"} | 3.5.1 {ch "C"} |
      `),
    )
    expect(chart?.text).toBe("G   C\none two three four")
  })

  it("works out the chords from the notes when the author named none", () => {
    const chart = chartFromScore(
      upload(`
        .
        \\track "Vocals"
        \\lyrics "A-ma-zing grace how sweet the sound"
        r.4 0.3.4 0.3.4 0.3.4 | 0.3.2 0.3.2 | 0.3.2 0.3.2 | 0.3.1 |
        \\track "Guitar"
        (3.6 2.5 0.4 0.3 0.2 3.1).1 | (3.5 2.4 0.3 1.2 0.1).1 | (5.5 4.4 2.3 3.2 2.1).1 | (3.6 2.5 0.4 0.3 0.2 3.1).1 |
      `),
    )
    expect(chart).toEqual({
      text: ["G       C         D         G", "Amazing grace how sweet the sound"].join("\n"),
      key: "G",
      inferred: true,
      sung: true,
    })
  })

  it("spells worked-out chords in the key they suggest", () => {
    const chart = chartFromScore(
      upload(`
        .
        \\track "Guitar"
        (4.6 6.5 6.4).1 | (4.5 6.4 6.3).1 | (6.5 8.4 8.3).1 | (4.6 6.5 6.4).1 |
      `),
    )
    expect(chart?.key).toBe("Ab")
    expect(chart?.sung).toBe(false)
    expect(chart?.text).toBe("Ab5     Db5     Eb5     Ab5")
  })

  it("is null for a score with no chords and no lyrics", () => {
    expect(chartFromScore(upload(`. \\track "Guitar" r.1 | r.1 |`))).toBeNull()
  })
})
