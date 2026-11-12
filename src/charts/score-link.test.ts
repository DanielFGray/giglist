import { describe, expect, it } from "vitest"
import { drawnRange, excerpt, formatScoreLink, readScoreLink, sectionChoices, type ExcerptBar, type ScoreLink, type ScoreOutline } from "./score-link"

const outline: ScoreOutline = {
  tracks: ["Lead Gtr", "Bass"],
  sections: [
    { index: 0, marker: "Verse" },
    { index: 4, marker: "Chorus" },
    { index: 6, marker: "Verse 2" },
  ],
  bars: 8,
}

const bars = (...rows: Array<Partial<ExcerptBar<string>>>): Array<ExcerptBar<string>> =>
  rows.map((row) => ({ isRepeatStart: false, repeatCount: 0, tempoAutomations: [], ...row }))

describe("readScoreLink", () => {
  it("reads a section link", () => {
    expect(readScoreLink(`chart=abc track="Lead Gtr" section="Chorus"`)).toEqual({
      link: { chartId: "abc", track: "Lead Gtr", range: { section: "Chorus" } },
    })
  })

  it("reads a bar range", () => {
    expect(readScoreLink(`chart=abc track="Bass" bars=5-8`)).toEqual({
      link: { chartId: "abc", track: "Bass", range: { from: 5, to: 8 } },
    })
  })

  it("names what is missing or given twice", () => {
    expect(readScoreLink(`track="Bass" bars=5-8`)).toEqual({ problem: "The score link names no chart" })
    expect(readScoreLink(`chart=abc bars=5-8`)).toEqual({ problem: "The score link names no track" })
    expect(readScoreLink(`chart=abc track="Bass"`)).toEqual({ problem: "The score link needs a section or bars, not both" })
    expect(readScoreLink(`chart=abc track="Bass" section="A" bars=1-2`)).toEqual({
      problem: "The score link needs a section or bars, not both",
    })
  })

  it("rejects a bar range that is not a range of bars", () => {
    expect(readScoreLink(`chart=abc track="Bass" bars=5`)).toEqual({ problem: `The bars "5" are not a range such as 5-8` })
    expect(readScoreLink(`chart=abc track="Bass" bars=8-5`)).toEqual({ problem: "The bars 8-5 are not a range of bars" })
    expect(readScoreLink(`chart=abc track="Bass" bars=0-2`)).toEqual({ problem: "The bars 0-2 are not a range of bars" })
  })
})

describe("formatScoreLink", () => {
  it("writes the directive that readScoreLink reads back", () => {
    const section: ScoreLink = { chartId: "abc", track: "Lead Gtr", range: { section: "Chorus" } }
    const bars: ScoreLink = { chartId: "abc", track: "Bass", range: { from: 5, to: 8 } }
    expect(readScoreLink(formatScoreLink(section))).toEqual({ link: section })
    expect(readScoreLink(formatScoreLink(bars))).toEqual({ link: bars })
  })
})

describe("drawnRange", () => {
  const link = (range: ScoreLink["range"], track = "Lead Gtr"): ScoreLink => ({ chartId: "abc", track, range })

  it("runs a section from its marker to the bar before the next marker", () => {
    expect(drawnRange(link({ section: "Verse" }), outline)).toEqual({ track: 0, first: 0, last: 3 })
    expect(drawnRange(link({ section: "Chorus" }), outline)).toEqual({ track: 0, first: 4, last: 5 })
  })

  it("runs the last section to the last bar", () => {
    expect(drawnRange(link({ section: "Verse 2" }), outline)).toEqual({ track: 0, first: 6, last: 7 })
  })

  it("turns bar numbers into 0-based bars and finds the track by its label", () => {
    expect(drawnRange(link({ from: 2, to: 3 }, "Bass"), outline)).toEqual({ track: 1, first: 1, last: 2 })
  })

  it("says what is missing: a track, a section, or bars past the end", () => {
    expect(drawnRange(link({ section: "Chorus" }, "Drums"), outline)).toEqual({ problem: `No track named "Drums" in this score` })
    expect(drawnRange(link({ section: "Bridge" }), outline)).toEqual({ problem: `No section "Bridge" in this score` })
    expect(drawnRange(link({ from: 7, to: 9 }), outline)).toEqual({ problem: "The bars 7-9 run past the score's 8 bars" })
  })
})

describe("sectionChoices", () => {
  it("gives each section its bars and flags a marker that two sections share", () => {
    const shared: ScoreOutline = { tracks: ["Lead Gtr"], sections: [{ index: 0, marker: "Verse" }, { index: 4, marker: "Chorus" }, { index: 6, marker: "Verse" }], bars: 8 }
    expect(sectionChoices(shared)).toEqual([
      { marker: "Verse", first: 0, last: 3, repeated: true },
      { marker: "Chorus", first: 4, last: 5, repeated: false },
      { marker: "Verse", first: 6, last: 7, repeated: true },
    ])
  })
})

describe("excerpt", () => {
  it("clears a close whose open lies before the excerpt", () => {
    const b = bars({}, {}, { isRepeatStart: true }, {}, { repeatCount: 2 }, {})
    excerpt(b, 3, 5)
    expect(b[4]!.repeatCount).toBe(0)
    expect(b[2]!.isRepeatStart).toBe(true)
  })

  it("clears an open whose close lies after the excerpt", () => {
    const b = bars({}, {}, { isRepeatStart: true }, {}, { repeatCount: 2 }, {})
    excerpt(b, 1, 3)
    expect(b[2]!.isRepeatStart).toBe(false)
    expect(b[4]!.repeatCount).toBe(2)
  })

  it("keeps a repeat that lies wholly inside the excerpt", () => {
    const b = bars({}, { isRepeatStart: true }, {}, { repeatCount: 2 }, {})
    excerpt(b, 1, 3)
    expect(b[1]!.isRepeatStart).toBe(true)
    expect(b[3]!.repeatCount).toBe(2)
  })

  it("writes the tempo in effect at the first bar onto it", () => {
    const b = bars({ tempoAutomations: ["100"] }, { tempoAutomations: ["140"] }, {}, {})
    excerpt(b, 2, 3)
    expect(b[2]!.tempoAutomations).toEqual(["140"])
  })

  it("keeps a tempo the first bar already states", () => {
    const b = bars({ tempoAutomations: ["100"] }, { tempoAutomations: ["140"] })
    excerpt(b, 1, 1)
    expect(b[1]!.tempoAutomations).toEqual(["140"])
  })
})
