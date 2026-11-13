/**
 * Chord suggestions for one place in a lyrics chart: what is likely to go between
 * the chord before it and the chord after it, in the chart's key.
 *
 * A chord is reduced to its class, the triad numeral of its root in the key
 * (`V`, `vi`, `bVII`, `vii°`), so one count serves every key. The odds of a
 * class come from this song's own chord changes first, with odds counted over the
 * rock corpus as the fallback, each smoothed toward the one below it
 * (docs/adr/0005). Pure and free of the DOM.
 */
import { enclosingSection, type ChartDoc } from "alphatab-kit/charts/doc"
import { DEGREE_NAME, ROMAN_STEP, inKey, keyScale, numeral, type KeyScale } from "alphatab-kit/charts/numeral"
import { spell, spellNote } from "alphatab-kit/charts/spelling"
import corpusCounts from "./rock-prior.json"

/** Chord-change counts over a corpus, by class: how often each class follows each other class. */
export type Prior = {
  readonly unigram: Readonly<Record<string, number>>
  readonly bigram: Readonly<Record<string, Readonly<Record<string, number>>>>
}

/** The counts the app ships, from the rock corpus (rs200, de Clercq and Temperley, CC BY 4.0). */
export const ROCK_PRIOR: Prior = corpusCounts

/** Where the chord goes: the song's chords before it and after it, in reading order. */
export type Slot = {
  readonly key: string
  readonly before: ReadonlyArray<string>
  readonly after: ReadonlyArray<string>
  /** The chord at the same place in an earlier or later section of the same name, and that section's label. */
  readonly repeat?: { readonly chord: string; readonly section: string } | null
}

export type Suggestion = {
  readonly chord: string
  /** The chord's numeral before the chord that follows, so an applied chord reads V7/vi. */
  readonly numeral: string | null
  /** Why it is offered, in a few words. */
  readonly reason: string
}

/** How strongly each layer leans on the one below it, in pseudo-counts. Fitted on the rock corpus by scripts/checkSuggestions.ts. */
export const WEIGHTS = { song: 2, corpus: 4, trigram: 1 }

/**
 * Chords for `slot`, best first, in two lists with no chord in both. `likely`
 * holds the chords the song uses: the chord at the same place in a repeated
 * section first, then the rest by P(class | chords before) × P(next chord | class).
 * `fresh` holds the chords the song does not use yet: the best `limit` of them
 * by the same odds, then any of the key's own chords not among them, so every
 * unused chord of the key is offered.
 *
 * The two lists exist because the song's own counts favour the chords it already
 * has: on the rock corpus, ranking only the unused chords finds a chord new to
 * the song far more often than the full ranking does (docs/adr/0005).
 */
export function suggest(
  slot: Slot,
  limit = 5,
  prior: Prior = ROCK_PRIOR,
  weights = WEIGHTS,
): { readonly likely: ReadonlyArray<Suggestion>; readonly fresh: ReadonlyArray<Suggestion> } {
  const scale = keyScale(slot.key)
  if (scale === null) return { likely: [], fresh: [] }
  const classOf = (chord: string) => chordClass(chord, scale)
  const before = changes(slot.before.flatMap((chord) => nonNull(classOf(chord))))
  const after = changes(slot.after.flatMap((chord) => nonNull(classOf(chord))))
  const next = slot.after.find((chord) => classOf(chord) !== null) ?? null
  const used = [...slot.before, ...slot.after]

  const song = countChanges([before, after])
  const names = namesByClass(used, scale)
  const nameOf = (cls: string) => names.get(cls) ?? chordName(cls, slot.key, scale, next)
  const offer = (chord: string, reason: string): Suggestion => ({ chord, numeral: numeral(chord, slot.key, next), reason })

  const previous = slot.before.at(-1) ?? null
  const ranked = rankClasses(before, after, prior, weights)
  const toOffer = (cls: string) => {
    const chord = nameOf(cls)
    const follows = previous !== null && (song.bigram.get(before.at(-1)!)?.get(cls) ?? 0) > 0
    return offer(chord, reasonFor(chord, slot.key, scale, next, names.has(cls) ? (follows ? previous : "") : null, previous))
  }
  const repeat = slot.repeat ? [offer(slot.repeat.chord, `as in ${slot.repeat.section}`)] : []
  const unused = ranked.filter((cls) => !names.has(cls))
  const best = unused.slice(0, limit)
  const restOfKey = diatonicClasses(scale).filter((cls) => !names.has(cls) && !best.includes(cls))
  return {
    likely: dedupe([...repeat, ...ranked.filter((cls) => names.has(cls)).map(toOffer)]),
    fresh: [...best, ...restOfKey].map(toOffer),
  }
}

/**
 * The slot at column `at` of lyric line `line`: the chart's chords before and
 * after it in reading order, leaving out a chord already at `at` (the one being
 * replaced).
 *
 * The repeat comes from the nearest other section with the same name ("Verse 1"
 * and "Verse 2" share a name), from its lyric line with the same number: its
 * chord X counts when this line's chords, with X at `at`, and that line's chords
 * agree as far as the shorter of them goes. So a line being written left to
 * right follows the other verse, and a word that has no chord in the other verse
 * gets no repeat.
 */
export function chartSlot(doc: ChartDoc, key: string, line: number, at: number): Slot {
  const before: Array<string> = []
  const after: Array<string> = []
  doc.forEach((each, index) => {
    if (each.kind !== "lyrics") return
    for (const chord of each.chords) {
      if (index < line || (index === line && chord.at < at)) before.push(chord.chord)
      else if (index > line || chord.at > at) after.push(chord.chord)
    }
  })
  return { key, before, after, repeat: repeatAt(doc, line, at) }
}

function repeatAt(doc: ChartDoc, line: number, at: number): Slot["repeat"] {
  const here = enclosingSection(doc, line)
  const slotLine = doc[line]
  if (here === null || slotLine?.kind !== "lyrics") return null
  const name = sectionName(doc, here.start)
  const row = lyricLines(doc, here.start).indexOf(line)
  const ordinal = slotLine.chords.filter((chord) => chord.at < at).length
  const rest = slotLine.chords.filter((chord) => chord.at !== at).map((chord) => chord.chord)
  const starts = doc.flatMap((each, index) =>
    index !== here.start && each.kind === "directive" && /^\{\s*start_of_/.test(each.raw) && sectionName(doc, index) === name ? [index] : [],
  )
  // The nearest earlier section first, then the nearest later one.
  const order = [...starts.filter((start) => start < here.start).reverse(), ...starts.filter((start) => start > here.start)]
  for (const start of order) {
    const other = doc[lyricLines(doc, start)[row] ?? -1]
    if (other?.kind !== "lyrics") continue
    const chords = other.chords.map((chord) => chord.chord)
    const chord = chords[ordinal]
    const filled = [...rest.slice(0, ordinal), chord, ...rest.slice(ordinal)]
    if (chord !== undefined && filled.every((name, index) => index >= chords.length || chords[index] === name)) return { chord, section: sectionLabel(doc, start) }
  }
  return null
}

/** The lyric lines of the section whose start line is `start`, in order. */
function lyricLines(doc: ChartDoc, start: number): ReadonlyArray<number> {
  const lines: Array<number> = []
  for (let index = start + 1; index < doc.length && enclosingSection(doc, index)?.start === start; index += 1) {
    if (doc[index]!.kind === "lyrics") lines.push(index)
  }
  return lines
}

/** A section's label as written (`Verse 2`), or its kind (`chorus`) when it has none. */
function sectionLabel(doc: ChartDoc, start: number): string {
  const line = doc[start]
  const found = line?.kind === "directive" ? /^\{\s*start_of_(\w+)\s*(?::\s*(.*?))?\s*\}$/.exec(line.raw) : null
  return found?.[2] || found?.[1] || ""
}

/** A section's label without its number, for matching: "Verse 2" and "verse" are both "verse". */
function sectionName(doc: ChartDoc, start: number): string {
  return sectionLabel(doc, start).replace(/\s*\d+\s*$/, "").trim().toLowerCase()
}

/**
 * The class of a chord in a key: its root's degree with the case and mark of its
 * triad (`V`, `vi`, `vii°`, `bIII+`). A sus or power chord counts as major. Null
 * for a name that does not spell, such as N.C.
 */
export function chordClass(chord: string, scale: KeyScale): string | null {
  const spelling = spell(chord)
  if (spelling === null) return null
  const name = DEGREE_NAME[(spelling.root - scale.tonic + 12) % 12]!
  const third = spelling.tones.get(3)
  const fifth = spelling.tones.get(5)
  if (third === 3) return fifth === 6 ? `${name.toLowerCase()}°` : name.toLowerCase()
  return third === 4 && fifth === 8 ? `${name}+` : name
}

/**
 * Every class the corpus or the song has, most likely first, for a slot between
 * the classes `before` and `after` (each a run of chord changes).
 */
export function rankClasses(before: ReadonlyArray<string>, after: ReadonlyArray<string>, prior: Prior, weights = WEIGHTS): ReadonlyArray<string> {
  const odds = classOdds(before, after, countChanges([before, after]), prior, weights)
  return [...odds].sort((a, b) => b[1] - a[1]).map(([cls]) => cls)
}

/** A run of classes with each held chord counted once: C C G reads as one change, C to G. */
export function changes(classes: ReadonlyArray<string>): ReadonlyArray<string> {
  return classes.filter((cls, index) => cls !== classes[index - 1])
}

/**
 * The odds of each class at the slot. Each layer is a count smoothed toward the
 * layer below it (a Dirichlet prior): song trigram → song bigram → corpus bigram
 * → corpus unigram.
 */
function classOdds(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  song: Changes,
  prior: Prior,
  weights: typeof WEIGHTS,
): ReadonlyMap<string, number> {
  const classes = new Set([...Object.keys(prior.unigram), ...before, ...after])
  const total = Object.values(prior.unigram).reduce((sum, count) => sum + count, 0)
  const unigram = (cls: string) => ((prior.unigram[cls] ?? 0) + 1) / (total + classes.size)
  const corpus = (from: string, to: string) => {
    const row = prior.bigram[from] ?? {}
    const rowTotal = Object.values(row).reduce((sum, count) => sum + count, 0)
    return ((row[to] ?? 0) + weights.corpus * unigram(to)) / (rowTotal + weights.corpus)
  }
  const bigram = (from: string | null, to: string) => {
    if (from === null) return unigram(to)
    const row = song.bigram.get(from)
    return ((row?.get(to) ?? 0) + weights.song * corpus(from, to)) / ((row?.total ?? 0) + weights.song)
  }
  const forward = (to: string) => {
    const [second, first] = [before.at(-2) ?? null, before.at(-1) ?? null]
    const lower = bigram(first, to)
    if (second === null || first === null) return lower
    const row = song.trigram.get(`${second} ${first}`)
    return ((row?.get(to) ?? 0) + weights.trigram * lower) / ((row?.total ?? 0) + weights.trigram)
  }
  const next = after[0] ?? null
  return new Map([...classes].map((cls) => [cls, forward(cls) * (next === null ? 1 : bigram(cls, next))]))
}

type Row = Map<string, number> & { total?: number }
type Changes = { readonly bigram: Map<string, Row>; readonly trigram: Map<string, Row> }

/** Bigram and trigram counts over runs of classes; a change never spans two runs. */
function countChanges(runs: ReadonlyArray<ReadonlyArray<string>>): Changes {
  const bigram = new Map<string, Row>()
  const trigram = new Map<string, Row>()
  const add = (table: Map<string, Row>, from: string, to: string) => {
    const row: Row = table.get(from) ?? new Map()
    row.set(to, (row.get(to) ?? 0) + 1)
    row.total = (row.total ?? 0) + 1
    table.set(from, row)
  }
  for (const run of runs) {
    run.forEach((cls, index) => {
      if (index >= 1) add(bigram, run[index - 1]!, cls)
      if (index >= 2) add(trigram, `${run[index - 2]} ${run[index - 1]}`, cls)
    })
  }
  return { bigram, trigram }
}

/** The name the song itself uses most for each class, so a suggestion reads Am7 where the song writes Am7. */
function namesByClass(chords: ReadonlyArray<string>, scale: KeyScale): ReadonlyMap<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const chord of chords) {
    const cls = chordClass(chord, scale)
    if (cls === null) continue
    const names = counts.get(cls) ?? new Map<string, number>()
    names.set(chord, (names.get(chord) ?? 0) + 1)
    counts.set(cls, names)
  }
  return new Map([...counts].map(([cls, names]) => [cls, [...names].sort((a, b) => b[1] - a[1])[0]![0]]))
}

/**
 * Why a chord is offered. `usedAfter` is null when the song does not use the
 * chord, the chord before the slot when the song already moves from it to this
 * chord, and "" when the song uses the chord elsewhere.
 */
function reasonFor(chord: string, key: string, scale: KeyScale, next: string | null, usedAfter: string | null, previous: string | null): string {
  if (next !== null && numeral(chord, key, next)?.includes("/")) return `leads to ${next}`
  if (usedAfter) return `follows ${usedAfter} in this song`
  if (usedAfter === "") return "in this song"
  const spelling = spell(chord)
  if (spelling !== null && inKey(spelling, scale)) return "in the key, not used yet"
  if (spelling !== null && inKey(spelling, parallel(scale))) return `borrowed from ${scale.minor ? "major" : "minor"}`
  return previous === null ? `common in rock` : `common after ${previous} in rock`
}

/** The key with the same tonic and the other mode. */
function parallel(scale: KeyScale): KeyScale {
  const steps = scale.minor ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
  return { tonic: scale.tonic, minor: !scale.minor, pitches: new Set(steps.map((step) => (scale.tonic + step) % 12)) }
}

/** The classes of the key's own triads, in scale order. A minor key's V is major, as in harmonic minor. */
function diatonicClasses(scale: KeyScale): ReadonlyArray<string> {
  return scale.minor ? ["i", "ii°", "bIII", "iv", "V", "bVI", "bVII"] : ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
}

/**
 * A chord name for a class in the key. A major class that is applied to `next`
 * (a 5th above it, from outside the key) is named as a dominant 7th, the form
 * players use for a passing chord: B7 before Em in G.
 */
function chordName(cls: string, key: string, scale: KeyScale, next: string | null): string {
  const found = cls.match(/^([b#]?)([IViv]+)([°+]?)$/)!
  const roman = found[2]!
  const degree = DEGREE_NAME.indexOf(found[1] + roman.toUpperCase())
  const root = (scale.tonic + degree) % 12
  const quality = found[3] === "°" ? "dim" : found[3] === "+" ? "aug" : roman === roman.toLowerCase() ? "m" : ""
  // A diminished chord leads up a half step, so a flat degree is spelled as the sharp one below it: D#dim before Em in G.
  const step = ROMAN_STEP[roman.toUpperCase()]! - (quality === "dim" && found[1] === "b" ? 1 : 0)
  const name = spellNote(root, (step + 7) % 7, key) + quality
  if (quality !== "" || next === null) return name
  const seventh = `${name}7`
  return numeral(seventh, key, next)?.includes("/") ? seventh : name
}

function nonNull<T>(value: T | null): ReadonlyArray<T> {
  return value === null ? [] : [value]
}

function dedupe(suggestions: ReadonlyArray<Suggestion>): ReadonlyArray<Suggestion> {
  const seen = new Set<string>()
  return suggestions.filter(({ chord }) => !seen.has(chord) && (seen.add(chord), true))
}
