/**
 * Scanned charts: the text of a PDF or a photographed page, laid out as chords
 * over lyrics so `importPasted` can read it like a paste.
 *
 * Plain text from a PDF or from Tesseract loses the spacing that puts each
 * chord over its syllable, so this works from word boxes instead: each word
 * with its position on the page (Tesseract's TSV output, or the PDF's own text
 * layer from `pdftotext -bbox-layout`). A songbook sets lyrics in a
 * proportional font, where a column count means nothing; what holds on any
 * page is that a chord is printed over the lyric character it belongs to. So
 * each chord is placed at the character under its left edge, and the lyric
 * line is written out with single spaces.
 *
 * Pure and free of the DOM; the server runs the programs and passes their output here.
 */
import { isChordLine } from "./lyrics"
import { startsWith } from "alphatab-kit/charts/score-file"

/** One word on a page, as a box in the page's units with y growing downward. */
export type WordBox = {
  readonly page: number
  /** The word's line on its page; numbers only group words, they need not be in order. */
  readonly line: number
  readonly text: string
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * Chords over lyrics text from the words of one or more pages. Pages are
 * separated by a blank line, and a gap of more than one and a half lines on a
 * page becomes a blank line.
 */
export function textFromWords(words: ReadonlyArray<WordBox>): string {
  const pages = Map.groupBy(words, (word) => word.page)
  return [...pages.keys()]
    .toSorted((a, b) => a - b)
    .map((page) => layoutPage(linesOf(pages.get(page)!)))
    .join("\n\n")
}

/**
 * The words of Tesseract TSV output (`tesseract page.png - tsv`). Its lines are
 * kept: Tesseract finds them along a tilted photo's slope, where words at the
 * end of a line sit lower on the image than words at its start.
 */
export function wordsFromTesseract(tsv: string): Array<WordBox> {
  const words: Array<WordBox> = []
  const lineNumbers = new Map<string, number>()
  for (const row of tsv.split("\n").slice(1)) {
    const [level, page, block, paragraph, line, , left, top, width, height, , text] = row.split("\t")
    // Level 5 rows are words; the others are the blocks, paragraphs and lines that hold them.
    if (level !== "5" || !text?.trim()) continue
    const lineKey = `${page}.${block}.${paragraph}.${line}`
    if (!lineNumbers.has(lineKey)) lineNumbers.set(lineKey, lineNumbers.size)
    words.push({
      page: Number(page),
      line: lineNumbers.get(lineKey)!,
      text: text.trim(),
      left: Number(left),
      top: Number(top),
      right: Number(left) + Number(width),
      bottom: Number(top) + Number(height),
    })
  }
  return words
}

/**
 * The words of a PDF's text layer, from `pdftotext -bbox` output. A text
 * layer is not tilted, but it often holds each chord as a line of its own, so
 * lines are found by height: a word joins the line of the first word it
 * overlaps from top to bottom at its middle.
 */
export function wordsFromPdf(xhtml: string): Array<WordBox> {
  const words: Array<WordBox> = []
  for (const [index, page] of xhtml.split(/<page\b/).slice(1).entries()) {
    const lines: Array<{ top: number; bottom: number }> = []
    const boxes = [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
      .map((m) => ({ text: decodeXml(m[5]!).trim(), left: Number(m[1]), top: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]) }))
      .filter((box) => box.text !== "")
    for (const box of boxes.toSorted((a, b) => a.top - b.top)) {
      const middle = (box.top + box.bottom) / 2
      let line = lines.findIndex((l) => middle >= l.top && middle <= l.bottom)
      if (line < 0) line = lines.push({ top: box.top, bottom: box.bottom }) - 1
      words.push({ page: index + 1, line, ...box })
    }
  }
  return words
}

/** A file a chart can be read from: a PDF, or an image Tesseract can open. */
export type ScanFormat = "pdf" | "image"

/** The same limit as a score upload: a phone photo fits, a whole songbook does not. */
export const MAX_SCAN_BYTES = 20 * 1024 * 1024

/** PDF pages read from one file; a song's chart is one or two. */
export const MAX_SCAN_PAGES = 10

/** What `bytes` start like: a PDF, a PNG, JPEG, TIFF, WebP or BMP image, or neither (null). */
export function scanFormat(bytes: Uint8Array): ScanFormat | null {
  if (startsWith(bytes, 0, "%PDF-")) return "pdf"
  const image =
    startsWith(bytes, 0, "\u0089PNG") ||
    startsWith(bytes, 0, "ÿØÿ") ||
    startsWith(bytes, 0, "II*\u0000") ||
    startsWith(bytes, 0, "MM\u0000*") ||
    (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) ||
    startsWith(bytes, 0, "BM")
  return image ? "image" : null
}

type Line = { readonly top: number; readonly words: ReadonlyArray<WordBox> }

/** The lines of a page top to bottom, each with its words left to right. */
function linesOf(words: ReadonlyArray<WordBox>): Array<Line> {
  return [...Map.groupBy(words, (word) => word.line).values()]
    .map((line) => ({ top: Math.min(...line.map((w) => w.top)), words: line.toSorted((a, b) => a.left - b.left) }))
    .toSorted((a, b) => a.top - b.top)
}

function layoutPage(lines: ReadonlyArray<Line>): string {
  const pitch = median(lines.slice(1).map((line, i) => line.top - lines[i]!.top))
  const charWidth = median(lines.flatMap((line) => line.words.map((w) => (w.right - w.left) / w.text.length)))
  const margin = Math.min(...lines.map((line) => line.words[0]!.left))
  const textOf = (line: Line) => line.words.map((w) => w.text).join(" ")
  const out: Array<string> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (i > 0 && line.top - lines[i - 1]!.top > pitch * 1.5) out.push("")
    const next = lines[i + 1]
    if (!isChordLine(textOf(line))) {
      out.push(line.words.map((w) => fixLyricWord(w.text)).join(" "))
    } else if (next && next.top - line.top <= pitch * 1.5 && !isChordLine(textOf(next))) {
      out.push(chordRow(line.words.map((chord) => ({ chord: chord.text, column: columnUnder(chord.left, next.words, charWidth) }))))
      out.push(next.words.map((w) => fixLyricWord(w.text)).join(" "))
      i++
    } else {
      // A chord-only line (an intro or turnaround) has no lyrics to line up with, so keep its spacing.
      out.push(chordRow(line.words.map((chord) => ({ chord: chord.text, column: Math.round((chord.left - margin) / charWidth) }))))
    }
  }
  return out.join("\n")
}

/**
 * The character of the lyric line (words joined by single spaces) under `x`.
 * Inside a word, the position is interpolated across the word's width; between
 * words, it is the start of the next word; past the end, it counts on in
 * average character widths.
 */
function columnUnder(x: number, lyric: ReadonlyArray<WordBox>, charWidth: number): number {
  let start = 0
  for (const word of lyric) {
    if (x < word.right) {
      if (x <= word.left) return start
      const fraction = (x - word.left) / (word.right - word.left)
      return start + Math.min(word.text.length - 1, Math.round(fraction * word.text.length))
    }
    start += word.text.length + 1
  }
  const last = lyric[lyric.length - 1]
  return start + (last ? Math.max(0, Math.round((x - last.right) / charWidth) - 1) : 0)
}

/** Chords at their columns, each moved right where needed to keep a space after the one before. */
function chordRow(chords: ReadonlyArray<{ chord: string; column: number }>): string {
  let row = ""
  for (const { chord, column } of chords) {
    row = (row === "" ? row.padEnd(column) : row.padEnd(Math.max(column, row.length + 1))) + chord
  }
  return row
}

/** Tesseract reads a capital I in a sans-serif font as a bar; in a lyric line a lone bar is that I. */
function fixLyricWord(word: string): string {
  return word === "|" ? "I" : word
}

function decodeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, name: string) =>
    name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name]!,
  )
}

function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return Infinity
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}
