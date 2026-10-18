/**
 * The lyrics chart as the editor sees it: lines, each a ChordPro directive, a
 * lyric with chords placed at columns, or a literal line: a line of tab or of
 * a phrase's notation, kept as written.
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
import { isLiteralEnd, isLiteralStart, isPhraseStart } from "./lyrics"

export type PlacedChord = { readonly at: number; readonly chord: string }

export type DocLine =
  | { readonly kind: "directive"; readonly raw: string }
  | { readonly kind: "lyrics"; readonly text: string; readonly chords: ReadonlyArray<PlacedChord> }
  /** A line inside a tab section or a phrase: brackets in it are notation, not chords. */
  | { readonly kind: "literal"; readonly text: string }

export type ChartDoc = ReadonlyArray<DocLine>

/** An edited chart and the change set from the anchor text before the edit to the one after it. */
export type Edit = { readonly doc: ChartDoc; readonly changes: Array<Change> }

/** A stretch of a lyric line a chord can be dropped on: a word with the space after it. */
export type Segment = { readonly start: number; readonly end: number; readonly chords: ReadonlyArray<number> }

// ---------------------------------------------------------------------------
// Text <-> chart

export function parseDoc(source: string): ChartDoc {
  let literal = false
  return source.split("\n").map((line): DocLine => {
    if (/^\{.*\}$/.test(line)) {
      const directive: DocLine = { kind: "directive", raw: line }
      const name = directiveName(directive)
      if (isLiteralStart(name)) literal = true
      else if (isLiteralEnd(name)) literal = false
      return directive
    }
    if (literal) return { kind: "literal", text: line }
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
  if (line.kind === "literal") return line.text
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

export function anchorLine(line: DocLine): string {
  if (line.kind === "lyrics") return withChords(line.text, line.chords)
  if (line.kind === "literal") return line.text
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
 * Replaces the text of a lyric or literal line. On a lyric line, chords stay on
 * the text around the edit; a chord inside the replaced stretch moves to its
 * start, and a chord where text is only inserted goes with the text after it. The change is the
 * common-prefix-and-suffix replacement, which is exact except where the edit
 * sits inside a repeat within the one line.
 */
export function editLine(doc: ChartDoc, lineIndex: number, text: string): Edit {
  const literal = doc[lineIndex]
  if (literal?.kind === "literal") {
    if (text === literal.text) return { doc, changes: [] }
    const [change] = commonEnds(literal.text, text).change
    const base = lineStart(doc, lineIndex)
    return {
      doc: replaceLine(doc, lineIndex, { kind: "literal", text }),
      changes: change ? [{ from: base + change.from, to: base + change.to, insert: change.insert }] : [],
    }
  }
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

/** Deletes a lyric or literal line with the newline that separates it from its neighbour. */
export function deleteLine(doc: ChartDoc, lineIndex: number): Edit {
  if (doc[lineIndex]?.kind !== "literal") lyricsLine(doc, lineIndex)
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

/**
 * Starts a section at `lineIndex`. Inside a section it splits it in two of the
 * same kind, so the section's own end line closes the new half; elsewhere it
 * opens a verse that ends before the next directive or at the end of the chart.
 */
export function addSection(doc: ChartDoc, lineIndex: number, label: string): Edit {
  const clean = cleanLabel(label)
  const open = enclosingSection(doc, lineIndex)
  if (open) {
    return chain(doc, [
      (d) => insertLineAt(d, lineIndex, directive(`end_of_${open.kind}`)),
      (d) => insertLineAt(d, lineIndex + 1, directive(`start_of_${open.kind}`, clean)),
    ])
  }
  return chain(doc, [
    (d) => insertLineAt(d, lineIndex, directive("start_of_verse", clean)),
    (d) => {
      let end = lineIndex + 1
      while (end < d.length && d[end]!.kind !== "directive") end++
      return insertLineAt(d, end, directive("end_of_verse"))
    },
  ])
}

/**
 * Removes a section's start and end lines; its lines stay where they are. A
 * tab section or a phrase goes with its lines, since literal lines exist only
 * inside one.
 */
export function removeSection(doc: ChartDoc, lineIndex: number): Edit {
  const block = sectionBlock(doc, lineIndex)
  if (isLiteralStart(directiveName(doc[lineIndex]!))) {
    const last = block.closed ? block.end : lineIndex + countLiteral(doc, lineIndex + 1)
    return chain(doc, Array.from({ length: last - lineIndex + 1 }, () => (d: ChartDoc) => removeLineAt(d, lineIndex)))
  }
  const steps = [(d: ChartDoc) => removeLineAt(d, block.end), (d: ChartDoc) => removeLineAt(d, block.start)]
  return chain(doc, block.closed ? steps : steps.slice(1))
}

/** The name of a directive line (`start_of_tab` for `{start_of_tab: Intro}`), or "" for any other line. */
export function directiveName(line: DocLine): string {
  return line.kind === "directive" ? (/^\{\s*(\w+)/.exec(line.raw)?.[1] ?? "") : ""
}

/** How many literal lines follow from `index` on. */
function countLiteral(doc: ChartDoc, index: number): number {
  let n = 0
  while (doc[index + n]?.kind === "literal") n++
  return n
}

/** True for a line of a phrase's notation, which the editor shows as the drawn phrase. */
export function inPhrase(doc: ChartDoc, lineIndex: number): boolean {
  const open = enclosingSection(doc, lineIndex)
  return open !== null && isPhraseStart(`start_of_${open.kind}`)
}

/** The phrase whose start line is at `lineIndex`: its name and its alphaTex. */
export function phraseAt(doc: ChartDoc, lineIndex: number): { name: string; tex: string } {
  const line = doc[lineIndex]!
  if (!isPhraseStart(directiveName(line))) throw new Error(`line ${lineIndex} is not a phrase`)
  const n = countLiteral(doc, lineIndex + 1)
  const tex = doc.slice(lineIndex + 1, lineIndex + 1 + n).map((l) => (l.kind === "literal" ? l.text : ""))
  return { name: anchorLine(line), tex: tex.join("\n") }
}

/**
 * Puts a phrase after the line at `lineIndex`. Sections do not nest, so inside
 * a section the phrase splits it, and the second half continues with no label;
 * after a section's last line the phrase goes after the section.
 */
export function addPhrase(doc: ChartDoc, lineIndex: number, name: string, tex: string): Edit {
  const open = enclosingSection(doc, lineIndex + 1)
  const next = doc[lineIndex + 1]
  const atEnd = open !== null && next !== undefined && directiveName(next) === `end_of_${open.kind}`
  const at = atEnd ? lineIndex + 2 : lineIndex + 1
  const block = [directive("start_of_textblock", cleanLabel(name)), ...literalLines(tex), directive("end_of_textblock")]
  const split = open && !atEnd ? [directive(`end_of_${open.kind}`), ...block, directive(`start_of_${open.kind}`)] : block
  return chain(doc, split.map((line, i) => (d: ChartDoc) => insertLineAt(d, at + i, line)))
}

/** Gives the phrase whose start line is at `lineIndex` a new name and new alphaTex. */
export function setPhrase(doc: ChartDoc, lineIndex: number, name: string, tex: string): Edit {
  const old = countLiteral(doc, lineIndex + 1)
  const lines = literalLines(tex)
  return chain(doc, [
    (d) => renameSection(d, lineIndex, name),
    ...Array.from({ length: old }, () => (d: ChartDoc) => removeLineAt(d, lineIndex + 1)),
    ...lines.map((line, i) => (d: ChartDoc) => insertLineAt(d, lineIndex + 1 + i, line)),
  ])
}

/** alphaTex as literal lines. A line that looks like a directive would end the block, so it is indented. */
function literalLines(tex: string): ReadonlyArray<DocLine> {
  return tex.split("\n").map((text) => ({ kind: "literal", text: /^\{.*\}$/.test(text) ? ` ${text}` : text }))
}

/**
 * Moves a section past its neighbouring section (-1 up, 1 down). The text is
 * removed and written again. The insertion records the removed anchor text as
 * its source, so marks inside the moved section follow it.
 */
export function moveSection(doc: ChartDoc, lineIndex: number, delta: -1 | 1): Edit {
  const block = sectionBlock(doc, lineIndex)
  const starts = doc.flatMap((l, i) => (isStart(l) ? [i] : []))
  const neighbour = starts[starts.indexOf(lineIndex) + delta]
  if (neighbour === undefined) return { doc, changes: [] }
  const lines = doc.slice(block.start, block.end + 1)
  const other = sectionBlock(doc, neighbour)
  const count = lines.length
  const edit = chain(doc, [
    ...lines.map(() => (d: ChartDoc) => removeLineAt(d, block.start)),
    ...lines.map((line, i) => (d: ChartDoc) => {
      const base = delta === 1 ? other.end + 1 - count : other.start
      return insertLineAt(d, base + i, line)
    }),
  ])
  const blockStart = anchorOffset(doc, block.start)
  const blockEnd = anchorOffset(doc, block.end + 1)
  const lastBlock = blockEnd === anchorText(doc).length
  const destination = anchorOffset(doc, delta === 1 ? other.end + 1 : other.start) - (lastBlock && delta === -1 ? 1 : 0)
  const atEnd = destination === anchorText(doc).length
  const sourceStart = atEnd || (lastBlock && delta === -1) ? blockStart - 1 : blockStart
  const sourceEnd = atEnd && delta === 1 ? blockEnd - 1 : blockEnd
  const deleteStart = sourceStart
  const move = { from: deleteStart, to: sourceEnd, insert: 0 }
  const copy = { from: destination, to: destination, insert: sourceEnd - sourceStart, source: sourceStart }
  return { doc: edit.doc, changes: delta === 1 ? [move, copy] : [copy, move] }
}

/** The section a line sits in: its label, or null before the first section. */
export function sectionLabel(doc: ChartDoc, lineIndex: number): string | null {
  for (let i = lineIndex; i >= 0; i--) {
    const line = doc[i]!
    if (line.kind === "directive" && /^\{\s*start_of_/.test(line.raw)) return anchorLine(line)
  }
  return null
}

function anchorOffset(doc: ChartDoc, lineIndex: number): number {
  if (lineIndex >= doc.length) return anchorText(doc).length
  return doc.slice(0, lineIndex).reduce((length, line) => length + anchorLine(line).length + 1, 0)
}

// ---------------------------------------------------------------------------
// Helpers

/** `{name}` or `{name: label}`. */
function directive(name: string, label?: string): DocLine {
  return { kind: "directive", raw: label ? `{${name}: ${label}}` : `{${name}}` }
}

function cleanLabel(label: string): string {
  return label.replace(/[{}[\]\n]/g, " ").trim()
}

const isStart = (line: DocLine) => line.kind === "directive" && /^\{\s*start_of_\w+/.test(line.raw)

/** The section that `lineIndex` is inside (after its start line, before its end), or null. */
export function enclosingSection(doc: ChartDoc, lineIndex: number): { start: number; kind: string } | null {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = doc[i]!
    if (line.kind !== "directive") continue
    if (/^\{\s*end_of_/.test(line.raw)) return null
    const start = /^\{\s*start_of_(\w+)/.exec(line.raw)
    if (start) return { start: i, kind: start[1]! }
  }
  return null
}

/** The lines of the section whose start is at `lineIndex`: through its end line, or before the next start when it has none. */
function sectionBlock(doc: ChartDoc, lineIndex: number): { start: number; end: number; closed: boolean } {
  const line = doc[lineIndex]
  if (!line || !isStart(line)) throw new Error(`line ${lineIndex} is not a section start`)
  for (let i = lineIndex + 1; i < doc.length; i++) {
    const next = doc[i]!
    if (next.kind !== "directive") continue
    if (/^\{\s*end_of_/.test(next.raw)) return { start: lineIndex, end: i, closed: true }
    if (isStart(next)) break
  }
  return { start: lineIndex, end: lineIndex, closed: false }
}

/** Puts `line` at `index`, with the newline that separates it from its neighbour. */
function insertLineAt(doc: ChartDoc, index: number, line: DocLine): Edit {
  const next = [...doc.slice(0, index), line, ...doc.slice(index)]
  const length = anchorLine(line).length + 1
  // At the end the separator goes before the new line, so the last line needs no trailing newline.
  const at = index === doc.length ? lineStart(next, index) - 1 : lineStart(next, index)
  return { doc: next, changes: [{ from: at, to: at, insert: length }] }
}

/** Removes the line at `index` with the newline that separates it from its neighbour. */
function removeLineAt(doc: ChartDoc, index: number): Edit {
  const next = doc.filter((_, i) => i !== index)
  const start = lineStart(doc, index)
  const length = anchorLine(doc[index]!).length
  return index === doc.length - 1 && index > 0
    ? { doc: next, changes: [{ from: start - 1, to: start + length, insert: 0 }] }
    : { doc: next, changes: [{ from: start, to: start + length + 1, insert: 0 }] }
}

/** Runs edits one after another and gives their change sets as one. */
function chain(doc: ChartDoc, steps: ReadonlyArray<(doc: ChartDoc) => Edit>): Edit {
  return steps.reduce<Edit>(
    (done, step) => {
      const edit = step(done.doc)
      return { doc: edit.doc, changes: composeChanges(done.changes, edit.changes) }
    },
    { doc, changes: [] },
  )
}

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
