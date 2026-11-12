import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { ChordLyricsPair, ChordProParser, Literal, Tag } from "chordsheetjs"
import { composeChanges, explains, type Change } from "./changes"
import {
  addPhrase, addScoreLink, addSection, anchorLine, blockRange, canMoveBlockTo, dropSlots, hasHandle, deleteBlock, duplicateBlock, inPhrase, moveBlock, moveBlockTo, phraseAt, removeSection, setPhrase,
  anchorText, deleteLine, editLine, insertLineAfter, moveChord, parseDoc, placeChord, removeChord,
  renameSection, segments, serializeDoc, type ChartDoc, type DocLine, type Edit,
} from "./doc"
import { follow, mapRange } from "./follow"
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
    expect(serializeDoc(edit.doc).split("\n")[i]).toMatch(/^\[D\]Amazing/)
    expect(edit.changes).toHaveLength(1)
    expectExact(doc, edit)
  })

  test("a score link goes on the line below as one directive", () => {
    const edit = addScoreLink(doc, i, `chart=abc track="Lead Gtr" section="Chorus"`)
    expect(edit.doc[i + 1]).toEqual({ kind: "directive", raw: `{score: chart=abc track="Lead Gtr" section="Chorus"}` })
    expectExact(doc, edit)
  })

  test("deleting a score link removes its line and nothing else", () => {
    const linked = addScoreLink(doc, i, `chart=abc track="Lead Gtr" bars=1-2`).doc
    const edit = deleteLine(linked, i + 1)
    expect(serializeDoc(edit.doc)).toBe(serializeDoc(doc))
    expectExact(linked, edit)
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
    const down = moveBlock(doc, starts[0]!, 1)
    expectValid(doc, down)
    expect(labels(down.doc)).toEqual(["Chorus", "Verse 1", "Verse 2", "Chorus"])
    const up = moveBlock(doc, starts[2]!, -1)
    expectValid(doc, up)
    expect(labels(up.doc)).toEqual(["Verse 1", "Verse 2", "Chorus", "Chorus"])
    // Moving down then up again restores the stored text.
    const back = moveBlock(down.doc, starts[0]! + sectionLength(doc, starts[1]!), -1)
    expect(serializeDoc(back.doc)).toBe(serializeDoc(doc))
  })

  test("all adjacent moves preserve every section mark", () => {
    const simple = parseDoc("{start_of_verse: A}\nalpha\n{end_of_verse}\n{start_of_verse: B}\nbeta\n{end_of_verse}\n{start_of_verse: C}\ngamma\n{end_of_verse}\n{start_of_verse: D}\ndelta\n{end_of_verse}")
    const starts = simple.flatMap((line, index) => line.kind === "directive" && line.raw.startsWith("{start_of_") ? [index] : [])
    for (const [index, delta] of [[0, 1], [1, -1], [1, 1], [2, -1], [2, 1], [3, -1]] as const) {
      const before = anchorText(simple)
      const edit = moveBlock(simple, starts[index]!, delta)
      expect(explains(before, anchorText(edit.doc), edit.changes)).toBe(true)
      for (const word of ["alpha", "beta", "gamma", "delta"]) {
        const at = before.indexOf(word)
        const result = follow({ start: at, end: at + word.length }, [{ before, after: anchorText(edit.doc), recorded: edit.changes }])
        expect(result.state).toBe("kept")
        if (result.state !== "orphaned") expect(anchorText(edit.doc).slice(result.start, result.end)).toBe(word)
      }
    }
  })

  test("a section at the end of the list does not move further, and a run composes exactly", () => {
    expect(moveBlock(doc, starts[3]!, 1)).toEqual({ doc, changes: [] })
    expect(moveBlock(doc, starts[0]!, -1)).toEqual({ doc, changes: [] })
    const a = addSection(doc, lineOf("Was blind"), "Bridge")
    const b = moveBlock(a.doc, a.doc.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_verse: Bridge}"), 1)
    expectExact(doc, { doc: b.doc, changes: composeChanges(a.changes, b.changes) })
  })

  test("marks in both sections follow a move", () => {
    const before = anchorText(doc)
    const edit = moveBlock(doc, starts[0]!, 1)
    const step = { before, after: anchorText(edit.doc), recorded: edit.changes }
    const chorus = before.indexOf("My God, my Savior")
    const kept = follow({ start: chorus, end: chorus + 17 }, [step])
    expect(kept.state).toBe("kept")
    if (kept.state !== "orphaned") expect(step.after.slice(kept.start, kept.end)).toBe("My God, my Savior")
    const verse = before.indexOf("That saved a wretch")
    const moved = follow({ start: verse, end: verse + 19 }, [step])
    expect(moved.state).toBe("kept")
    if (moved.state !== "orphaned") expect(step.after.slice(moved.start, moved.end)).toBe("That saved a wretch")
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

describe("blocks", () => {
  const blocks = parseDoc(
    [
      "{key: G}",
      "{start_of_verse: A}",
      "a[C]1 one",
      "a2 two",
      "{end_of_verse}",
      "{start_of_textblock: Riff}",
      "\\tempo 90",
      "r1 notes",
      "{end_of_textblock}",
      "{start_of_verse: B}",
      "b1 one",
      "b2 two",
      "{end_of_verse}",
      "tail",
    ].join("\n"),
  )
  const at = (text: string) => blocks.findIndex((l) => anchorLine(l) === text || (l.kind === "lyrics" && l.text === text))

  /**
   * Labelled units: a mark on every kept line of the old text must map to that
   * same line in the new text, found by the line object, which an edit reuses.
   */
  const expectMarksFollow = (before: ChartDoc, edit: Edit, gone: ReadonlyArray<number> = []) => {
    const old = anchorText(before)
    const next = anchorText(edit.doc)
    expect(explains(old, next, edit.changes)).toBe(true)
    expect(anchorText(parseDoc(serializeDoc(edit.doc)))).toBe(next)
    let from = 0
    before.forEach((line, i) => {
      const length = anchorLine(line).length
      const index = edit.doc.indexOf(line)
      if (length > 0 && !gone.includes(i) && index >= 0) {
        const to = anchorText(edit.doc.slice(0, index)).length + (index > 0 ? 1 : 0)
        expect(mapRange({ start: from, end: from + length }, edit.changes)).toEqual({ start: to, end: to + length })
      }
      from += length + 1
    })
  }

  test("a line steps past its neighbours, across a section boundary and past a whole phrase", () => {
    const a2 = at("a2 two")
    const down = moveBlock(blocks, a2, 1)
    expectMarksFollow(blocks, down)
    // Out of the verse, below its end line.
    expect(serializeDoc(down.doc).split("\n").slice(3, 6)).toEqual(["{end_of_verse}", "a2 two", "{start_of_textblock: Riff}"])
    // Past the phrase as one block, not into it.
    const past = moveBlock(down.doc, down.doc.indexOf(blocks[a2]!), 1)
    expectMarksFollow(down.doc, past)
    expect(serializeDoc(past.doc).split("\n").slice(3, 9)).toEqual([
      "{end_of_verse}", "{start_of_textblock: Riff}", "\\tempo 90", "r1 notes", "{end_of_textblock}", "a2 two",
    ])
    const back = moveBlock(past.doc, past.doc.indexOf(blocks[a2]!), -1)
    expect(serializeDoc(back.doc)).toBe(serializeDoc(down.doc))
    // Down again goes into the next section, below its start line.
    const into = moveBlock(past.doc, past.doc.indexOf(blocks[a2]!), 1)
    expectMarksFollow(past.doc, into)
    expect(serializeDoc(into.doc).split("\n").slice(8, 11)).toEqual(["{start_of_verse: B}", "a2 two", "b1 one"])
  })

  test("the first and last lines and sections stay where they are at the edge", () => {
    expect(moveBlock(blocks, at("tail"), 1)).toEqual({ doc: blocks, changes: [] })
    expect(moveBlock(blocks, 0, -1)).toEqual({ doc: blocks, changes: [] })
    const sections = blocks.flatMap((l, i) => (l.kind === "directive" && l.raw.startsWith("{start_of_") ? [i] : []))
    expect(moveBlock(blocks, sections[0]!, -1).changes).toEqual([])
    expect(moveBlock(blocks, sections[2]!, 1).changes).toEqual([])
  })

  test("the last line moves up, and a line moves to the end, with their newlines", () => {
    const up = moveBlock(blocks, at("tail"), -1)
    expectMarksFollow(blocks, up)
    expect(serializeDoc(up.doc).split("\n").slice(-3)).toEqual(["b2 two", "tail", "{end_of_verse}"])
    const end = moveBlockTo(blocks, at("a1 one"), blocks.length)
    expectMarksFollow(blocks, end)
    expect(serializeDoc(end.doc).endsWith("tail\na[C]1 one")).toBe(true)
  })

  test("a line of a phrase moves only with its block", () => {
    const edit = moveBlock(blocks, at("r1 notes"), -1)
    expectMarksFollow(blocks, edit)
    const text = serializeDoc(edit.doc).split("\n")
    expect(text.slice(1, 5)).toEqual(["{start_of_textblock: Riff}", "\\tempo 90", "r1 notes", "{end_of_textblock}"])
    expect(edit.doc.indexOf(blocks[at("a2 two")]!)).toBeGreaterThan(edit.doc.indexOf(blocks[at("r1 notes")]!))
  })

  test("every block moves to every slot that accepts it, and nowhere else", () => {
    let moves = 0
    for (let line = 0; line < blocks.length; line++) {
      for (let slot = 0; slot <= blocks.length; slot++) {
        const edit = moveBlockTo(blocks, line, slot)
        if (!canMoveBlockTo(blocks, line, slot)) {
          expect(edit.changes).toEqual([])
          continue
        }
        moves++
        expectMarksFollow(blocks, edit)
        expect(edit.doc).toHaveLength(blocks.length)
      }
    }
    expect(moves).toBeGreaterThan(100)
  })

  test("a slot inside a phrase, or a section inside a section, refuses", () => {
    expect(canMoveBlockTo(blocks, at("tail"), at("r1 notes"))).toBe(false)
    expect(canMoveBlockTo(blocks, at("tail"), at("a2 two"))).toBe(true)
    const verseB = blocks.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_verse: B}")
    expect(canMoveBlockTo(blocks, verseB, at("a2 two"))).toBe(false)
    expect(canMoveBlockTo(blocks, verseB, 1)).toBe(true)
  })

  test("duplicating a line or a section writes new text and leaves the marks in place", () => {
    for (const line of [at("a2 two"), at("a1 one"), blocks.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_verse: B}"), at("r1 notes")]) {
      const edit = duplicateBlock(blocks, line)
      expectMarksFollow(blocks, edit)
      expect(edit.changes.every((c) => c.source === undefined && c.to === c.from)).toBe(true)
      expect(edit.doc.length).toBeGreaterThan(blocks.length)
    }
    const copy = duplicateBlock(blocks, at("tail"))
    expect(serializeDoc(copy.doc).endsWith("tail\ntail")).toBe(true)
  })

  test("deleting a section takes its lines, and deleting the last line takes the newline before it", () => {
    const verse = blocks.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_verse: B}")
    const edit = deleteBlock(blocks, verse)
    expectMarksFollow(blocks, edit, [verse, verse + 1, verse + 2, verse + 3])
    expect(serializeDoc(edit.doc)).not.toContain("b1 one")
    const last = deleteBlock(blocks, at("tail"))
    expectMarksFollow(blocks, last)
    expect(serializeDoc(last.doc).endsWith("{end_of_verse}")).toBe(true)
    const phrase = deleteBlock(blocks, at("r1 notes"))
    expect(serializeDoc(phrase.doc)).not.toContain("Riff")
    expect(explains(anchorText(blocks), anchorText(phrase.doc), phrase.changes)).toBe(true)
  })
})

describe("blocks: deleting the last line, newlines, and steps that undo each other", () => {
  test("deleting the only block gives a valid change set and a chart that reads back", () => {
    for (const text of ["a1", "{start_of_textblock: P}\n:8 0.6 3.5\n{end_of_textblock}", "{start_of_verse: V}\na1\n{end_of_verse}"]) {
      const chart = parseDoc(text)
      const edit = deleteBlock(chart, 0)
      expect(explains(anchorText(chart), anchorText(edit.doc), edit.changes)).toBe(true)
      expect(anchorText(edit.doc)).toBe("")
      expect(parseDoc(serializeDoc(edit.doc))).toEqual(edit.doc)
    }
    const one = parseDoc("a1")
    const line = deleteLine(one, 0)
    expect(explains("a1", "", line.changes)).toBe(true)
    // An empty chart's one empty line has nothing left to delete.
    expect(deleteLine(line.doc, 0).changes).toEqual([])
  })

  test("a step of the last line and its inverse leave no change", () => {
    const chart = parseDoc("a1\nb2\nc3")
    const up = moveBlock(chart, 2, -1)
    expect(serializeDoc(up.doc)).toBe("a1\nc3\nb2")
    expect(explains("a1\nb2\nc3", "a1\nc3\nb2", up.changes)).toBe(true)
    expect(up.changes.every((c) => c.source !== undefined || c.to > c.from)).toBe(true)
    const back = moveBlock(up.doc, 1, 1)
    expect(serializeDoc(back.doc)).toBe("a1\nb2\nc3")
    expect(composeChanges(up.changes, back.changes)).toEqual([])
  })

  // A seeded generator of charts: unlabelled lines, closed and unclosed sections, tab and phrase sections, loose comments and lines.
  const generate = (seed: number): string => {
    let state = seed
    const r = (n: number) => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state % n
    }
    let uid = 0
    const lyric = () => (r(2) ? `[G]w${uid++}x [D]la${uid}y` : `w${uid++}x la${uid}y`)
    const out: Array<string> = []
    for (let i = r(3); i > 0; i--) out.push(lyric())
    for (let s = 1 + r(4); s > 0; s--) {
      const kind = r(6)
      if (kind === 0) out.push(`{start_of_tab: T${uid++}}`, `e|--${uid}--|`, "{end_of_tab}")
      else if (kind === 1) out.push(`{start_of_textblock: P${uid++}}`, `:8 0.6 ${uid++}.5`, "{end_of_textblock}")
      else if (kind === 2) {
        out.push(`{start_of_verse: V${uid++}}`)
        for (let n = 1 + r(3); n > 0; n--) out.push(lyric())
      } else {
        out.push(`{start_of_chorus: C${uid++}}`)
        for (let n = r(3); n > 0; n--) out.push(lyric())
        out.push("{end_of_chorus}")
      }
      if (r(4) === 0) out.push(`{comment: note${uid++}}`)
      if (r(3) === 0) out.push(lyric())
    }
    return out.join("\n")
  }
  const seeds = process.env.SEED ? [Number(process.env.SEED)] : Array.from({ length: 400 }, (_, i) => i + 1)

  test("every step is exact, and the opposite step restores the chart and composes to no change (SEED=<n> replays one)", () => {
    for (const seed of seeds) {
      const chart = parseDoc(generate(seed))
      const context = `seed ${seed}:\n${serializeDoc(chart)}`
      chart.forEach((_, i) => {
        if (!hasHandle(chart, i)) return
        for (const delta of [-1, 1] as const) {
          const step = moveBlock(chart, i, delta)
          if (step.changes.length === 0) continue
          expect(explains(anchorText(chart), anchorText(step.doc), step.changes), context).toBe(true)
          expect(anchorText(parseDoc(serializeDoc(step.doc))), context).toBe(anchorText(step.doc))
          const moved = step.doc.indexOf(chart[blockRange(chart, i).start]!)
          const back = moveBlock(step.doc, moved, -delta as -1 | 1)
          expect(serializeDoc(back.doc), `${context}\nline ${i} delta ${delta}`).toBe(serializeDoc(chart))
          expect(composeChanges(step.changes, back.changes), `${context}\nline ${i} delta ${delta}`).toEqual([])
        }
      })
    }
  })

  test("a loose comment after a section travels with it, and an unclosed last section can be stepped past", () => {
    const chart = parseDoc("{start_of_chorus: C}\nc1\n{end_of_chorus}\n{comment: note}\n{start_of_verse: V}\nv1\n{start_of_textblock: P}\n:8 0.6 1.5\n{end_of_textblock}\n{comment: end}")
    const down = moveBlock(chart, 0, 1)
    expect(serializeDoc(down.doc).split("\n").slice(0, 2)).toEqual(["{start_of_verse: V}", "v1"])
    expect(serializeDoc(down.doc).endsWith("{end_of_chorus}\n{comment: note}")).toBe(false)
    const phrase = chart.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_textblock: P}")
    const up = moveBlock(chart, phrase, -1)
    expect(up.changes.length).toBeGreaterThan(0)
    const back = moveBlock(up.doc, 4, 1)
    expect(serializeDoc(back.doc)).toBe(serializeDoc(chart))
  })
})

describe("drop slots", () => {
  test("a row's slots: a line is bracketed by itself, a section heading is entered, a tab or phrase is jumped with its end line", () => {
    const chart = parseDoc("{start_of_verse: V}\nv1\n{end_of_verse}\n{comment: note}\n{start_of_textblock: P}\n:8 0.6 1.5\n{end_of_textblock}\n{comment: after}\ntail")
    expect(dropSlots(chart, 1)).toEqual({ before: 1, after: 2 })
    expect(dropSlots(chart, 0)).toEqual({ before: 0, after: 1 })
    // The phrase's notation line stands for the phrase; the loose comment after its end line is not part of the jump.
    expect(dropSlots(chart, 5)).toEqual({ before: 4, after: 7 })
    expect(dropSlots(chart, 4)).toEqual({ before: 4, after: 7 })
    expect(dropSlots(chart, 8)).toEqual({ before: 8, after: 9 })
  })
})
