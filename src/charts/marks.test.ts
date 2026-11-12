import { describe, expect, test } from "vitest"
import { anchorText, insertLineAfter, parseDoc, serializeDoc, deleteLine } from "./doc"
import { boundsOf, inkPath, markResolver, near, type RevisionText } from "./marks"

const first = "{start_of_verse: Verse 1}\n[G]Amazing grace\nHow sweet\n{end_of_verse}"
const doc = parseDoc(first)
const text = anchorText(doc)
const after = insertLineAfter(doc, 0)
const gone = deleteLine(after.doc, 3)

const revisions: RevisionText[] = [
  { id: "r1", source: first, changes: null },
  { id: "r2", source: serializeDoc(after.doc), changes: after.changes },
  { id: "r3", source: serializeDoc(gone.doc), changes: gone.changes },
]
const resolve = markResolver(revisions)
const grace = { range_start: text.indexOf("grace"), range_end: text.indexOf("grace") + 5 }

describe("markResolver", () => {
  test("a mark on the newest revision is where it was made", () => {
    expect(resolve({ revision_id: "r3", range_start: 3, range_end: 8 })).toEqual({ state: "kept", start: 3, end: 8 })
  })

  test("follows a mark through a recorded insert above it", () => {
    const result = markResolver(revisions.slice(0, 2))({ revision_id: "r1", ...grace })
    expect(result.state).toBe("kept")
    if (result.state !== "orphaned") expect(anchorText(after.doc).slice(result.start, result.end)).toBe("grace")
  })

  test("follows a mark through every later revision, and orphans it when its line is deleted", () => {
    const sweet = text.indexOf("sweet")
    expect(resolve({ revision_id: "r1", range_start: sweet, range_end: sweet + 5 })).toEqual({ state: "orphaned", reason: "deleted" })
    expect(resolve({ revision_id: "r1", ...grace }).state).toBe("kept")
  })

  test("a mark on a revision that is not in the list is orphaned", () => {
    expect(resolve({ revision_id: "missing", range_start: 0, range_end: 3 })).toEqual({ state: "orphaned", reason: "deleted" })
  })
})

describe("ink geometry", () => {
  const stroke = [[0, 0, 0.5], [10, 5, 0.5], [20, 0, 0.5]] as const

  test("bounds cover every point", () => {
    expect(boundsOf([stroke])).toEqual({ x: 0, y: 0, w: 20, h: 5 })
  })

  test("two boxes are near when they are within the gap", () => {
    expect(near({ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, 6)).toBe(true)
    expect(near({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 }, 6)).toBe(false)
  })

  test("a stroke outlines to a closed path", () => {
    expect(inkPath(stroke, 14)).toMatch(/^M .* Z$/)
  })
})
