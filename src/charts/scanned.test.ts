import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { importPasted } from "./lyrics"
import { scanFormat, textFromWords, wordsFromPdf, wordsFromTesseract, type WordBox } from "./scanned"

const fixture = (name: string) => readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), "utf8")

/**
 * Each lyric line of a chart with its chords, each named by the word it falls
 * in (or "end" past the last word). A chord typed over the space before a word
 * belongs to that word. Word boxes give no letter widths, so where inside a
 * word a chord lands is approximate; the word is what a player reads.
 */
function chordWords(chordPro: string): Array<string> {
  return chordPro.split("\n").flatMap((line) => {
    if (line.startsWith("{")) return line.startsWith("{start_of") ? [line] : []
    const lyric = line.replace(/\[[^\]]+\]/g, "")
    if (lyric.trim() === "" && !line.includes("[")) return []
    const starts = [...lyric.matchAll(/\S+/g)].map((m) => m.index)
    const chords: Array<string> = []
    let removed = 0
    for (const m of line.matchAll(/\[([^\]]+)\]/g)) {
      const at = m.index - removed
      removed += m[0].length
      const next = lyric.slice(at).search(/\S/)
      chords.push(next < 0 ? `${m[1]}@end` : `${m[1]}@${starts.filter((s) => s <= at + next).length}`)
    }
    return [`${lyric.trim()} | ${chords.join(" ")}`]
  })
}

describe("textFromWords", () => {
  const typed = chordWords(importPasted(fixture("amazing-grace.txt")))

  test("a PDF's text layer gives the typed chart, each chord on its word", () => {
    expect(chordWords(importPasted(textFromWords(wordsFromPdf(fixture("amazing-grace.bbox.xhtml")))))).toEqual(typed)
  })

  test("Tesseract's reading of the page gives the typed chart, each chord on its word", () => {
    const read = chordWords(importPasted(textFromWords(wordsFromTesseract(fixture("amazing-grace.tsv")))))
    // Tesseract reads the apostrophe of 'Twas as an opening quote.
    expect(read.map((line) => line.replace("‘", "'"))).toEqual(typed)
  })

  test("a chord goes over the lyric character under its left edge, in any font", () => {
    // "wide" is twice as wide as "narrow" per letter: column counts would put the chord elsewhere.
    const words = [
      word(0, "G", 10, 0), word(0, "C", 120, 0),
      word(1, "narrow", 10, 30, 60), word(1, "wide", 80, 30, 80),
    ]
    // Halfway across "wide" is its "d", the tenth character.
    expect(textFromWords(words)).toBe("G        C\nnarrow wide")
  })

  test("a chord between two words goes on the next word, and one past the end goes after it", () => {
    // "two" ends at 110; A is two letters further on.
    const words = [word(0, "D", 75, 0), word(0, "A", 130, 0), word(1, "one", 10, 30, 30), word(1, "two", 80, 30, 30)]
    expect(textFromWords(words)).toBe("    D    A\none two")
  })

  test("chords that would touch keep a space between them", () => {
    const words = [word(0, "Am7", 10, 0), word(0, "D", 12, 0), word(1, "la", 10, 30, 20)]
    expect(textFromWords(words)).toBe("Am7 D\nla")
  })

  test("a chord-only line keeps its spacing, and a wide gap becomes a blank line", () => {
    const words = [
      word(0, "Intro", 10, 0, 50),
      word(1, "Riff", 10, 30, 40),
      word(2, "G", 10, 60), word(2, "C", 110, 60),
      word(3, "Verse", 10, 150, 50),
    ]
    expect(textFromWords(words)).toBe("Intro\nRiff\nG         C\n\nVerse")
  })

  test("a lone bar in a lyric line is the capital I Tesseract misread", () => {
    expect(textFromWords([word(0, "|", 10, 0), word(0, "once", 30, 0, 40)])).toBe("I once")
  })

  test("pages are separated by a blank line", () => {
    expect(textFromWords([{ ...word(0, "two", 10, 0, 30), page: 2 }, word(0, "one", 10, 0, 30)])).toBe("one\n\ntwo")
  })
})

describe("wordsFromTesseract", () => {
  test("keeps Tesseract's lines, so a tilted line stays one line", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t10\t0\t40\t20\t95\tAmazing",
      "5\t1\t1\t1\t1\t2\t900\t26\t40\t20\t95\tgrace",
      "5\t1\t1\t1\t2\t1\t10\t30\t40\t20\t95\tThat",
    ].join("\n")
    expect(textFromWords(wordsFromTesseract(tsv))).toBe("Amazing grace\nThat")
  })
})

describe("wordsFromPdf", () => {
  test("puts the chords of one row back on one line, and decodes entities", () => {
    const xhtml = `<page width="600" height="800">
      <word xMin="10" yMin="0" xMax="20" yMax="12">G</word>
      <word xMin="60" yMin="0" xMax="70" yMax="12">C</word>
      <word xMin="10" yMin="14" xMax="50" yMax="26">Rock</word>
      <word xMin="55" yMin="14" xMax="80" yMax="26">&amp;</word>
      <word xMin="85" yMin="14" xMax="120" yMax="26">roll</word>
    </page>`
    const words = wordsFromPdf(xhtml)
    expect(new Set(words.slice(0, 2).map((w) => w.line)).size).toBe(1)
    expect(textFromWords(words)).toBe("G    C\nRock & roll")
  })
})

describe("scanFormat", () => {
  const bytes = (...parts: Array<string | number>) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "number" ? [p] : Array.from(p, (c) => c.charCodeAt(0)))))

  test("names PDFs and the images Tesseract opens, and nothing else", () => {
    expect(scanFormat(bytes("%PDF-1.7"))).toBe("pdf")
    expect(scanFormat(bytes(0x89, "PNG", 13, 10))).toBe("image")
    expect(scanFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image")
    expect(scanFormat(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image")
    expect(scanFormat(bytes("PK", 3, 4))).toBeNull()
    expect(scanFormat(bytes("G C D"))).toBeNull()
  })
})

/** A word on line `line`, `width` wide (10 per letter by default), 20 high. */
function word(line: number, text: string, left: number, top: number, width = text.length * 10): WordBox {
  return { page: 1, line, text, left, top, right: left + width, bottom: top + 20 }
}
