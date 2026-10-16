import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { anchorText, parseDoc } from "./doc"
import { importPasted, renderLyrics, suggestedChords, type ChartItem } from "./lyrics"

const pasted = readFileSync(new URL("../../tests/fixtures/amazing-grace.txt", import.meta.url), "utf8")

const pairs = (key?: string) =>
  renderLyrics(importPasted(pasted, "G"), key).flatMap((line) => line.filter((i): i is Extract<ChartItem, { kind: "pair" }> => i.kind === "pair"))

const CHORD = /^[A-G][#b]?(m|maj|min|dim|aug|sus)?\d*(\/[A-G][#b]?)?$/

describe("importPasted", () => {
  test("keeps every lyric line exactly", () => {
    const lyrics = pasted.split("\n").filter((l) => l.trim() && !l.startsWith("[") && !/^[A-G][A-Za-z0-9#/ ]*$/.test(l.trim()))
    const shown = renderLyrics(importPasted(pasted, "G")).map((line) => line.map((i) => (i.kind === "pair" ? i.lyric : "")).join(""))
    for (const l of lyrics) expect(shown).toContain(l.trimEnd())
  })

  test("puts each chord at the column it was typed", () => {
    const line = renderLyrics(importPasted(pasted, "G"))
      .map((l) => l.filter((i): i is Extract<ChartItem, { kind: "pair" }> => i.kind === "pair"))
      .find((l) => l.some((p) => p.lyric.startsWith("Amazing")))!
    const columnOf = (chord: string) => line.slice(0, line.findIndex((p) => p.chord === chord)).reduce((n, p) => n + p.lyric.length, 0)
    // "G" and "C" were typed at columns 0 and 18 of the first line in the fixture.
    expect(columnOf("G")).toBe(0)
    expect(columnOf("C")).toBe(18)
  })

  test("puts every chord of every line at the column it was typed", () => {
    const rows = pasted.split("\n")
    const shownLines = renderLyrics(importPasted(pasted, "G")).map((line) =>
      line.filter((i): i is Extract<ChartItem, { kind: "pair" }> => i.kind === "pair"),
    )
    const byLyric = new Map(shownLines.map((l) => [l.map((p) => p.lyric).join("").trimEnd(), l]))
    let checked = 0
    rows.forEach((row, index) => {
      const lyric = rows[index + 1]
      const isChordLine = row.trim() !== "" && row.trim().split(/\s+/).every((t) => CHORD.test(t))
      if (!isChordLine || lyric === undefined) return
      const line = byLyric.get(lyric.trimEnd())!
      expect(line).toBeDefined()
      const typed = [...row.matchAll(/\S+/g)].map((m) => ({ chord: m[0], column: m.index! }))
      const shown = line.flatMap((p, i) => (p.chord ? [{ chord: p.chord, column: line.slice(0, i).reduce((n, q) => n + q.lyric.length, 0) }] : []))
      expect(shown).toEqual(typed)
      checked += typed.length
    })
    expect(checked).toBeGreaterThan(10)
  })

  test("turns headers into sections", () => {
    const labels = renderLyrics(importPasted(pasted, "G")).flat().filter((i) => i.kind === "section").map((i) => (i as { label: string }).label)
    expect(labels).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus"])
  })

  test("escapes ChordPro syntax in lyrics", () => {
    expect(importPasted("G\nHello [world]", "G")).toContain("Hello (world)")
  })
})

describe("renderLyrics", () => {
  test("transposes every chord by the interval between keys", () => {
    const chords = (key?: string) => [...new Set(pairs(key).map((p) => p.chord).filter(Boolean))].sort()
    expect(chords()).toEqual(["C", "D", "Em", "G"])
    expect(chords("A")).toEqual(["A", "D", "E", "F#m"])
  })

  test("leaves lyrics alone when transposing", () => {
    expect(pairs("D").map((p) => p.lyric)).toEqual(pairs().map((p) => p.lyric))
  })

  test("a chart with no written key is shown as written", () => {
    const source = importPasted("G\nHello", null)
    expect(renderLyrics(source, "A")).toEqual(renderLyrics(source))
  })
})

describe("suggestedChords", () => {
  test("spells the chords of the key's scale", () => {
    expect(suggestedChords("G")).toEqual(["G", "Am", "Bm", "C", "D", "D7", "Em"])
    expect(suggestedChords("Bb")).toEqual(["Bb", "Cm", "Dm", "Eb", "F", "F7", "Gm"])
    expect(suggestedChords("Em")).toEqual(["Em", "G", "Am", "B", "B7", "C", "D"])
  })
})

describe("item ranges", () => {
  const source = importPasted(pasted, "G")
  const anchor = anchorText(parseDoc(source))

  test("each item's range holds its chord and words in the anchor text", () => {
    for (const item of renderLyrics(source).flat()) {
      const text = anchor.slice(item.start, item.end)
      if (item.kind === "pair") expect(text).toBe((item.chord ? `[${item.chord}]` : "") + item.lyric)
      if (item.kind === "section") expect(text).toBe(item.label)
    }
  })

  test("ranges do not change when the chart is shown in another key", () => {
    const ranges = (key?: string) => renderLyrics(source, key).flat().map((i) => [i.start, i.end])
    expect(ranges("Bb")).toEqual(ranges())
  })
})
