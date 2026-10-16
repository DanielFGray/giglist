import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { ChordLyricsPair, ChordProParser, Tag } from "chordsheetjs"
import { composeChanges, explains, type Change } from "./changes"
import {
  anchorText, deleteLine, editLyrics, insertLineAfter, moveChord, parseDoc, placeChord, removeChord,
  renameSection, segments, serializeDoc, type ChartDoc, type Edit,
} from "./doc"
import { importPasted } from "./lyrics"

const fixture = readFileSync(new URL("../../tests/fixtures/amazing-grace.txt", import.meta.url), "utf8")
const source = importPasted(fixture, "G")
const doc = parseDoc(source)

/** The anchor text as ChordSheetJS reads it: what the app derived from a parsed song before the editor existed. */
const anchorFromSong = (text: string) => {
  const song = new ChordProParser().parse(text)
  return song.lines
    .map((line) =>
      line.items
        .map((item) => {
          if (item instanceof ChordLyricsPair) return (item.chords.trim() ? `[${item.chords.trim()}]` : "") + (item.lyrics ?? "")
          if (item instanceof Tag && item.isSectionStart()) return item.label || item.value
          if (item instanceof Tag && item.isComment()) return item.value
          return ""
        })
        .join(""),
    )
    .join("\n")
}

const lineOf = (text: string) => doc.findIndex((l) => l.kind === "lyrics" && l.text.startsWith(text))

/** An edit is exact when the text outside its changes is the same before and after. */
const expectExact = (before: ChartDoc, edit: Edit) => {
  expect(explains(anchorText(before), anchorText(edit.doc), edit.changes)).toBe(true)
}

describe("the chart as text", () => {
  test("serializing what was parsed gives the stored text back", () => {
    expect(serializeDoc(doc)).toBe(source)
  })

  test("the anchor text equals the one derived through ChordSheetJS", () => {
    expect(anchorText(doc)).toBe(anchorFromSong(source))
  })

  test("a chord at the end of a line and a chord-only line keep their place", () => {
    const text = "{key: G}\nHello[C]\n   [G]  [D]"
    expect(serializeDoc(parseDoc(text))).toBe(text)
    expect(anchorText(parseDoc(text))).toBe(anchorFromSong(text))
  })
})

describe("edits", () => {
  const i = lineOf("Amazing")

  test("placing a chord on a bare word inserts it", () => {
    const edit = placeChord(doc, i, 8, "Am")
    expect(serializeDoc(edit.doc).split("\n")[i]).toBe("[G]Amazing [Am]grace, how[C] sweet the[G] sound")
    expectExact(doc, edit)
  })

  test("placing a chord on a chorded word replaces it", () => {
    const edit = placeChord(doc, i, 0, "D")
    expect(serializeDoc(edit.doc).split("\n")[i]).toStartWith("[D]Amazing")
    expect(edit.changes).toHaveLength(1)
    expectExact(doc, edit)
  })

  test("placing the same chord changes nothing", () => {
    expect(placeChord(doc, i, 0, "G").changes).toEqual([])
  })

  test("removing a chord deletes only its brackets and name", () => {
    const edit = removeChord(doc, i, 1)
    expect(serializeDoc(edit.doc).split("\n")[i]).toBe("[G]Amazing grace, how sweet the[G] sound")
    expectExact(doc, edit)
  })

  test("moving a chord to another line is exact", () => {
    const edit = moveChord(doc, { line: i, chord: 1 }, { line: lineOf("That saved"), at: 5 })
    expect(edit.changes).toHaveLength(2)
    expectExact(doc, edit)
    expect(serializeDoc(edit.doc)).toContain("That [C]saved")
  })

  test("moving a chord later on the same line is exact", () => {
    const edit = moveChord(doc, { line: i, chord: 0 }, { line: i, at: 26 })
    expectExact(doc, edit)
  })

  test("editing lyrics keeps chords on the words around the edit", () => {
    const edit = editLyrics(doc, i, "Amazing grace, how very sweet the sound")
    const line = edit.doc[i]!
    expect(line.kind === "lyrics" && line.chords.map((c) => `${c.at}${c.chord}`)).toEqual(["0G", "18C", "33G"])
    expectExact(doc, edit)
  })

  test("editing lyrics before a chord moves the chord with its word", () => {
    const edit = editLyrics(doc, i, "Oh Amazing grace, how sweet the sound")
    const line = edit.doc[i]!
    expect(line.kind === "lyrics" && line.chords.map((c) => c.at)).toEqual([3, 21, 31])
    expectExact(doc, edit)
  })

  test("renaming a section changes only the label", () => {
    const edit = renameSection(doc, 1, "Verse One")
    expect(anchorText(edit.doc).split("\n")[1]).toBe("Verse One")
    expectExact(doc, edit)
  })

  test("inserting and deleting a line are exact, including at the end", () => {
    expectExact(doc, insertLineAfter(doc, i))
    expectExact(doc, insertLineAfter(doc, doc.length - 1))
    expectExact(doc, deleteLine(doc, i))
    const last = doc.length - 1
    expect(doc[last]!.kind).toBe("directive")
    const withTail = insertLineAfter(doc, last).doc
    expectExact(withTail, deleteLine(withTail, last + 1))
  })

  test("a run of edits composes into one exact change set", () => {
    let current: ChartDoc = doc
    let changes: Array<Change> = []
    for (const step of [
      (d: ChartDoc) => placeChord(d, i, 8, "Am"),
      (d: ChartDoc) => moveChord(d, { line: i, chord: 0 }, { line: i, at: 15 }),
      (d: ChartDoc) => editLyrics(d, i, "Amazing grace, how sweet the sound!"),
      (d: ChartDoc) => renameSection(d, 1, "Verse"),
    ]) {
      const edit = step(current)
      changes = composeChanges(changes, edit.changes)
      current = edit.doc
    }
    expectExact(doc, { doc: current, changes })
  })
})

describe("segments", () => {
  test("splits a line into words, and further at a chord inside a word", () => {
    const line = parseDoc("Hel[C]lo wor[D]ld")[0]!
    if (line.kind !== "lyrics") throw new Error("expected a lyric line")
    expect(segments(line).map((s) => `${s.start}-${s.end}`)).toEqual(["0-3", "3-6", "6-9", "9-11"])
    expect(segments(line).map((s) => s.chords)).toEqual([[], [0], [], [1]])
  })

  test("a chord at the end of the line has a segment of its own", () => {
    const line = parseDoc("Hello[C]")[0]!
    if (line.kind !== "lyrics") throw new Error("expected a lyric line")
    expect(segments(line).map((s) => s.chords)).toEqual([[], [0]])
  })
})
