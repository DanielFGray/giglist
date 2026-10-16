import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { anchorText, deleteLine, insertLineAfter, parseDoc, placeChord, type Edit } from "./doc"
import { follow, type Step } from "./follow"
import { importPasted } from "./lyrics"

const doc = parseDoc(importPasted(readFileSync(new URL("../../tests/fixtures/amazing-grace.txt", import.meta.url), "utf8"), "G"))
const text = anchorText(doc)

/** The range of the first occurrence of `word` in the anchor text. */
const rangeOf = (word: string, from = 0) => {
  const start = text.indexOf(word, from)
  return { start, end: start + word.length }
}
const stepOf = (edit: Edit, recorded: boolean): Step => ({
  before: text,
  after: anchorText(edit.doc),
  recorded: recorded ? edit.changes : null,
})
const lineOf = (start: string) => doc.findIndex((l) => l.kind === "lyrics" && l.text.startsWith(start))
const word = (edit: Edit, r: { start: number; end: number }) => anchorText(edit.doc).slice(r.start, r.end)

describe("follow", () => {
  test("an edit above moves a mark with its word, whether recorded or derived", () => {
    const edit = insertLineAfter(doc, 0)
    const mark = rangeOf("wretch")
    for (const recorded of [true, false]) {
      const result = follow(mark, [stepOf(edit, recorded)])
      expect(result.state).toBe("kept")
      if (result.state !== "orphaned") expect(word(edit, result)).toBe("wretch")
    }
  })

  test("a chord dropped on a marked word marks it changed; a mark on the bare text stays kept", () => {
    // An item's range includes its chord, so replacing the chord edits the marked content.
    const mark = rangeOf("[G]Amazing ")
    const bare = rangeOf("Amazing")
    const edit = placeChord(doc, lineOf("Amazing"), 0, "D")
    const result = follow(mark, [stepOf(edit, true)])
    expect(result.state).toBe("changed")
    expect(follow(bare, [stepOf(edit, true)]).state).toBe("kept")
  })

  test("deleting the marked line orphans the mark as deleted", () => {
    const mark = rangeOf("wretch")
    const edit = deleteLine(doc, lineOf("That saved"))
    expect(follow(mark, [stepOf(edit, true)])).toEqual({ state: "orphaned", reason: "deleted" })
  })

  test("the second chorus never jumps to the first when the first is deleted", () => {
    const first = text.indexOf("My chains")
    const second = text.indexOf("My chains", first + 1)
    const mark = { start: second, end: second + 9 }
    const edit = deleteLine(doc, lineOf("My chains"))
    const result = follow(mark, [stepOf(edit, true)])
    expect(result.state).toBe("kept")
    if (result.state !== "orphaned") expect(word(edit, result)).toBe("My chains")
  })

  test("a derived diff that could align repeated lines either way orphans the mark as uncertain", () => {
    const repeated = parseDoc("{start_of_chorus: Chorus}\nLa la la\nLa la la\nLa la la\n{end_of_chorus}")
    const before = anchorText(repeated)
    const middle = before.indexOf("La la la", before.indexOf("La la la") + 1)
    const edit = deleteLine(repeated, 2)
    const result = follow({ start: middle, end: middle + 8 }, [{ before, after: anchorText(edit.doc), recorded: null }])
    expect(result).toEqual({ state: "orphaned", reason: "uncertain" })
  })
})
