/**
 * The lyrics chart as the editor sees it: lines, each either a ChordPro
 * directive or a lyric with chords placed at columns.
 *
 * Every edit returns the new chart and the change set that turns the old
 * anchor text into the new one (docs/adr/0001). The editor knows exactly what
 * it changed, so marks anchored in the chart follow an edit without guessing.
 *
 * The anchor text is the chart's text with each chord written `[C]` where it
 * sits, lines joined by newlines; a section start contributes its label. It is
 * derived from the stored text, never stored.
 */
import { composeChanges, type Change } from "./changes"

export type PlacedChord = { readonly at: number; readonly chord: string }

export type DocLine =
  | { readonly kind: "directive"; readonly raw: string }
  | { readonly kind: "lyrics"; readonly text: string; readonly chords: ReadonlyArray<PlacedChord> }

export type ChartDoc = ReadonlyArray<DocLine>

/** An edited chart and the change set from the anchor text before the edit to the one after it. */
export type Edit = { readonly doc: ChartDoc; readonly changes: Array<Change> }

/** A stretch of a lyric line a chord can be dropped on: a word with the space after it. */
export type Segment = { readonly start: number; readonly end: number; readonly chords: ReadonlyArray<number> }

// ---------------------------------------------------------------------------
// Text <-> chart

export function parseDoc(source: string): ChartDoc {
  return source.split("\n").map((line): DocLine => {
    if (/^\{.*\}$/.test(line)) return { kind: "directive", raw: line }
    const chords: Array<PlacedChord> = []
    let text = ""
    let at = 0
    for (const match of line.matchAll(/\[([^\]]*)\]/g)) {
      text += line.slice(at, match.index)
      chords.push({ at: text.length, chord: match[1]! })
      at = match.index + match[0].length
    }
    return { kind: "lyrics", text: text + line.slice(at), chords }
  })
}

export function serializeDoc(doc: ChartDoc): string {
  return doc.map(lineSource).join("\n")
}

function lineSource(line: DocLine): string {
  if (line.kind === "directive") return line.raw
  return withChords(line.text, line.chords)
}

/** The text with `[chord]` written at each chord's column. */
function withChords(text: string, chords: ReadonlyArray<PlacedChord>): string {
  let result = ""
  let at = 0
  for (const { at: column, chord } of chords) {
    result += text.slice(at, column) + `[${chord}]`
    at = column
  }
  return result + text.slice(at)
}

/** The anchor text of the whole chart. */
export function anchorText(doc: ChartDoc): string {
  return doc.map(anchorLine).join("\n")
}

function anchorLine(line: DocLine): string {
  if (line.kind === "lyrics") return withChords(line.text, line.chords)
  const match = /^\{\s*(start_of_\w+|comment|c)\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw)
  return match ? (match[2] ?? "") : ""
}

/** The word-sized stretches of a lyric line, split further where a chord sits inside a word. */
export function segments(line: Extract<DocLine, { kind: "lyrics" }>): ReadonlyArray<Segment> {
  const starts = new Set<number>([0])
  for (const match of line.text.matchAll(/\S+/g)) starts.add(match.index)
  for (const { at } of line.chords) starts.add(at)
  const breaks = [...starts].sort((a, b) => a - b)
  return breaks.map((start, i) => {
    const end = breaks[i + 1] ?? line.text.length
    const chords = line.chords.flatMap((c, index) => (c.at >= start && (c.at < end || (i === breaks.length - 1 && c.at === end)) ? [index] : []))
    return { start, end, chords }
  })
}

// ---------------------------------------------------------------------------
// Edits

/**
 * Puts `chord` on the stretch of `lineIndex` that starts at column `at`,
 * replacing the chord already there.
 */
export function placeChord(doc: ChartDoc, lineIndex: number, at: number, chord: string): Edit {
  const line = lyricsLine(doc, lineIndex)
  const column = Math.max(0, Math.min(at, line.text.length))
  const existing = line.chords.findIndex((c) => c.at === column)
  if (existing >= 0 && line.chords[existing]!.chord === chord) return { doc, changes: [] }

  const index = existing >= 0 ? existing : line.chords.filter((c) => c.at < column).length
  const from = lineStart(doc, lineIndex) + chordOffset(line, index, column)
  const chords = existing >= 0
    ? line.chords.map((c, i) => (i === existing ? { at: column, chord } : c))
    : [...line.chords.slice(0, index), { at: column, chord }, ...line.chords.slice(index)]
  const replaced = existing >= 0 ? line.chords[existing]!.chord.length + 2 : 0
  return {
    doc: replaceLine(doc, lineIndex, { ...line, chords }),
    changes: [{ from, to: from + replaced, insert: chord.length + 2 }],
  }
}

export function removeChord(doc: ChartDoc, lineIndex: number, chordIndex: number): Edit {
  const line = lyricsLine(doc, lineIndex)
  const removed = line.chords[chordIndex]
  if (!removed) return { doc, changes: [] }
  const from = lineStart(doc, lineIndex) + chordOffset(line, chordIndex, removed.at)
  return {
    doc: replaceLine(doc, lineIndex, { ...line, chords: line.chords.filter((_, i) => i !== chordIndex) }),
    changes: [{ from, to: from + removed.chord.length + 2, insert: 0 }],
  }
}

/** Takes a chord off one stretch and drops it on another, possibly on another line. */
export function moveChord(
  doc: ChartDoc,
  source: { line: number; chord: number },
  target: { line: number; at: number },
): Edit {
  const line = lyricsLine(doc, source.line)
  const picked = line.chords[source.chord]
  if (!picked) return { doc, changes: [] }
  if (source.line === target.line && picked.at === target.at) return { doc, changes: [] }
  const removed = removeChord(doc, source.line, source.chord)
  const placed = placeChord(removed.doc, target.line, target.at, picked.chord)
  return { doc: placed.doc, changes: composeChanges(removed.changes, placed.changes) }
}

/**
 * Replaces the lyrics of a line. Chords stay on the text around the edit; a
 * chord inside the replaced stretch moves to its start, and a chord where text
 * is only inserted goes with the text after it. The change is the
 * common-prefix-and-suffix replacement, which is exact except where the edit
 * sits inside a repeat within the one line.
 */
export function editLyrics(doc: ChartDoc, lineIndex: number, text: string): Edit {
  const line = lyricsLine(doc, lineIndex)
  if (text === line.text) return { doc, changes: [] }
  const keep = commonEnds(line.text, text)
  const shift = text.length - line.text.length
  const replacedEnd = line.text.length - keep.suffix
  // A chord at the very start of text that is only being inserted before goes
  // with the text after it; a chord on text being replaced stays at its start.
  const chords = line.chords.map((c) => ({
    ...c,
    at: c.at < keep.prefix || (c.at === keep.prefix && replacedEnd > keep.prefix) ? c.at : c.at >= replacedEnd ? c.at + shift : keep.prefix,
  }))
  const next = { ...line, text, chords }
  const edited = replaceLine(doc, lineIndex, next)
  const [change] = commonEnds(anchorLine(line), anchorLine(next)).change
  const base = lineStart(doc, lineIndex)
  return { doc: edited, changes: change ? [{ from: base + change.from, to: base + change.to, insert: change.insert }] : [] }
}

/** Adds an empty lyric line after `lineIndex`. */
export function insertLineAfter(doc: ChartDoc, lineIndex: number): Edit {
  const empty: DocLine = { kind: "lyrics", text: "", chords: [] }
  const next = [...doc.slice(0, lineIndex + 1), empty, ...doc.slice(lineIndex + 1)]
  const at = lineStart(next, lineIndex + 1)
  // The new line's separator goes before it, so the last line needs no trailing newline.
  return lineIndex === doc.length - 1
    ? { doc: next, changes: [{ from: at - 1, to: at - 1, insert: 1 }] }
    : { doc: next, changes: [{ from: at, to: at, insert: 1 }] }
}

/** Deletes a lyric line with the newline that separates it from its neighbour. */
export function deleteLine(doc: ChartDoc, lineIndex: number): Edit {
  lyricsLine(doc, lineIndex)
  const next = doc.filter((_, i) => i !== lineIndex)
  const start = lineStart(doc, lineIndex)
  const length = anchorLine(doc[lineIndex]!).length
  return lineIndex === doc.length - 1 && lineIndex > 0
    ? { doc: next, changes: [{ from: start - 1, to: start + length, insert: 0 }] }
    : { doc: next, changes: [{ from: start, to: start + length + 1, insert: 0 }] }
}

/** Renames a section; the label is the anchor text of its start line. */
export function renameSection(doc: ChartDoc, lineIndex: number, label: string): Edit {
  const line = doc[lineIndex]
  const match = line?.kind === "directive" ? /^\{\s*(start_of_\w+)\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw) : null
  if (!match) throw new Error(`line ${lineIndex} is not a section start`)
  const clean = label.replace(/[{}[\]\n]/g, " ").trim()
  const old = match[2] ?? ""
  if (clean === old) return { doc, changes: [] }
  const from = lineStart(doc, lineIndex)
  return {
    doc: replaceLine(doc, lineIndex, { kind: "directive", raw: clean ? `{${match[1]}: ${clean}}` : `{${match[1]}}` }),
    changes: [{ from, to: from + old.length, insert: clean.length }],
  }
}

/** The section a line sits in: its label, or null before the first section. */
export function sectionLabel(doc: ChartDoc, lineIndex: number): string | null {
  for (let i = lineIndex; i >= 0; i--) {
    const line = doc[i]!
    if (line.kind === "directive" && /^\{\s*start_of_/.test(line.raw)) return anchorLine(line)
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers

function lyricsLine(doc: ChartDoc, index: number): Extract<DocLine, { kind: "lyrics" }> {
  const line = doc[index]
  if (line?.kind !== "lyrics") throw new Error(`line ${index} is not a lyric line`)
  return line
}

function replaceLine(doc: ChartDoc, index: number, line: DocLine): ChartDoc {
  return doc.map((existing, i) => (i === index ? line : existing))
}

/** Offset of a line's first character in the anchor text. */
function lineStart(doc: ChartDoc, index: number): number {
  let at = 0
  for (let i = 0; i < index; i++) at += anchorLine(doc[i]!).length + 1
  return at
}

/** Offset within a line's anchor text of the `[` of the chord at `index`, which sits at `column`. */
function chordOffset(line: Extract<DocLine, { kind: "lyrics" }>, index: number, column: number): number {
  return column + line.chords.slice(0, index).reduce((n, c) => n + c.chord.length + 2, 0)
}

/** How much of two strings is shared at the start and the end, and the one replacement between them. */
function commonEnds(before: string, after: string): { prefix: number; suffix: number; change: Array<Change> } {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  const change = before === after ? [] : [{ from: prefix, to: before.length - suffix, insert: after.length - prefix - suffix }]
  return { prefix, suffix, change }
}
