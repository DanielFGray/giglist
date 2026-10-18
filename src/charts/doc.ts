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
import { composeChanges, rearranged, type Change, type Part } from "./changes"
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
  return removeLineAt(doc, lineIndex)
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

/** Puts a score link (docs/adr/0004) below the line at `lineIndex`. `value` is the directive's text after `score:`. */
export function addScoreLink(doc: ChartDoc, lineIndex: number, value: string): Edit {
  return insertLineAt(doc, lineIndex + 1, directive("score", value))
}

/** alphaTex as literal lines. A line that looks like a directive would end the block, so it is indented. */
function literalLines(tex: string): ReadonlyArray<DocLine> {
  return tex.split("\n").map((text) => ({ kind: "literal", text: /^\{.*\}$/.test(text) ? ` ${text}` : text }))
}

/**
 * The lines a handle moves as one: a section from its start line through its
 * end line (or through the line before the next section, when it has no end),
 * with the loose lines after its end line, up to the next section: any line
 * that is not a section start (comments, blank lines, lyrics) belongs to the
 * section above. A line inside a tab or a phrase
 * stands for that whole section. Any other line is a block of its own.
 */
export function blockRange(doc: ChartDoc, lineIndex: number): { start: number; end: number } {
  const open = enclosingSection(doc, lineIndex)
  const start = open && isLiteralStart(`start_of_${open.kind}`) ? open.start : lineIndex
  const line = doc[start]
  if (!line) throw new Error(`line ${lineIndex} is not in the chart`)
  if (!isStart(line)) return { start, end: start }
  let end = sectionEnd(doc, start)
  while (end + 1 < doc.length && !isStart(doc[end + 1]!)) end++
  return { start, end }
}

/** The last line of the section that starts at `start`: its end line, or the line before the next section when it has none. */
function sectionEnd(doc: ChartDoc, start: number): number {
  const block = sectionBlock(doc, start)
  if (block.closed) return block.end
  let end = start
  while (end + 1 < doc.length && !isStart(doc[end + 1]!)) end++
  return end
}

/** Whether the editor gives the line a handle: a lyric line, the start of a section, or a score link. */
export function hasHandle(doc: ChartDoc, lineIndex: number): boolean {
  const line = doc[lineIndex]
  return line !== undefined && (line.kind === "lyrics" || isStart(line) || directiveName(line) === "score")
}

/**
 * The two slots a drop on the line's row can mean: before the row, or after it.
 * A section's heading is followed by the section's first line; a tab or a phrase,
 * which nothing can enter, is followed by whatever comes after its end line.
 */
export function dropSlots(doc: ChartDoc, lineIndex: number): { before: number; after: number } {
  const { start } = blockRange(doc, lineIndex)
  if (!isStart(doc[start]!)) return { before: start, after: start + 1 }
  return { before: start, after: isLiteralStart(directiveName(doc[start]!)) ? sectionEnd(doc, start) + 1 : start + 1 }
}

/**
 * Whether the block at `lineIndex` can move to stand before line `destination`
 * (`doc.length` is the end). It cannot stay where it is, go inside a tab or a
 * phrase, or, for a section, go inside another section.
 */
export function canMoveBlockTo(doc: ChartDoc, lineIndex: number, destination: number): boolean {
  const { start, end } = blockRange(doc, lineIndex)
  if (destination < 0 || destination > doc.length || (destination >= start && destination <= end + 1)) return false
  const open = enclosingSection(doc, destination)
  if (open && isLiteralStart(`start_of_${open.kind}`)) return false
  if (!isStart(doc[start]!)) return true
  return doc.every((line, i) => !isStart(line) || i === start || destination <= i || destination > sectionEnd(doc, i))
}

/**
 * Moves the block at `lineIndex` to stand before line `destination`. The text
 * is removed and written again; the insertion records the removed anchor text as
 * its source, so marks inside the block follow it.
 */
export function moveBlockTo(doc: ChartDoc, lineIndex: number, destination: number): Edit {
  if (!canMoveBlockTo(doc, lineIndex, destination)) return { doc, changes: [] }
  const { start, end } = blockRange(doc, lineIndex)
  const indexes = doc.map((_, i) => i)
  const block = indexes.slice(start, end + 1)
  const rest = indexes.filter((i) => i < start || i > end)
  const at = destination < start ? destination : destination - block.length
  return reorder(doc, [...rest.slice(0, at), ...block, ...rest.slice(at)])
}

/**
 * Moves a block one step (-1 up, 1 down). A section steps past its neighbouring
 * section. A line steps past its neighbouring line, or across a section's start or
 * end line, which takes it out of or into that section; a tab or a phrase beside
 * it counts as one line. A step and the opposite step restore the chart.
 */
export function moveBlock(doc: ChartDoc, lineIndex: number, delta: -1 | 1): Edit {
  const { start, end } = blockRange(doc, lineIndex)
  if (isStart(doc[start]!)) {
    const starts = doc.flatMap((l, i) => (isStart(l) ? [i] : []))
    const neighbour = starts[starts.indexOf(start) + delta]
    if (neighbour === undefined) return { doc, changes: [] }
    return moveBlockTo(doc, start, delta === 1 ? blockRange(doc, neighbour).end + 1 : neighbour)
  }
  const beside = doc[delta === 1 ? end + 1 : start - 1]
  if (!beside) return { doc, changes: [] }
  const name = directiveName(beside)
  if (delta === 1) return moveBlockTo(doc, start, (isLiteralStart(name) ? sectionEnd(doc, end + 1) : end + 1) + 1)
  return moveBlockTo(doc, start, isLiteralEnd(name) ? blockRange(doc, start - 1).start : start - 1)
}

/** Writes a copy of the block at `lineIndex` right after it. The copy is new text, with no source. */
export function duplicateBlock(doc: ChartDoc, lineIndex: number): Edit {
  const { start, end } = blockRange(doc, lineIndex)
  const lines = doc.slice(start, end + 1)
  return chain(doc, lines.map((line, i) => (d: ChartDoc) => insertLineAt(d, end + 1 + i, line)))
}

/** Deletes the block at `lineIndex`: for a section, its lines too. */
export function deleteBlock(doc: ChartDoc, lineIndex: number): Edit {
  const { start, end } = blockRange(doc, lineIndex)
  return chain(doc, Array.from({ length: end - start + 1 }, () => (d: ChartDoc) => removeLineAt(d, start)))
}

/**
 * The chart with its lines in the order of `order`, each an index of `doc`, and the change set that moves the text.
 * The text has no newline at its end. A line that stops being last needs one, and takes the newline of the
 * line that becomes last, so no newline is new text and a step and its inverse leave no change.
 */
function reorder(doc: ChartDoc, order: ReadonlyArray<number>): Edit {
  const starts = doc.map((_, i) => lineStart(doc, i))
  const newline = (old: number): Part => ({ from: starts[old]! + anchorLine(doc[old]!).length, n: 1 })
  const lastLine = doc.length - 1
  const parts = order.flatMap((old, position): Array<Part> => {
    const text = { from: starts[old]!, n: anchorLine(doc[old]!).length }
    if (position === order.length - 1) return [text]
    return [text, newline(old === lastLine ? order.at(-1)! : old)]
  })
  return { doc: order.map((old) => doc[old]!), changes: rearranged(anchorText(doc).length, parts) }
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
  const length = anchorLine(doc[index]!).length
  // The chart never holds no lines: removing the last one leaves an empty lyric line, which is what "" parses to.
  if (doc.length === 1) {
    return { doc: [{ kind: "lyrics", text: "", chords: [] }], changes: length > 0 ? [{ from: 0, to: length, insert: 0 }] : [] }
  }
  const next = doc.filter((_, i) => i !== index)
  const start = lineStart(doc, index)
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
