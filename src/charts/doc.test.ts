import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { ChordLyricsPair, ChordProParser, Literal, Tag } from "chordsheetjs"
import { composeChanges, explains, type Change } from "./changes"
import {
  addPhrase, addSection, inPhrase, moveSection, phraseAt, removeSection, setPhrase,
  anchorText, deleteLine, editLine, insertLineAfter, moveChord, parseDoc, placeChord, removeChord,
  renameSection, segments, serializeDoc, type ChartDoc, type DocLine, type Edit,
} from "./doc"
import { follow } from "./follow"
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
          if (item instanceof Literal) return item.string
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
    const edit = editLine(doc, i, "Amazing grace, how very sweet the sound")
    const line = edit.doc[i]!
    expect(line.kind === "lyrics" && line.chords.map((c) => `${c.at}${c.chord}`)).toEqual(["0G", "18C", "33G"])
    expectExact(doc, edit)
  })

  test("editing lyrics before a chord moves the chord with its word", () => {
    const edit = editLine(doc, i, "Oh Amazing grace, how sweet the sound")
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
      (d: ChartDoc) => editLine(d, i, "Amazing grace, how sweet the sound!"),
      (d: ChartDoc) => renameSection(d, 1, "Verse"),
    ]) {
      const edit = step(current)
      changes = composeChanges(changes, edit.changes)
      current = edit.doc
    }
    expectExact(doc, { doc: current, changes })
  })
})

describe("sections", () => {
  const labels = (d: ChartDoc) => d.flatMap((l) => (l.kind === "directive" && l.raw.startsWith('{start_of_') ? [anchorText([l])] : []))
  /** A section edit keeps the stored text valid ChordPro with the anchor text the editor computed. */
  const expectValid = (before: ChartDoc, edit: Edit) => {
    expectExact(before, edit)
    expect(anchorText(parseDoc(serializeDoc(edit.doc)))).toBe(anchorText(edit.doc))
    expect(anchorText(edit.doc)).toBe(anchorFromSong(serializeDoc(edit.doc)))
  }
  const starts = doc.flatMap((l, i) => (l.kind === "directive" && l.raw.startsWith('{start_of_') ? [i] : []))

  test("starting a section inside one splits it into two of the same kind", () => {
    const edit = addSection(doc, lineOf("Was blind"), "Bridge")
    expectValid(doc, edit)
    expect(labels(edit.doc)).toEqual(["Verse 1", "Bridge", "Chorus", "Verse 2", "Chorus"])
    const text = serializeDoc(edit.doc).split("\n")
    const at = text.indexOf("{start_of_verse: Bridge}")
    expect(text[at - 1]).toBe("{end_of_verse}")
    // The original end line now closes the new half.
    expect(text.slice(at, at + 3)).toEqual(["{start_of_verse: Bridge}", expect.stringContaining("Was blin"), ""])
  })

  test("starting a section outside any opens a verse and closes it before the next directive", () => {
    const bare = parseDoc("{key: G}\nFirst line\nSecond line\n{start_of_chorus: Chorus}\nLa\n{end_of_chorus}")
    const edit = addSection(bare, 1, "Intro")
    expectValid(bare, edit)
    expect(serializeDoc(edit.doc)).toBe(
      "{key: G}\n{start_of_verse: Intro}\nFirst line\nSecond line\n{end_of_verse}\n{start_of_chorus: Chorus}\nLa\n{end_of_chorus}",
    )
    const tail = parseDoc("Only line")
    const atEnd = addSection(tail, 0, "Solo")
    expectValid(tail, atEnd)
    expect(serializeDoc(atEnd.doc)).toBe("{start_of_verse: Solo}\nOnly line\n{end_of_verse}")
  })

  test("removing a section drops its start and end lines and keeps its words", () => {
    const edit = removeSection(doc, starts[1]!)
    expectValid(doc, edit)
    expect(labels(edit.doc)).toEqual(["Verse 1", "Verse 2", "Chorus"])
    expect(serializeDoc(edit.doc)).toContain("My chains")
    expect(serializeDoc(edit.doc).match(/\{end_of_chorus\}/g)).toHaveLength(1)
  })

  test("moving a section down or up swaps it with its neighbour", () => {
    const down = moveSection(doc, starts[0]!, 1)
    expectValid(doc, down)
    expect(labels(down.doc)).toEqual(["Chorus", "Verse 1", "Verse 2", "Chorus"])
    const up = moveSection(doc, starts[2]!, -1)
    expectValid(doc, up)
    expect(labels(up.doc)).toEqual(["Verse 1", "Verse 2", "Chorus", "Chorus"])
    // Moving down then up again restores the stored text.
    const back = moveSection(down.doc, starts[0]! + sectionLength(doc, starts[1]!), -1)
    expect(serializeDoc(back.doc)).toBe(serializeDoc(doc))
  })

  test("a section at the end of the list does not move further, and a run composes exactly", () => {
    expect(moveSection(doc, starts[3]!, 1)).toEqual({ doc, changes: [] })
    expect(moveSection(doc, starts[0]!, -1)).toEqual({ doc, changes: [] })
    const a = addSection(doc, lineOf("Was blind"), "Bridge")
    const b = moveSection(a.doc, a.doc.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_verse: Bridge}"), 1)
    expectExact(doc, { doc: b.doc, changes: composeChanges(a.changes, b.changes) })
  })

  test("a mark in the neighbouring section follows a move; a mark inside the moved one is orphaned", () => {
    const before = anchorText(doc)
    const edit = moveSection(doc, starts[0]!, 1)
    const step = { before, after: anchorText(edit.doc), recorded: edit.changes }
    const chorus = before.indexOf("My God, my Savior")
    const kept = follow({ start: chorus, end: chorus + 17 }, [step])
    expect(kept.state).toBe("kept")
    if (kept.state !== "orphaned") expect(step.after.slice(kept.start, kept.end)).toBe("My God, my Savior")
    const verse = before.indexOf("That saved a wretch")
    expect(follow({ start: verse, end: verse + 19 }, [step])).toEqual({ state: "orphaned", reason: "deleted" })
  })
})

/** Number of lines from a section's start to its end line, inclusive. */
function sectionLength(d: ChartDoc, start: number): number {
  let end = start
  const isEnd = (line: DocLine) => line.kind === "directive" && line.raw.startsWith("{end_of_")
  while (!isEnd(d[end]!)) end++
  return end - start + 1
}

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

describe("tab", () => {
  const riff = importPasted(readFileSync(new URL("../../tests/fixtures/riff-and-solo.txt", import.meta.url), "utf8"), "G")
  const tabDoc = parseDoc(riff)
  const tabLine = (prefix: string) => tabDoc.findIndex((l) => l.kind === "literal" && l.text.startsWith(prefix))

  test("lines inside a tab section are tab, kept as written, and their anchor text matches ChordSheetJS", () => {
    expect(serializeDoc(tabDoc)).toBe(riff)
    expect(anchorText(tabDoc)).toBe(anchorFromSong(riff))
    expect(tabDoc[tabLine("e|-----3--5/7")]).toEqual({ kind: "literal", text: "e|-----3--5/7--<12>--|" })
    // The chord row typed above the intro tab is part of the tab, not chords.
    expect(tabDoc[2]).toEqual({ kind: "literal", text: "   G                 C" })
  })

  test("editing a tab line is exact, and a mark later on the line follows", () => {
    const index = tabLine("B|--3h5")
    const edit = editLine(tabDoc, index, "B|--3h5h7--------------|")
    expectExact(tabDoc, edit)
    expect(edit.doc[index]).toEqual({ kind: "literal", text: "B|--3h5h7--------------|" })
    const before = anchorText(tabDoc)
    const at = before.indexOf("e|--(5)")
    const step = { before, after: anchorText(edit.doc), recorded: edit.changes }
    expect(follow({ start: at, end: at + 7 }, [step])).toEqual({ state: "kept", start: at + 2, end: at + 9 })
  })

  test("deleting a tab line is exact", () => {
    expectExact(tabDoc, deleteLine(tabDoc, tabLine("B|--3h5")))
  })

  test("removing a tab section removes its tab with it; the next section is untouched", () => {
    const start = tabDoc.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_tab: Intro}")
    const edit = removeSection(tabDoc, start)
    expectExact(tabDoc, edit)
    expect(serializeDoc(edit.doc)).not.toContain("e|-------------------|")
    expect(serializeDoc(edit.doc).startsWith("{key: G}\n\n{start_of_verse: Verse 1}")).toBe(true)
  })
})

describe("phrases", () => {
  const verse = ["{key: G}", "{start_of_verse: Verse 1}", "[G]Amazing grace", "[C]How sweet", "{end_of_verse}"]
  const phraseDoc = parseDoc([...verse, "{start_of_textblock: Riff}", ":8 0.6 3.6", "5.5 [3.5] {h}", "{end_of_textblock}"].join("\n"))
  const start = 5

  test("a phrase's lines are literal, its name and notation read back, and its anchor text matches ChordSheetJS", () => {
    const text = serializeDoc(phraseDoc)
    expect(anchorText(phraseDoc)).toBe(anchorFromSong(text))
    expect(phraseAt(phraseDoc, start)).toEqual({ name: "Riff", tex: ":8 0.6 3.6\n5.5 [3.5] {h}" })
    expect([6, 7].map((i) => inPhrase(phraseDoc, i))).toEqual([true, true])
    expect(inPhrase(phraseDoc, 2)).toBe(false)
  })

  test("a phrase added inside a section splits it, exactly", () => {
    const edit = addPhrase(phraseDoc, 2, "Fill", ":4 3.3")
    expectExact(phraseDoc, edit)
    expect(serializeDoc(edit.doc).split("\n").slice(2, 9)).toEqual([
      "[G]Amazing grace",
      "{end_of_verse}",
      "{start_of_textblock: Fill}",
      ":4 3.3",
      "{end_of_textblock}",
      "{start_of_verse}",
      "[C]How sweet",
    ])
    expect(anchorText(edit.doc)).toBe(anchorFromSong(serializeDoc(edit.doc)))
  })

  test("a phrase added after a section's last line goes after the section", () => {
    const edit = addPhrase(phraseDoc, 3, "Fill", ":4 3.3")
    expectExact(phraseDoc, edit)
    expect(serializeDoc(edit.doc).split("\n").slice(3, 8)).toEqual(["[C]How sweet", "{end_of_verse}", "{start_of_textblock: Fill}", ":4 3.3", "{end_of_textblock}"])
  })

  test("a notation line that looks like a directive is indented, so it cannot end the phrase", () => {
    const edit = addPhrase(phraseDoc, 3, "Fill", ":4 3.3\n{end_of_textblock}")
    expect(phraseAt(edit.doc, 5)).toEqual({ name: "Fill", tex: ":4 3.3\n {end_of_textblock}" })
  })

  test("changing a phrase's name and notation is exact", () => {
    const edit = setPhrase(phraseDoc, start, "Main riff", ":8 0.6 3.6 5.6\n5.5\n3.5")
    expectExact(phraseDoc, edit)
    expect(phraseAt(edit.doc, start)).toEqual({ name: "Main riff", tex: ":8 0.6 3.6 5.6\n5.5\n3.5" })
    expect(serializeDoc(edit.doc).endsWith("3.5\n{end_of_textblock}")).toBe(true)
  })

  test("removing a phrase removes its notation with it, exactly", () => {
    const edit = removeSection(phraseDoc, start)
    expectExact(phraseDoc, edit)
    expect(serializeDoc(edit.doc)).toBe(verse.join("\n"))
  })
})
