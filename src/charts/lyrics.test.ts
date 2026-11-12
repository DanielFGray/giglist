import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { addSection, anchorText, parseDoc, renameSection, serializeDoc } from "./doc"
import { chartChords, exportChords, importPasted, isChordName, isTabLine, renderLyrics, suggestedChords, type ChartItem } from "./lyrics"

const pasted = readFileSync(new URL("../../tests/fixtures/amazing-grace.txt", import.meta.url), "utf8")

const pairs = (key?: string) =>
  renderLyrics(importPasted(pasted, "G"), key).flatMap((line) => line.filter((i): i is Extract<ChartItem, { kind: "pair" }> => i.kind === "pair"))

const CHORD = /^[A-G][#b]?(m|maj|min|dim|aug|sus)?\d*(\/[A-G][#b]?)?$/

describe("chartChords", () => {
  test("lists distinct chords in first-seen order", () => {
    const lines = renderLyrics("[C]a [G]a [C]a [Am]a")
    expect(chartChords(lines)).toEqual(["C", "G", "Am"])
  })

  test("a chart with no chords gives an empty list", () => {
    const lines = renderLyrics("Amazing grace, how sweet")
    expect(chartChords(lines)).toEqual([])
  })
})

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

describe("exportChords", () => {
  const stored = importPasted(pasted, "G")

  test("puts each chord on the row above its word", () => {
    const rows = exportChords(stored).split("\n")
    const at = rows.indexOf("Amazing grace, how sweet the sound")
    expect(at).toBeGreaterThan(0)
    // Each chord stands over the column of the word it was placed on.
    expect([...rows[at - 1]!.matchAll(/\S+/g)].map((m) => [m[0], m.index])).toEqual([["G", 0], ["C", 18], ["G", 28]])
    expect(rows[0]).toBe("[Verse 1]")
  })

  test("pasting the export back gives the chart that was exported", () => {
    expect(importPasted(exportChords(stored), "G")).toBe(stored)
  })

  test("exports in the shown key, and that pastes back as a chart in that key", () => {
    const inA = exportChords(stored, "A")
    expect(inA).toContain("A")
    expect(inA).not.toMatch(/^\s*G\b/m)
    expect(importPasted(inA, "A")).toBe(importPasted(exportChords(stored, "A"), "A"))
    expect(renderLyrics(importPasted(inA, "A"))[2]).toEqual(renderLyrics(stored, "A")[2]!.map((i) => ({ ...i, start: expect.any(Number), end: expect.any(Number) })))
  })

  test("chords that touch are kept apart, a chord-only line stays apart from the words below, and a blank line stays", () => {
    const source = "{key: C}\n[C][G]Hi\n[Am]\nWords here\n\n[F]Ok"
    const rows = exportChords(source).split("\n")
    expect(rows).toEqual(["C G", "Hi", "Am", "", "Words here", "", "F", "Ok"])
  })
})

describe("tab", () => {
  const riff = readFileSync(new URL("../../tests/fixtures/riff-and-solo.txt", import.meta.url), "utf8")
  const stored = importPasted(riff, "G")
  const rows = riff.split("\n")
  const tabRows = rows.filter(isTabLine)

  test("recognises tab lines and nothing else in a chart", () => {
    expect(tabRows).toHaveLength(10)
    expect(pasted.split("\n").filter(isTabLine)).toEqual([])
    for (const lyric of ["Well - I - don't - know", "----", "Oh-oh-oh-oh-oh", "G - C - D"]) expect(isTabLine(lyric)).toBe(false)
  })

  test("a tab run becomes a tab section kept exactly, with the chord row above it", () => {
    const lines = stored.split("\n")
    const intro = lines.indexOf("{start_of_tab: Intro}")
    // The header had nothing under it before the tab, so the tab section takes its label.
    expect(intro).toBe(1)
    expect(lines.slice(intro + 1, intro + 8)).toEqual(rows.slice(1, 8))
    expect(lines[intro + 8]).toBe("{end_of_tab}")
    // Two runs under one header: the first takes the label, the second has none.
    expect(stored).toContain("{start_of_tab: Solo}\ne|-----3--5/7--<12>--|")
    expect(stored).toContain("{start_of_tab}\ne|--(5)--3p0---------|")
    expect(stored).toContain("{start_of_verse: Verse 1}\n[G]Amazing grace")
  })

  test("tab lines are drawn as written, in any key, and nothing in them is a chord", () => {
    for (const key of [undefined, "A"]) {
      const shown = renderLyrics(stored, key).flat()
      expect(shown.filter((i) => i.kind === "tab").map((i) => (i as { text: string }).text)).toEqual([rows[1]!.trimEnd(), ...tabRows])
      expect(shown.some((i) => i.kind === "pair" && i.chord.includes("12"))).toBe(false)
    }
  })

  test("a tab section shown in another key says its tab is as written", () => {
    const tabSections = (key?: string) =>
      renderLyrics(stored, key).flat().filter((i): i is Extract<ChartItem, { kind: "section" }> => i.kind === "section" && i.label !== "Verse 1")
    expect(tabSections().map((s) => s.writtenIn)).toEqual([undefined, undefined, undefined])
    expect(tabSections("A").map((s) => s.writtenIn)).toEqual(["G", "G", "G"])
  })

  test("each tab item's range holds its line in the anchor text", () => {
    const anchor = anchorText(parseDoc(stored))
    for (const item of renderLyrics(stored).flat()) {
      if (item.kind === "tab") expect(anchor.slice(item.start, item.end)).toBe(item.text)
    }
  })

  test("pasting the export back gives the chart that was exported", () => {
    expect(importPasted(exportChords(stored), "G")).toBe(stored)
  })
})

describe("phrases", () => {
  const stored = [
    "{key: G}",
    "{start_of_verse: Verse 1}",
    "[G]Amazing grace",
    "{end_of_verse}",
    "{start_of_textblock: Intro riff}",
    ":8 0.6 3.6 5.5 3.5 |",
    "5.5 [3.5] {h}",
    "{end_of_textblock}",
    "[C]How sweet",
  ].join("\n")
  const tex = ":8 0.6 3.6 5.5 3.5 |\n5.5 [3.5] {h}"

  test("a phrase is one drawn line holding its name and notation, and nothing in it is a chord", () => {
    const lines = renderLyrics(stored)
    expect(lines.map((line) => line.map((item) => item.kind))).toEqual([["section"], ["pair", "pair"], ["phrase"], ["pair", "pair"]])
    expect(lines[2]![0]).toMatchObject({ kind: "phrase", name: "Intro riff", tex })
  })

  test("a phrase's range covers its name and its notation in the anchor text", () => {
    const phrase = renderLyrics(stored)[2]![0]!
    expect(anchorText(parseDoc(stored)).slice(phrase.start, phrase.end)).toBe(`Intro riff\n${tex}`)
  })

  test("in another key the notation is unchanged and says it is as written", () => {
    expect(renderLyrics(stored, "A")[2]![0]).toMatchObject({ kind: "phrase", tex, writtenIn: "G" })
    expect(renderLyrics(stored)[2]![0]).not.toHaveProperty("writtenIn")
  })

  test("copying a chart out writes the phrase's stored lines, so the notation travels with its name", () => {
    expect(exportChords(stored)).toBe(
      "[Verse 1]\nG\nAmazing grace\n{start_of_textblock: Intro riff}\n:8 0.6 3.6 5.5 3.5 |\n5.5 [3.5] {h}\n{end_of_textblock}\nC\nHow sweet",
    )
  })
})

describe("paste round trip", () => {
  // One chart holding every form: a section, chords over words, a chord-only
  // line, a comment, tab, and a phrase whose alphaTex opens with a brace.
  const fixture = [
    "{key: G}",
    "{start_of_verse: Verse 1}",
    "[G]Amazing grace",
    "[Am]",
    "{comment: Sing along}",
    "{end_of_verse}",
    "{start_of_tab: Intro}",
    "e|--0--3--|",
    "{end_of_tab}",
    "{start_of_textblock: Intro riff}",
    ":8 0.6 3.6 5.5 3.5 |",
    "{h} 5.5 7.5",
    "{end_of_textblock}",
  ].join("\n")

  test("pasting the export back gives the chart that was exported, anchor text and all", () => {
    const back = importPasted(exportChords(fixture, "G"), "G")
    expect(back).toBe(fixture)
    expect(anchorText(parseDoc(back))).toBe(anchorText(parseDoc(fixture)))
  })
})

describe("round trip from doc edits", () => {
  test("addSection then rename to 'Chorus' keeps anchor text", () => {
    const base = parseDoc("{key: G}\n[G]Amazing grace\n[C]How sweet")
    const added = addSection(base, 1, "Bridge")
    const start = added.doc.findIndex((l) => l.kind === "directive" && l.raw === "{start_of_verse: Bridge}")
    const renamed = renameSection(added.doc, start, "Chorus")
    const source = serializeDoc(renamed.doc)
    const back = importPasted(exportChords(source, "G"), "G")
    expect(anchorText(parseDoc(back))).toBe(anchorText(parseDoc(source)))
  })

  test("renameSection to '' round-trips as source", () => {
    const source = "{key: G}\n{start_of_verse: Verse 1}\n[G]Amazing grace\n{end_of_verse}"
    const doc = parseDoc(source)
    const renamed = renameSection(doc, 1, "")
    const edited = serializeDoc(renamed.doc)
    const back = importPasted(exportChords(edited, "G"), "G")
    expect(back).toBe(edited)
  })

  test("an unlabelled bridge round-trips as source", () => {
    const source = "{key: G}\n{start_of_bridge}\n[G]La\n{end_of_bridge}"
    const back = importPasted(exportChords(source, "G"), "G")
    expect(back).toBe(source)
  })

  test("a header section followed by a raw unlabelled section does not nest", () => {
    const pasted = "[Verse 1]\nG\nLa\n{start_of_bridge}\nG\nLo\n{end_of_bridge}"
    const stored = importPasted(pasted, "G")
    expect(stored).not.toMatch(/\{start_of_verse: Bridge\}/)
    const back = importPasted(exportChords(stored, "G"), "G")
    expect(back).toBe(stored)
  })

  test("a chart with a second {key} line round-trips as source", () => {
    const source = "{key: G}\n[G]Amazing grace\n{key: D}\n[D]How sweet"
    const back = importPasted(exportChords(source, "G"), "G")
    expect(back).toBe(source)
  })
})

describe("isChordName", () => {
  test("accepts names ChordSheetJS reads as a chord", () => {
    for (const name of ["F#m7", "C/E", "Bb", "Dsus4", "Am(add9)", "N.C.", "NC"]) expect(isChordName(name)).toBe(true)
  })

  test("refuses names that would change the line around them or are not chords", () => {
    for (const name of ["", "A]B", "A B", "[C", "A\nB", "A\tB", "xyz!"]) expect(isChordName(name)).toBe(false)
  })
})
