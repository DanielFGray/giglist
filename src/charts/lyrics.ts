/**
 * Lyrics charts: chords placed over words.
 *
 * A lyrics chart is stored as ChordPro text, an internal format players never
 * see (docs/adr/0002). Players paste chords over lyrics; `importPasted` turns
 * that into the stored text. `renderLyrics` turns stored text into plain data
 * a view can draw, transposed to the key the player needs.
 *
 * Pure and free of the DOM, so the server and the browser share it.
 */
import { ChordLyricsPair, ChordProParser, Literal, Tag } from "chordsheetjs"

/**
 * One drawable piece of a chart line. `start` and `end` are its range in the
 * anchor text of the stored chart (see doc.ts), which marks anchor to; they do
 * not change when the chart is shown in another key.
 */
export type ChartItem = { readonly start: number; readonly end: number } & (
  | { kind: "pair"; chord: string; lyric: string }
  /** `tabWrittenIn` is set on a tab section drawn in another key: its tab is shown as written, in that key. */
  | { kind: "section"; label: string; tabWrittenIn?: string }
  | { kind: "comment"; text: string }
  /** A line of ASCII tab, kept exactly as written: its columns are the music. */
  | { kind: "tab"; text: string }
)

/** A chart line; an empty one is a blank line. */
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
  let offset = 0
  return song.lines.map((line, lineIndex) => {
    if (lineIndex > 0) offset += 1
    return line.items.flatMap((item, itemIndex) => {
      // Ranges come from the stored chart: a transposed chord may be longer or shorter.
      const start = offset
      const written = stored.lines[lineIndex]!.items[itemIndex]
      offset += anchorSegment(written).length
      // ChordSheetJS transposes chord names in a tab line too; tab is shown as written, chords and frets alike.
      const shown = toItem(item instanceof Literal ? written : item, start, offset)
      return song === stored || !(item instanceof Tag && isTabStart(item.name))
        ? shown
        : shown.map((i) => ({ ...i, tabWrittenIn: stored.key! }))
    })
  })
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
 * ChordSheetJS's own chords-over-words parsers are not used: on real pastes its
 * Ultimate Guitar parser drops spaces from lyrics, and neither parser turns
 * `[Verse 1]` into a section.
 */
export function importPasted(text: string, writtenKey?: string | null): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")
  const out: Array<string> = writtenKey ? [`{key: ${writtenKey}}`] : []
  let open: string | null = null
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
    if (next.trim() !== "" && !isChordLine(next) && !sectionHeader(next)) {
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
 * gets no header line. Directives other than sections and comments are dropped.
 */
export function exportChords(source: string, shownKey?: string | null): string {
  const out: Array<string> = []
  // True right after a chord-only row, which the importer would pair with a lyric row below it.
  let chordsOnly = false
  const stored = source.split("\n")
  for (const [i, line] of renderLyrics(source, shownKey).entries()) {
    let chords = ""
    let lyrics = ""
    for (const item of line) {
      if (item.kind === "section") {
        if (item.label) out.push(`[${item.label}]`)
      } else if (item.kind === "comment") out.push(item.text)
      else if (item.kind === "tab") {
        if (chordsOnly) out.push("")
        out.push(item.text)
        chordsOnly = false
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
    } else if (!chords && stored[i]!.trim() === "") out.push("")
    chordsOnly = chords !== "" && text === ""
  }
  return out.join("\n")
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
