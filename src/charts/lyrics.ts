/**
 * Lyrics charts: chords placed over words.
 *
 * A lyrics chart is stored as ChordPro text (docs/adr/0002). Players paste
 * chords over lyrics; `importPasted` turns that into the stored text, and
 * `exportChords` turns it back. Directives and alphaTex pass through both as
 * written, so a power user can write them. `renderLyrics` turns stored text into plain data
 * a view can draw, transposed to the key the player needs.
 *
 * Pure and free of the DOM, so the server and the browser share it.
 */
import { ChordLyricsPair, ChordProParser, Literal, Tag } from "chordsheetjs"
import { anchorLine, enclosingSection, inPhrase, parseDoc } from "./doc"

/**
 * One drawable piece of a chart line. `start` and `end` are its range in the
 * anchor text of the stored chart (see doc.ts), which marks anchor to; they do
 * not change when the chart is shown in another key.
 */
export type ChartItem = { readonly start: number; readonly end: number } & (
  | { kind: "pair"; chord: string; lyric: string }
  /** `writtenIn` is set on a tab section drawn in another key: its tab is shown as written, in that key. */
  | { kind: "section"; label: string; writtenIn?: string }
  | { kind: "comment"; text: string }
  /** A line of ASCII tab, kept exactly as written: its columns are the music. */
  | { kind: "tab"; text: string }
  /**
   * A phrase: `tex` is its alphaTex (docs/adr/0003). Its range covers its
   * name and every line of its notation. `writtenIn` is set when the chart is
   * drawn in another key, since the notation is drawn as written.
   */
  | { kind: "phrase"; name: string; tex: string; writtenIn?: string }
)

/**
 * A drawn chart line; an empty one is a blank line. A directive that draws
 * nothing (`{key}`, a section's end) gives no line, and a phrase's lines give
 * one line holding the phrase.
 */
export type ChartLine = ReadonlyArray<ChartItem>

/**
 * The stored chart, drawn in `shownKey`.
 *
 * ChordSheetJS moves every chord by the interval between the written key and
 * the shown key and keeps each chord's quality, so a shown key in the other
 * mode gives the same chords moved by that interval. A chart with no written
 * key cannot move and is returned as written.
 */
export function renderLyrics(source: string, shownKey?: string | null): ReadonlyArray<ChartLine> {
  const stored = new ChordProParser().parse(source)
  const song = stored.key && shownKey && shownKey !== stored.key ? stored.changeKey(shownKey) : stored
  const writtenIn = song === stored ? {} : { writtenIn: stored.key! }
  const lines: Array<ChartLine> = []
  // The phrase whose lines are being read, from its start line to its end line.
  let phrase: { name: string; tex: Array<string>; start: number; end: number } | null = null
  const closePhrase = () => {
    if (!phrase) return
    lines.push([{ kind: "phrase", name: phrase.name, tex: phrase.tex.join("\n"), start: phrase.start, end: phrase.end, ...writtenIn }])
    phrase = null
  }
  let offset = 0
  song.lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) offset += 1
    const items = line.items.flatMap((item, itemIndex): ReadonlyArray<ChartItem> => {
      // Ranges come from the stored chart: a transposed chord may be longer or shorter.
      const start = offset
      const written = stored.lines[lineIndex]!.items[itemIndex]
      offset += anchorSegment(written).length
      if (item instanceof Tag && isPhraseStart(item.name)) {
        phrase = { name: item.label || item.value, tex: [], start, end: offset }
        return []
      }
      if (phrase && item instanceof Literal) {
        phrase.tex.push(item.string)
        phrase.end = offset
        return []
      }
      if (item instanceof Tag && item.isSectionEnd()) closePhrase()
      // ChordSheetJS transposes chord names in a tab line too; tab is shown as written, chords and frets alike.
      const shown = toItem(item instanceof Literal ? written : item, start, offset)
      return item instanceof Tag && isTabStart(item.name) ? shown.map((i) => ({ ...i, ...writtenIn })) : shown
    })
    if (items.length > 0 || (line.items.length === 0 && !phrase)) lines.push(items)
  })
  closePhrase()
  return lines
}

/** The distinct chord names of a rendered chart, in the order each first appears. */
export function chartChords(lines: ReadonlyArray<ChartLine>): ReadonlyArray<string> {
  const seen = new Set<string>()
  const result: Array<string> = []
  for (const line of lines) {
    for (const item of line) {
      if (item.kind !== "pair") continue
      const chord = item.chord.trim()
      if (chord === "") continue
      if (seen.has(chord)) continue
      seen.add(chord)
      result.push(chord)
    }
  }
  return result
}

/** The text one item contributes to the anchor text. */
function anchorSegment(item: unknown): string {
  if (item instanceof ChordLyricsPair) {
    const chords = item.chords.trim()
    return (chords ? `[${chords}]` : "") + (item.lyrics ?? "")
  }
  if (item instanceof Tag) {
    if (item.isSectionStart()) return item.label || item.value
    if (item.isComment()) return item.value
  }
  if (item instanceof Literal) return item.string
  return ""
}

/**
 * Chords a player is likely to drop in a chart written in `key`: the chords
 * built on its scale, spelled the way that key spells them. They come from a
 * template written in C (or A minor) and moved with the same transposition the
 * chart uses, so the spelling rules live in one place.
 */
export function suggestedChords(key: string): ReadonlyArray<string> {
  const minor = key.endsWith("m")
  const template = minor
    ? "{key: Am}\n[Am]a[C]a[Dm]a[E]a[E7]a[F]a[G]a"
    : "{key: C}\n[C]a[Dm]a[Em]a[F]a[G]a[G7]a[Am]a"
  return renderLyrics(template, key)
    .flat()
    .flatMap((item) => (item.kind === "pair" && item.chord ? [item.chord] : []))
}

function toItem(item: unknown, start: number, end: number): ReadonlyArray<ChartItem> {
  if (item instanceof ChordLyricsPair) {
    const chord = item.chords.trim()
    const lyric = item.lyrics ?? ""
    return chord || lyric ? [{ kind: "pair", chord, lyric, start, end }] : []
  }
  if (item instanceof Tag && item.isSectionStart()) return [{ kind: "section", label: item.label || item.value, start, end }]
  if (item instanceof Tag && item.isComment()) return [{ kind: "comment", text: item.value, start, end }]
  // ChordSheetJS keeps each line of a tab section as one literal, unparsed.
  if (item instanceof Literal) return [{ kind: "tab", text: item.string, start, end }]
  return []
}

/** `{start_of_tab}` and its short form `{sot}`. */
export function isTabStart(directiveName: string): boolean {
  return directiveName === "start_of_tab" || directiveName === "sot"
}

/** The end of a phrase's textblock. */
function isPhraseEnd(directiveName: string): boolean {
  return directiveName === "end_of_textblock"
}

/**
 * A phrase is stored as a ChordPro textblock (docs/adr/0003): the only section
 * whose lines ChordSheetJS neither parses nor transposes, which alphaTex needs.
 */
export function isPhraseStart(directiveName: string): boolean {
  return directiveName === "start_of_textblock"
}

/** The start of a section whose lines ChordSheetJS keeps as written: tab or a phrase. */
export function isLiteralStart(directiveName: string): boolean {
  return isTabStart(directiveName) || isPhraseStart(directiveName)
}

/** The end of a section whose lines ChordSheetJS keeps as written. */
export function isLiteralEnd(directiveName: string): boolean {
  return ["end_of_tab", "eot", "end_of_textblock"].includes(directiveName)
}

/**
 * Turns pasted chords-over-lyrics text into the stored chart text (ChordPro).
 * Each chord goes into the lyric line under it at the column it was typed at.
 * The lyrics are kept exactly, except that `[ ] { }` become parentheses because
 * ChordPro reads them as chord and directive syntax. Header lines (`[Chorus]`,
 * `Verse 1:`) start sections.
 *
 * A run of ASCII tab lines becomes a tab section, kept exactly, with a chord
 * row typed just above a tab line kept in it so the chords stay over their
 * notes. Sections do not nest, so a tab run ends the section it is in; when
 * nothing came between a header and the tab, the tab section takes the
 * header's label.
 *
 * A line of directives that the form writes no other way is kept exactly as
 * written: a comment, a phrase's textblock (docs/adr/0003) and any other
 * directive outside the form's own grammar. Sections are written as `[Header]`
 * lines and the key comes from `writtenKey`, so `{start_of_verse}`, `{key}`
 * and friends are read as words, like any other line the form does not know.
 * Inside a phrase every line is kept, since alphaTex may hold anything.
 *
 * ChordSheetJS's own chords-over-words parsers are not used: on real pastes its
 * Ultimate Guitar parser drops spaces from lyrics, and neither parser turns
 * `[Verse 1]` into a section.
 *
 * Round trip: importPasted(exportChords(source, key), key) is byte-equal for
 * every chart importPasted makes. For a chart the drag editor wrote, the
 * labelled sections keep the same anchor text and the drawn chart is the same.
 */
export function importPasted(text: string, writtenKey?: string | null): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")
  const out: Array<string> = writtenKey ? [`{key: ${writtenKey}}`] : []
  let open: string | null = null
  // Inside a phrase, whose lines are kept as written from `{start_of_textblock}` to its end.
  let phrase = false
  const close = () => {
    if (open) out.push(`{end_of_${open}}`)
    open = null
  }
  const startsTab = (i: number) => {
    const line = lines[i] ?? ""
    return isTabLine(line) || (isChordLine(line) && isTabLine(lines[i + 1] ?? ""))
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd()
    if (phrase) {
      out.push(line)
      if (directiveLine(line)?.some((tag) => isPhraseEnd(tag.name))) phrase = false
      continue
    }
    const kept = keptDirectives(line)
    if (kept) {
      // A kept section start closes any section opened from a [Header] above it, so sections never nest.
      if (kept.some((tag) => tag.isSectionStart())) close()
      out.push(line)
      phrase = kept.some((tag) => isPhraseStart(tag.name))
      continue
    }
    if (startsTab(i)) {
      const header = open ? /^\{start_of_\w+: (.*)\}$/.exec(out[out.length - 1]!) : null
      if (header) {
        out.pop()
        open = null
      } else close()
      out.push(header ? `{start_of_tab: ${header[1]}}` : "{start_of_tab}")
      for (; i < lines.length && startsTab(i); i++) out.push(lines[i]!.trimEnd())
      i--
      out.push("{end_of_tab}")
      continue
    }
    const header = sectionHeader(line)
    if (header) {
      close()
      open = /chorus/i.test(header) && !/pre/i.test(header) ? "chorus" : "verse"
      out.push(`{start_of_${open}: ${header}}`)
      continue
    }
    if (!isChordLine(line)) {
      out.push(escapeLyrics(line))
      continue
    }
    const next = lines[i + 1]?.trimEnd() ?? ""
    const chords = [...line.matchAll(/\S+/g)].map((m) => ({ column: m.index!, chord: m[0] }))
    // A line kept as a directive does not belong under the chords above it.
    if (next.trim() !== "" && !isChordLine(next) && !sectionHeader(next) && !keptDirectives(next)) {
      out.push(placeChords(next, chords))
      i++
    } else {
      // A chord-only line (an intro or turnaround): keep the spacing as lyrics.
      out.push(placeChords(" ".repeat(line.length), chords).trimEnd())
    }
  }
  close()
  return out.join("\n")
}

/**
 * The stored chart as chords over lyrics, drawn in `shownKey`: the form
 * `importPasted` reads, so a chart can be copied out and pasted back in.
 *
 * Each chord sits on the row above the word it belongs to. A chord that would
 * touch the one before it moves right to leave a space, and a chord-only line
 * is followed by a blank line so the importer does not pair it with the lyrics
 * or tab below. Tab lines are written as stored, and a section with no label
 * gets no header line.
 *
 * A phrase and every other directive the form keeps are written as the stored
 * lines themselves, so they come back unchanged; a section is written as a
 * `[Header]` line, which the importer turns back into the section it came from.
 * The chart's key is not written: the form carries it as the key the player
 * chose, which is the argument `importPasted` takes.
 *
 * Round trip: importPasted(exportChords(source, key), key) is byte-equal for
 * every chart importPasted makes. For a chart the drag editor wrote, the
 * labelled sections keep the same anchor text and the drawn chart is the same.
 */
export function exportChords(source: string, shownKey?: string | null): string {
  const out: Array<string> = []
  // True right after a chord-only row, which the importer would pair with a lyric row below it.
  let chordsOnly = false
  const drawn = renderLyrics(source, shownKey).flat()
  // Stored lines are read through parseDoc, the same line-indexed view doc.ts uses.
  const doc = parseDoc(source)
  const raw = source.split("\n")
  let next = 0 // the next drawn item, which items are in anchor order
  let at = 0 // where the current line's own text starts in the anchor text
  doc.forEach((line, index) => {
    if (index > 0) at += 1
    const lineAnchor = anchorLine(line)
    const end = at + lineAnchor.length
    // The items drawn for this line: every drawn item starting within it. A
    // phrase's or a comment's line is written as stored below, not from its item.
    const items: Array<Exclude<ChartItem, { kind: "phrase" | "comment" }>> = []
    while (next < drawn.length && drawn[next]!.start <= end) {
      const item = drawn[next++]!
      if (item.kind !== "phrase" && item.kind !== "comment") items.push(item)
    }
    at = end
    const rawLine = raw[index]!
    // The same reading of a line as the importer's, so what one keeps the other keeps.
    const tags = directiveLine(rawLine)

    // Inside a phrase every line is written as stored, verbatim (one phrase rule shared with doc.ts).
    if (inPhrase(doc, index)) {
      out.push(rawLine)
      chordsOnly = false
      return
    }
    // An unlabelled (non-tab) section is shown as its stored directive lines, not as a [Header].
    if (tags?.every((tag) => tag.isSectionStart() && !isTabStart(tag.name) && !(tag.label || tag.value))) {
      out.push(rawLine)
      chordsOnly = false
      return
    }
    // A phrase start line is written as stored.
    if (tags?.every((tag) => isPhraseStart(tag.name))) {
      out.push(rawLine)
      chordsOnly = false
      return
    }
    // A section end line is kept only when it closes an unlabelled section.
    if (tags?.every((tag) => tag.isSectionEnd())) {
      const open = enclosingSection(doc, index)
      const raw = open !== null && open.kind !== "tab" ? (doc[open.start] as { kind: "directive"; raw: string }).raw : ""
      const label = /^\{\s*start_of_\w+\s*(?::\s*(.*?))?\s*\}$/.exec(raw)?.[1]
      const unlabelled = open !== null && open.kind !== "tab" && (label ?? "").trim() === ""
      if (unlabelled) {
        out.push(rawLine)
        chordsOnly = false
        return
      }
      // The importer writes section ends for labelled sections.
      return
    }
    // The importer writes the key from its argument; a key change later round-trips.
    if (tags?.every((tag) => tag.name === "key" && index === 0)) return
    // Every other directive line is kept as written.
    if (tags && tags.length > 0 && !tags.some((tag) => tag.isSectionStart() || tag.isSectionEnd())) {
      out.push(rawLine)
      chordsOnly = false
      return
    }

    let chords = ""
    let lyrics = ""
    for (const item of items) {
      if (item.kind === "section") {
        if (item.label) out.push(`[${item.label}]`)
      } else if (item.kind === "tab") {
        if (chordsOnly) out.push("")
        out.push(item.text)
      } else {
        if (item.chord) {
          const gap = chords.length >= lyrics.length && chords !== "" ? " " : ""
          chords = chords.padEnd(lyrics.length, " ") + gap + item.chord
        }
        lyrics += item.lyric
      }
    }
    const text = lyrics.trimEnd()
    if (chords) out.push(chords)
    if (text) {
      if (chordsOnly && !chords) out.push("")
      out.push(text)
    } else if (items.length === 0) out.push("")
    chordsOnly = chords !== "" && text === ""
  })
  return out.join("\n")
}

const isTag = (item: unknown): item is Tag => item instanceof Tag

/**
 * The directives of one pasted line, or null when the chart parser does not
 * read the line as directives alone: not a `{...}` line, not parseable, or
 * words beside a directive.
 */
function directiveLine(line: string): ReadonlyArray<Tag> | null {
  if (!/^\{.*\}$/.test(line)) return null
  let items: ReadonlyArray<unknown>
  try {
    items = new ChordProParser().parse(line).lines.flatMap((parsed) => parsed.items)
  } catch {
    return null
  }
  return items.length > 0 && items.every(isTag) ? items : null
}

/**
 * A directive the paste form carries as written: not a section, which the form
 * writes as a `[Header]` line, and not the key, which the form carries as the
 * key the player chose. A phrase has no other form, so it is kept.
 */
/** The directives of a line the form keeps as written, or null when it keeps no such line. */
function keptDirectives(line: string): ReadonlyArray<Tag> | null {
  const tags = directiveLine(line)
  return tags && tags.length > 0 ? tags : null
}

function placeChords(lyrics: string, chords: ReadonlyArray<{ column: number; chord: string }>): string {
  let result = ""
  let at = 0
  for (const { column, chord } of chords) {
    const offset = Math.min(column, lyrics.length)
    result += escapeLyrics(lyrics.slice(at, offset)) + `[${chord}]`
    at = offset
  }
  return result + escapeLyrics(lyrics.slice(at))
}

function sectionHeader(line: string): string | null {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line) ?? /^\s*([A-Za-z][A-Za-z -]*\d*)\s*:\s*$/.exec(line)
  return match && !isChordLine(match[1]!) ? match[1]!.trim() : null
}

/**
 * True for a line of ASCII tab (`e|--0--3h5--|`): an optional string name,
 * then dashes, frets, bar lines and technique letters, with at least four
 * dashes making up a third of it, and a bar line or a string name.
 */
export function isTabLine(line: string): boolean {
  const trimmed = line.trim()
  const body = trimmed.replace(/^[A-Ga-g][#b]?(?=\s*[|:-])/, "")
  const dashes = body.match(/-/g)?.length ?? 0
  return (
    dashes >= 4 &&
    dashes * 3 >= body.length &&
    (body.includes("|") || body !== trimmed) &&
    /^[\s|:\-0-9a-zA-Z/\\~()<>^.*=+]+$/.test(body)
  )
}

/** True when every token on the line is a chord or a chart symbol (bar lines, repeats, N.C.). */
export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/)
  return line.trim() !== "" && tokens.every((token) => CHORD_TOKEN.test(token))
}

function escapeLyrics(text: string): string {
  return text.replace(/[[\]{}]/g, (c) => ({ "[": "(", "]": ")", "{": "(", "}": ")" })[c]!)
}

const CHORD_TOKEN =
  /^(\(?[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?[0-9]*(sus[24]?|add[0-9]+|[#b][0-9]+)*(\/[A-G][#b]?)?\)?|\||\|\||-|\/|N\.?C\.?|\(?x\d+\)?)$/

/**
 * True when a song has a chart of chords over lyrics. A score draws no chord
 * names, so the chord controls belong to a lyrics chart and to nothing else.
 * Every place that shows them asks here, so they appear and go together.
 */
export const hasLyricsChart = (list: ReadonlyArray<{ readonly kind: string }>): boolean => list.some((chart) => chart.kind === "lyrics")
