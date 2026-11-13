/**
 * Chords over lyrics from a Guitar Pro score, for the player to correct before
 * it becomes a lyrics chart (docs/adr/0007). Pure: it reads alphaTab's model
 * and nothing else, so the upload form and the tests share it.
 *
 * Chords and lyrics often sit on different tracks, so both are placed on one
 * timeline: the bars in the order they are played (repeats unrolled), and each
 * beat at its bar's start plus its own start. A chord goes over the syllable
 * sounding when it starts, as a player writes it over a held word; a chord in
 * a rest goes over the next syllable, and one more than a bar before the next
 * line is instrumental and goes on a chord-only line.
 */
import type { model } from "@coderline/alphatab"
import type { MusicalKeyType } from "~/api/songs"
import { keyOfChords } from "./lyrics"
import { noteInKey } from "./numeral"
import { inferChords } from "./score-chords"
import { spell } from "alphatab-kit/charts/spelling"

export type ScoreChart = {
  /** Chords over lyrics, in the form `importPasted` reads. */
  readonly text: string
  /** The key the chords suggest, which the chart is written in. */
  readonly key: MusicalKeyType | null
  /** True when the chords were worked out from the notes, not named by the file's author. */
  readonly inferred: boolean
  /** True when the score has lyrics; without them the chart is chord-only lines. */
  readonly sung: boolean
}

/**
 * The score as chords over lyrics, or null when it has neither. The chords are
 * the ones the author named when they cover at least half the bars played;
 * otherwise they are worked out from the notes (`inferChords`) and spelled in
 * the key they suggest.
 */
export function chartFromScore(score: model.Score): ScoreChart | null {
  const played = playedBars(score)
  const named = namedChords(score, played)
  const inferred = new Set(named.map((c) => playedIndexAt(played, c.at))).size < played.length / 2
  const { chords, key } = inferred ? spelledInKey(inferChords(score, played)) : { chords: named, key: keyOf(named) }
  const syllables = sungSyllables(score, lyricTrack(score), played)
  if (chords.length === 0 && syllables.length === 0) return null
  return { text: layout(played, chords, breakLines(syllables)), key, inferred, sung: syllables.length > 0 }
}

type Played = { readonly bar: model.MasterBar; readonly at: number; readonly pass: number }
type ChordAt = { readonly at: number; readonly name: string }
type Syllable = { readonly at: number; readonly end: number; readonly text: string; readonly section: boolean }

const QUARTER = 960
/** The longest lyric line that fits a phone held upright. */
const MAX_LINE = 48
/** Chord-only lines hold four bars, each `BAR_WIDTH` columns wide. */
const BARS_PER_LINE = 4
const BAR_WIDTH = 8

/**
 * The chart text: section headers, chords over each lyric line, and chord-only
 * lines for the chords no syllable takes. A chord equal to the one before it
 * is not written again, except as a chord-only line's first chord in a bar.
 */
function layout(played: ReadonlyArray<Played>, chords: ReadonlyArray<ChordAt>, lines: ReadonlyArray<ReadonlyArray<Syllable>>): string {
  const out: Array<string> = []
  let ci = 0
  let lastChord: string | null = null
  const sections = played.filter((p) => p.bar.section?.text.trim()).map((p) => ({ at: p.at, label: p.bar.section!.text.trim() }))
  let si = 0
  const sectionsBefore = (t: number) => {
    for (; si < sections.length && sections[si]!.at <= t; si++) {
      chordLinesBefore(sections[si]!.at)
      out.push(`[${sections[si]!.label}]`)
      lastChord = null
    }
  }
  // Chords before `t` that no syllable takes, `BARS_PER_LINE` bars to a line. Each bar starts at
  // a fixed column with its chord, even when the chord goes on, so a player can count the bars.
  const chordLinesBefore = (t: number) => {
    let row: Array<{ chord: string; column: number }> = []
    let rowStart = 0
    let barShown = -1
    for (; ci < chords.length && chords[ci]!.at < t; ci++) {
      const c = chords[ci]!
      const bar = playedIndexAt(played, c.at)
      if (row.length > 0 && bar >= rowStart + BARS_PER_LINE) {
        out.push(chordRow(row))
        row = []
      }
      if (row.length === 0) rowStart = bar
      const p = played[bar]!
      const within = (c.at - p.at) / p.bar.calculateDuration()
      if (bar !== barShown || c.name !== lastChord) {
        row.push({ chord: c.name, column: (bar - rowStart) * BAR_WIDTH + Math.round(within * BAR_WIDTH) })
      }
      barShown = bar
      lastChord = c.name
    }
    if (row.length > 0) out.push(chordRow(row))
  }
  for (const [li, line] of lines.entries()) {
    const start = line[0]!.at
    sectionsBefore(start)
    chordLinesBefore(start - barLength(played, start))
    let lyric = ""
    const placed: Array<{ chord: string; column: number; at: number }> = []
    const take = (until: number, column: number) => {
      for (; ci < chords.length && chords[ci]!.at < until; ci++) {
        const c = chords[ci]!
        if (c.name !== lastChord) placed.push({ chord: c.name, column, at: c.at })
        lastChord = c.name
      }
    }
    for (const [k, s] of line.entries()) {
      take(s.end, lyric.length)
      lyric += sung(s, k === line.length - 1)
    }
    // Line end: a chord in the rest after the last word, within a bar, is written over that word,
    // unless it starts within a beat of the next line, where it leads that line.
    const last = line.at(-1)!
    const nextStart = lines[li + 1]?.[0]?.at ?? Infinity
    take(Math.min(last.end + barLength(played, last.end), nextStart - QUARTER), lyric.length - sung(last, true).length)
    // Line start: a line's first chord, when it comes within the line's first bar, is written over
    // its first word, so a pickup word sung before the bar line still begins under its chord.
    const first = placed[0]
    if (first && first.column > 0 && first.at < start + barLength(played, start)) first.column = 0
    if (placed.length > 0) out.push(chordRow(placed))
    out.push(lyric.trimEnd())
  }
  sectionsBefore(Infinity)
  chordLinesBefore(Infinity)
  return out.join("\n")
}

/** The master bars in playing order: one level of repeats, with alternate endings. */
function playedBars(score: model.Score): Array<Played> {
  const bars = score.masterBars
  const out: Array<Played> = []
  let at = 0
  let start = 0
  let pass = 0
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!
    if (bar.isRepeatStart && i !== start) {
      start = i
      pass = 0
    }
    const skipped = bar.alternateEndings !== 0 && (bar.alternateEndings & (1 << pass)) === 0
    if (!skipped) {
      out.push({ bar, at, pass })
      at += bar.calculateDuration()
    }
    if (bar.repeatCount > 0 && pass < bar.repeatCount - 1) {
      pass++
      i = start - 1
    } else if (bar.repeatCount > 0) {
      pass = 0
      start = i + 1
    }
  }
  return out
}

/** The chords the author named, on any track, in playing order; the first one wins a shared tick. */
function namedChords(score: model.Score, played: ReadonlyArray<Played>): Array<ChordAt> {
  const events = new Map<number, string>()
  for (const p of played) {
    for (const beat of beatsOf(score, p.bar.index)) {
      const name = beat.chord?.name.trim()
      const at = p.at + beat.playbackStart
      if (name && !events.has(at)) events.set(at, name)
    }
  }
  return [...events.entries()].sort((a, b) => a[0] - b[0]).map(([at, name]) => ({ at, name }))
}

/** Heard chords named in the key they suggest: Db in Ab, not C#. */
function spelledInKey(heard: ReturnType<typeof inferChords>): { chords: Array<ChordAt>; key: MusicalKeyType | null } {
  const key = keyOfChords(heard.map((c) => ({ root: c.root, minor: c.quality === "m" })))
  return { chords: heard.map((c) => ({ at: c.at, name: noteInKey(c.root, key ?? "C") + c.quality })), key }
}

function keyOf(chords: ReadonlyArray<ChordAt>): MusicalKeyType | null {
  return keyOfChords(chords.flatMap((c) => {
    const s = spell(c.name)
    return s ? [{ root: s.root, minor: s.tones.get(3) === 3 }] : []
  }))
}

/** The track with the most beats that carry a syllable, or -1 when none does. */
function lyricTrack(score: model.Score): number {
  let best = -1
  let most = 0
  for (const track of score.tracks) {
    const n = track.staves.flatMap((s) => s.bars.flatMap((b) => b.voices.flatMap((v) => v.beats))).filter((b) => b.lyrics?.some(Boolean)).length
    if (n > most) {
      most = n
      best = track.index
    }
  }
  return best
}

/**
 * The sung syllables in playing order. On pass p through a repeat a bar sings
 * lyric line p when it has one, else line 0: authors stack verse 2 under verse 1.
 * A syllable sounds until the next rest or the next syllable, so a note tied
 * over or a melisma without a lyric of its own still belongs to it.
 */
function sungSyllables(score: model.Score, track: number, played: ReadonlyArray<Played>): Array<Syllable> {
  const syllables: Array<Syllable> = []
  if (track < 0) return syllables
  const staff = score.tracks[track]!.staves[0]!
  let open: Omit<Syllable, "end"> | null = null
  const close = (at: number) => {
    if (open) syllables.push({ ...open, end: at })
    open = null
  }
  for (const p of played) {
    const beats = staff.bars[p.bar.index]?.voices[0]?.beats ?? []
    const line = beats.some((b) => b.lyrics?.[p.pass]) ? p.pass : 0
    let first = true
    for (const beat of beats) {
      const at = p.at + beat.playbackStart
      const text = beat.lyrics?.[line]?.trim()
      if (beat.isRest || text) close(at)
      if (!text) continue
      open = { at, text, section: first && !!p.bar.section?.text.trim() }
      first = false
    }
  }
  const end = played.at(-1)
  close(end ? end.at + end.bar.calculateDuration() : 0)
  return syllables
}

/**
 * Lines end at a section. alphaTab drops the line ends of the author's lyric
 * text, so a line longer than `MAX_LINE` is split at its longest rest, until
 * each part fits.
 */
function breakLines(syllables: ReadonlyArray<Syllable>): Array<ReadonlyArray<Syllable>> {
  const lines: Array<Array<Syllable>> = []
  for (const [i, s] of syllables.entries()) {
    const prev = syllables[i - 1]
    if (!prev || (s.section && !prev.text.endsWith("-"))) lines.push([])
    lines.at(-1)!.push(s)
  }
  return lines.flatMap(fit)
}

function fit(line: ReadonlyArray<Syllable>): Array<ReadonlyArray<Syllable>> {
  if (line.map((s, k) => sung(s, k === line.length - 1)).join("").length <= MAX_LINE) return [line]
  const gap = (k: number) => line[k]!.at - line[k - 1]!.end
  let best = -1
  for (let k = 1; k < line.length; k++) {
    if (line[k - 1]!.text.endsWith("-")) continue
    // On equal rests, the split nearer the middle leaves two lines of even length.
    if (best < 0 || gap(k) > gap(best) || (gap(k) === gap(best) && Math.abs(k - line.length / 2) < Math.abs(best - line.length / 2))) best = k
  }
  return best < 0 ? [line] : [...fit(line.slice(0, best)), ...fit(line.slice(best))]
}

/** A syllable as it is written in its line: one ending in "-" joins the next, any other is followed by a space. */
function sung(s: Syllable, last: boolean): string {
  return s.text.endsWith("-") ? s.text.slice(0, -1) : last ? s.text : `${s.text} `
}

function beatsOf(score: model.Score, barIndex: number): Array<model.Beat> {
  return score.tracks.flatMap((t) => t.staves.flatMap((s) => s.bars[barIndex]?.voices.flatMap((v) => v.beats) ?? []))
}

/** The index in `played` of the bar sounding at tick `at`. */
function playedIndexAt(played: ReadonlyArray<Played>, at: number): number {
  return Math.max(0, played.findLastIndex((p) => p.at <= at))
}

function barLength(played: ReadonlyArray<Played>, at: number): number {
  return played[playedIndexAt(played, at)]?.bar.calculateDuration() ?? 4 * QUARTER
}

function chordRow(chords: ReadonlyArray<{ chord: string; column: number }>): string {
  let row = ""
  for (const { chord, column } of chords) row = row.padEnd(row === "" ? column : Math.max(column, row.length + 1)) + chord
  return row
}
